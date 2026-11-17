import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { selectClockOffset } from '../shared/playback-math';
import { connectNotepad, type NotepadStatus } from '../lib/shared-notepad';
import { cursorPositionSchema, type Ack, type AckCallback, type ClientEvents, type ClientPayloads, type CursorPosition, type RoomCursor, type RoomSnapshot, type SendCommand, type ServerEvents } from '../shared/protocol';

type RoomAccess = { roomId: string; credential: string; displayName: string };
export type RoomConnectionState = {
  snapshot: RoomSnapshot | null;
  connection: 'connecting' | 'online' | 'offline' | 'ended' | 'replaced';
  error: string | null;
  offsetMs: number;
  cursor?: RoomCursor;
  notepadStatus?: NotepadStatus;
};

const initialState: RoomConnectionState = { snapshot: null, connection: 'connecting', error: null, offsetMs: 0 };
const offlineAck: Ack = { ok: false, code: 'OFFLINE', message: 'Reconnect before changing the room.' };

export function connectRoomSocket(
  access: RoomAccess,
  onChange: (state: RoomConnectionState) => void,
  socket: Socket<ServerEvents, ClientEvents> = io({ autoConnect: false }),
) {
  let state = { ...initialState };
  let closed = false;
  let joined = false;
  let generation = 0;
  let calibrationTimer: ReturnType<typeof setInterval> | undefined;
  let cursorSendTimer: ReturnType<typeof setTimeout> | undefined;
  let cursorExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  let cursorHeartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let cursorPosition: CursorPosition = null;
  let lastCursorSentAt = 0;
  const pending = new Set<(result: Ack) => void>();
  const update = (patch: Partial<RoomConnectionState>) => {
    state = { ...state, ...patch };
    if (!closed) onChange(state);
  };
  const notepad = connectNotepad(socket, access.roomId, notepadStatus => update({ notepadStatus }));
  const applySnapshot = (snapshot: RoomSnapshot) => {
    if (snapshot.roomId !== access.roomId || (state.snapshot && snapshot.revision < state.snapshot.revision)) return;
    const cursor = state.cursor && snapshot.participants.some(person => person.role === state.cursor?.role && person.online) ? state.cursor : undefined;
    update({ snapshot, cursor });
  };
  const clearCursor = () => {
    clearTimeout(cursorSendTimer);
    clearTimeout(cursorExpiryTimer);
    clearInterval(cursorHeartbeatTimer);
    cursorPosition = null;
    cursorSendTimer = undefined;
    update({ cursor: undefined });
  };
  const emitCursor = () => {
    clearTimeout(cursorSendTimer);
    cursorSendTimer = undefined;
    if (!joined || closed || !socket.connected) return;
    lastCursorSentAt = Date.now();
    socket.volatile.emit('cursor:move', cursorPosition);
  };
  const sendCursor = (position: CursorPosition) => {
    if (!joined || closed || !socket.connected) return;
    cursorPosition = position;
    clearTimeout(cursorSendTimer);
    const delay = position === null ? 0 : Math.max(0, 50 - (Date.now() - lastCursorSentAt));
    if (delay === 0) emitCursor();
    else cursorSendTimer = setTimeout(emitCursor, delay);
  };
  const stop = (connection: 'ended' | 'replaced', error: string) => {
    joined = false;
    generation++;
    clearInterval(calibrationTimer);
    clearCursor();
    notepad.disconnect();
    update({ connection, error });
    socket.disconnect();
  };

  const emit: SendCommand = (event, payload) => new Promise<Ack>(resolve => {
    if (closed || !socket.connected) { resolve(offlineAck); return; }
    const finish = (result: Ack) => {
      clearTimeout(timeout);
      pending.delete(finish);
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ ok: false, code: 'ACK_TIMEOUT', message: 'The server did not confirm this change. Check the room before trying again.' }), 6000);
    pending.add(finish);
    // Volatile emits also close the disconnect race without buffering stale intents.
    const target = event === 'room:join' || event === 'sync:ping' ? socket : socket.volatile;
    const emitEvent = target.emit as (name: keyof ClientPayloads, data: ClientPayloads[keyof ClientPayloads], ack: AckCallback) => void;
    emitEvent.call(socket, event, payload, finish);
  });

  const send: SendCommand = async (event, payload) => {
    if (!joined || closed || !socket.connected) return offlineAck;
    const result = await emit(event, payload);
    if (closed || !joined) return result;
    if (result.ok) {
      if (result.state) applySnapshot(result.state);
      update({ error: null });
    } else update({ error: result.message });
    return result;
  };

  const calibrate = async (activeGeneration: number) => {
    const samples: Array<{ clientSentAtMs: number; clientReceivedAtMs: number; serverNowMs: number }> = [];
    for (let index = 0; index < 3; index++) {
      if (!joined || generation !== activeGeneration || closed) return;
      const clientSentAtMs = Date.now();
      const result = await emit('sync:ping', { clientSentAtMs });
      const clientReceivedAtMs = Date.now();
      if (result.ok && result.serverNowMs !== undefined) samples.push({ clientSentAtMs, clientReceivedAtMs, serverNowMs: result.serverNowMs });
    }
    if (samples.length && joined && generation === activeGeneration && !closed) update({ offsetMs: selectClockOffset(samples) });
  };

  socket.on('connect', async () => {
    const activeGeneration = ++generation;
    joined = false;
    update({ connection: 'connecting', error: null });
    const clientSentAtMs = Date.now();
    const result = await emit('room:join', access);
    const clientReceivedAtMs = Date.now();
    if (closed || activeGeneration !== generation || !socket.connected) return;
    if (!result.ok) {
      if (result.code === 'ACK_TIMEOUT') {
        socket.disconnect();
        socket.connect();
        return;
      }
      stop('ended', result.message);
      return;
    }
    if (!result.state) {
      stop('ended', 'The room could not be restored. Please open your invitation again.');
      return;
    }
    applySnapshot(result.state);
    joined = true;
    update({
      connection: 'online', error: null,
      offsetMs: result.state.serverNowMs - (clientSentAtMs + clientReceivedAtMs) / 2,
    });
    notepad.sync();
    clearInterval(cursorHeartbeatTimer);
    cursorHeartbeatTimer = setInterval(() => { if (cursorPosition) emitCursor(); }, 1000);
    void calibrate(activeGeneration);
    clearInterval(calibrationTimer);
    calibrationTimer = setInterval(() => { void calibrate(activeGeneration); }, 30_000);
  });
  socket.on('room:state', snapshot => {
    if (state.connection !== 'ended' && state.connection !== 'replaced') applySnapshot(snapshot);
  });
  socket.on('cursor:state', cursor => {
    if (!joined || cursor.roomId !== access.roomId || !state.snapshot?.participants.some(person => person.role === cursor.role && person.online)) return;
    const parsed = cursorPositionSchema.safeParse(cursor.position);
    if (!parsed.success) return;
    clearTimeout(cursorExpiryTimer);
    update({ cursor: parsed.data === null ? undefined : { ...cursor, position: parsed.data } });
    if (parsed.data) cursorExpiryTimer = setTimeout(() => update({ cursor: undefined }), 3500);
  });
  socket.on('room:replaced', notice => stop('replaced', notice.message));
  socket.on('room:error', error => {
    if (['ROOM_NOT_FOUND', 'ROOM_EXPIRED', 'INVALID_CREDENTIAL', 'UNAUTHORIZED'].includes(error.code)) stop('ended', error.message);
    else update({ error: error.message });
  });
  socket.on('disconnect', () => {
    joined = false;
    generation++;
    clearInterval(calibrationTimer);
    clearCursor();
    notepad.disconnect();
    for (const finish of pending) finish(offlineAck);
    if (state.connection !== 'ended' && state.connection !== 'replaced') update({ connection: 'offline', error: 'Connection lost. Trying to reconnect…' });
  });
  socket.on('connect_error', () => update({ connection: 'offline', error: 'Cannot reach the room. Trying to reconnect…' }));
  socket.connect();

  return {
    send,
    sendCursor,
    notepad,
    close: () => {
      closed = true;
      joined = false;
      generation++;
      clearInterval(calibrationTimer);
      clearCursor();
      notepad.close();
      for (const finish of pending) finish(offlineAck);
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}

export function useRoomSocket({ roomId, credential, displayName }: RoomAccess) {
  const [state, setState] = useState<RoomConnectionState>(initialState);
  const connection = useRef<ReturnType<typeof connectRoomSocket> | null>(null);
  useEffect(() => {
    setState(initialState);
    const current = connectRoomSocket({ roomId, credential, displayName }, setState);
    connection.current = current;
    return () => { connection.current = null; current.close(); };
  }, [roomId, credential, displayName]);
  const send = useCallback<SendCommand>((event, payload) => connection.current?.send(event, payload) ?? Promise.resolve(offlineAck), []);
  const sendCursor = useCallback((position: CursorPosition) => connection.current?.sendCursor(position), []);
  return { ...state, send, sendCursor, notepad: connection.current?.notepad };
}
