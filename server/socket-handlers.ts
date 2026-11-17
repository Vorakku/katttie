import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { Server } from 'socket.io';
import { cursorPositionSchema, schemas, type Ack, type AckCallback, type ClientEvents, type ClientPayloads, type RoomSnapshot, type ServerEvents } from '../src/shared/protocol';
import type { SocketData } from './app';
import type { RoomManager } from './room-manager';
import { noteUpdateSchema, type NoteAckCallback, type NotePayload } from '../src/shared/notepad';

const loopback = (value: string) => value === '::1' || value === 'localhost' || (isIP(value) === 4 && value.startsWith('127.')) || (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 && value.slice(7).startsWith('127.'));
const localHost = (value: string) => {
  try { const hostname = new URL(`http://${value}`).hostname; return loopback(hostname.replace(/^\[|\]$/g, '')); } catch { return false; }
};
export function isLocalRequest(req: IncomingMessage): boolean {
  if (!loopback(req.socket.remoteAddress ?? '') || !req.headers.host || !localHost(req.headers.host)) return false;
  if (req.headers.forwarded || req.headers['x-original-host']) return false;
  for (const name of ['x-forwarded-host', 'x-forwarded-for']) {
    const value = req.headers[name];
    if (value && (Array.isArray(value) ? value : value.split(',')).some(entry => name === 'x-forwarded-host' ? !localHost(entry.trim()) : !loopback(entry.trim()))) return false;
  }
  if (req.headers.origin) {
    try { if (!localHost(new URL(req.headers.origin).host)) return false; } catch { return false; }
  }
  return true;
}

export class SlidingWindowLimits {
  private windows = new Map<string, { count: number; expires: number }>();
  constructor(private now: () => number = Date.now) {}
  allow(key: string, max: number, windowMs: number): boolean {
    const now = this.now();
    for (const [key, value] of this.windows) if (value.expires <= now) this.windows.delete(key);
    let value = this.windows.get(key);
    if (!value) {
      if (this.windows.size >= 4096) return false;
      this.windows.set(key, value = { count: 0, expires: now + windowMs });
    }
    return ++value.count <= max;
  }
}

export function attachSocketHandlers(io: Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>, rooms: RoomManager, limits: SlidingWindowLimits): void {
  const broadcast = (roomId: string, state?: RoomSnapshot) => { const snapshot = state ?? rooms.snapshot(roomId); if (snapshot) io.to(roomId).emit('room:state', snapshot); };
  io.on('connection', socket => {
    const cursorLimits = new SlidingWindowLimits();
    const noteLimits = new SlidingWindowLimits();
    const updateNote = (payload: NotePayload, ack: NoteAckCallback, sync: boolean) => {
      if (typeof ack !== 'function') return;
      const identity = socket.data.identity;
      if (!identity || !rooms.active(identity)) { ack({ ok: false, code: 'UNAUTHORIZED', message: 'Join the room before editing the notepad.' }); return; }
      if (!noteLimits.allow('notepad', 40, 1000)) { ack({ ok: false, code: 'RATE_LIMITED', message: 'Notepad sync is catching up. Please wait a moment.' }); return; }
      const parsed = noteUpdateSchema.safeParse(payload);
      if (!parsed.success) { ack({ ok: false, code: 'INVALID_PAYLOAD', message: 'This notepad update contains invalid data.' }); return; }
      const result = rooms.updateNotepad(identity, parsed.data.update, sync);
      if (result.ok) socket.to(identity.roomId).emit('note:update', { roomId: identity.roomId, update: parsed.data.update });
      ack(result);
    };
    socket.on('note:sync', (payload, ack) => updateNote(payload, ack, true));
    socket.on('note:update', (payload, ack) => updateNote(payload, ack, false));
    socket.on('cursor:move', position => {
      const identity = socket.data.identity;
      if (!identity || !rooms.active(identity)) return;
      if (!cursorLimits.allow('cursor', 40, 1000)) return;
      const parsed = cursorPositionSchema.safeParse(position);
      if (!parsed.success) return;
      const cursor = { roomId: identity.roomId, role: identity.role, position: parsed.data };
      if (parsed.data === null) socket.to(identity.roomId).emit('cursor:state', cursor);
      else socket.to(identity.roomId).volatile.emit('cursor:state', cursor);
    });
    socket.onAny((event: string, ...args: unknown[]) => {
      if (event === 'cursor:move' || event === 'note:sync' || event === 'note:update') return;
      const candidate = args[args.length - 1];
      const ack: AckCallback = typeof candidate === 'function' ? candidate as AckCallback : () => undefined;
      const reject = (code: string, message: string) => { ack({ ok: false, code, message }); };
      if (!Object.hasOwn(schemas, event)) { reject('UNKNOWN_EVENT', 'Unsupported room action.'); return; }
      const name = event as keyof ClientPayloads;
      const parsed = schemas[name].safeParse(args[0]);
      if (!parsed.success || args.length > 2) { reject('INVALID_PAYLOAD', 'This action contains invalid data.'); return; }
      const ip = socket.request.socket.remoteAddress ?? 'unknown';
      if (name === 'room:join') {
        if (!limits.allow(`join:${ip}`, 30, 60_000)) { reject('RATE_LIMITED', 'Too many join attempts. Please wait a minute.'); return; }
        const data = parsed.data as ClientPayloads['room:join'];
        const joined = rooms.join(data.roomId, data.credential, data.displayName, socket.id);
        if (!joined) { reject('UNAUTHORIZED', 'The room or invitation is invalid or expired.'); return; }
        const previous = socket.data.identity;
        if (previous && (previous.roomId !== joined.identity.roomId || previous.role !== joined.identity.role)) {
          socket.to(previous.roomId).emit('cursor:state', { roomId: previous.roomId, role: previous.role, position: null });
          rooms.leave(previous); void socket.leave(previous.roomId); broadcast(previous.roomId);
        }
        socket.data.identity = joined.identity;
        if (joined.replaced) {
          const previousSocket = io.sockets.sockets.get(joined.replaced);
          previousSocket?.emit('room:replaced', { message: 'Another tab or device joined as you. Continue listening there.' });
          previousSocket?.disconnect(true);
        }
        void socket.join(data.roomId);
        socket.to(data.roomId).emit('cursor:state', { roomId: data.roomId, role: joined.identity.role, position: null });
        broadcast(data.roomId);
        ack({ ok: true, state: rooms.snapshot(data.roomId) });
        return;
      }
      const identity = socket.data.identity;
      if (!identity || !rooms.active(identity)) { reject('UNAUTHORIZED', 'Join the room before sending actions.'); return; }
      const category = name === 'queue:add' || name === 'queue:import' ? 'queue' : name === 'sync:ping' ? 'ping' : 'control';
      const max = category === 'queue' ? 12 : category === 'ping' ? 120 : 60;
      if (!limits.allow(`${identity.roomId}:${identity.role}:${category}`, max, 60_000)) { reject('RATE_LIMITED', 'Please slow down and try again shortly.'); return; }
      if (name === 'sync:ping') {
        const state = rooms.snapshot(identity.roomId);
        ack({ ok: true, state, serverNowMs: state?.serverNowMs }); return;
      }
      if (name === 'room:leave') {
        socket.to(identity.roomId).emit('cursor:state', { roomId: identity.roomId, role: identity.role, position: null });
        rooms.leave(identity); delete socket.data.identity; void socket.leave(identity.roomId); broadcast(identity.roomId);
        ack({ ok: true, state: rooms.snapshot(identity.roomId) }); return;
      }
      void rooms.dispatch(identity, name, parsed.data as ClientPayloads[Exclude<keyof ClientPayloads, 'room:join' | 'room:leave' | 'sync:ping'>]).then((result: Ack) => {
        if (result.ok) broadcast(identity.roomId, result.state);
        ack(result);
      });
    });
    socket.on('disconnect', () => {
      const identity = socket.data.identity;
      if (identity && rooms.active(identity)) {
        socket.to(identity.roomId).emit('cursor:state', { roomId: identity.roomId, role: identity.role, position: null });
        rooms.leave(identity); broadcast(identity.roomId);
      }
    });
  });
}
