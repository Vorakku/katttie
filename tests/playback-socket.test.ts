import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import { connectRoomSocket, type RoomConnectionState } from '../src/hooks/useRoomSocket';
import type { ClientEvents, RoomSnapshot, ServerEvents } from '../src/shared/protocol';

const credentials = { roomId: 'room-id-123456789', credential: 'c'.repeat(40), displayName: 'Sam' };
function snapshot(revision: number): RoomSnapshot {
  return { roomId: credentials.roomId, revision, queue: [], playback: { currentQueueItemId: null, videoId: null, status: 'paused', anchorPositionSec: 0, anchorServerTimeMs: Date.now(), revision: 0 }, participants: [], serverNowMs: Date.now(), prototypeMode: true };
}
let http: HttpServer;
let server: Server<ClientEvents, ServerEvents>;
const cleanups: Array<() => void> = [];
afterEach(async () => { cleanups.splice(0).forEach(close => close()); await new Promise<void>(resolve => server?.close(() => resolve())); http?.close(); });
async function setup() {
  http = createServer();
  server = new Server(http);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  const socket = io(`http://127.0.0.1:${address.port}`, { autoConnect: false, reconnectionDelay: 10 });
  let view: RoomConnectionState = { snapshot: null, connection: 'connecting', error: null, offsetMs: 0 };
  const connection = connectRoomSocket(credentials, update => { view = update; }, socket);
  cleanups.push(connection.close);
  return { socket, connection, getView: () => view };
}
async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for socket state');
}

describe('room socket lifecycle', () => {
  it('joins, calibrates three samples, and ignores stale snapshots including ack state', async () => {
    let pings = 0;
    const test = await setup();
    server.on('connection', socket => {
      socket.on('room:join', (payload, ack) => { expect(payload).toEqual(credentials); ack({ ok: true, state: snapshot(5) }); });
      socket.on('sync:ping', (_payload, ack) => { pings++; ack({ ok: true, serverNowMs: Date.now() + 1000 }); });
      socket.on('queue:add', (_payload, ack) => { socket.emit('room:state', snapshot(7)); ack({ ok: true, state: snapshot(6) }); });
    });
    await until(() => test.getView().connection === 'online' && pings === 3);
    const ack = await test.connection.send('queue:add', { url: 'https://youtu.be/abcdefghijk', requestId: crypto.randomUUID() });
    expect(ack.ok).toBe(true);
    expect(test.getView().snapshot?.revision).toBe(7);
    expect(test.getView().offsetMs).toBeGreaterThan(900);
  });

  it('rejects offline controls without replaying them after reconnect', async () => {
    const test = await setup();
    let controls = 0;
    server.on('connection', socket => {
      socket.on('room:join', (_payload, ack) => ack({ ok: true, state: snapshot(1) }));
      socket.on('sync:ping', (_payload, ack) => ack({ ok: true, serverNowMs: Date.now() }));
      socket.on('playback:control', (_payload, ack) => { controls++; ack({ ok: true }); });
    });
    await until(() => test.getView().connection === 'online');
    test.socket.disconnect();
    const result = await test.connection.send('playback:control', { action: 'PLAY', expectedPlaybackRevision: 0, requestId: crypto.randomUUID() });
    expect(result.ok).toBe(false);
    test.socket.connect();
    await until(() => test.getView().connection === 'online');
    expect(controls).toBe(0);
  });

  it('stops reconnecting when this role is replaced', async () => {
    const test = await setup();
    server.on('connection', socket => {
      socket.on('room:join', (_payload, ack) => { ack({ ok: true, state: snapshot(1) }); socket.emit('room:replaced', { message: 'This seat is open in another tab.' }); });
      socket.on('sync:ping', (_payload, ack) => ack({ ok: true, serverNowMs: Date.now() }));
    });
    await until(() => test.getView().connection === 'replaced');
    expect(test.socket.connected).toBe(false);
    expect(test.getView().error).toContain('another tab');
  });

  it('shows an expired or invalid invitation as a terminal room state', async () => {
    const test = await setup();
    server.on('connection', socket => {
      socket.on('room:join', (_payload, ack) => ack({ ok: false, code: 'UNAUTHORIZED', message: 'This room or invitation is no longer available.' }));
    });
    await until(() => test.getView().connection === 'ended');
    expect(test.socket.connected).toBe(false);
    expect(test.getView().error).toContain('no longer available');
  });

  it('surfaces an ack timeout without automatically replaying a control', async () => {
    const test = await setup();
    let controls = 0;
    server.on('connection', socket => {
      socket.on('room:join', (_payload, ack) => ack({ ok: true, state: snapshot(1) }));
      socket.on('sync:ping', (_payload, ack) => ack({ ok: true, serverNowMs: Date.now() }));
      socket.on('playback:control', () => { controls++; });
    });
    await until(() => test.getView().connection === 'online');
    const result = await test.connection.send('playback:control', { action: 'PLAY', expectedPlaybackRevision: 0, requestId: crypto.randomUUID() });
    expect(result).toMatchObject({ ok: false, code: 'ACK_TIMEOUT' });
    expect(test.getView().error).toContain('did not confirm');
    expect(controls).toBe(1);
  });

  it('rejoins after an unconfirmed handshake instead of declaring the room ended', async () => {
    const test = await setup();
    let joins = 0;
    server.on('connection', socket => {
      socket.on('room:join', (_payload, ack) => {
        joins++;
        if (joins > 1) ack({ ok: true, state: snapshot(3) });
      });
      socket.on('sync:ping', (_payload, ack) => ack({ ok: true, serverNowMs: Date.now() }));
    });
    await new Promise(resolve => setTimeout(resolve, 6100));
    await until(() => test.getView().connection === 'online');
    expect(test.getView().snapshot?.revision).toBe(3);
    expect(joins).toBe(2);
  });
});
