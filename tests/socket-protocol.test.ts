import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server/app';
import type { VideoStatusService } from '../server/youtube-video-status';
import type { Ack, ClientEvents, RoomCredentials, RoomSnapshot, ServerEvents } from '../src/shared/protocol';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function setup(videoStatus: VideoStatusService = { check: async (_id: string) => ({ madeForKids: false, title: 'A song for us' }) }) {
  const app = createApplication({ videoStatus });
  await new Promise<void>(resolve => app.httpServer.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => app.close());
  const address = app.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No listening address');
  const origin = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${origin}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(response.status).toBe(201);
  const credentials = await response.json() as RoomCredentials;
  async function connect(credential: string, displayName: string) {
    const socket: Socket<ServerEvents, ClientEvents> = io(origin, { transports: ['websocket'], autoConnect: false, reconnection: false });
    cleanup.push(() => { socket.disconnect(); });
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    const result = await socket.timeout(2500).emitWithAck('room:join', { roomId: credentials.roomId, credential, displayName });
    return { socket, result };
  }
  return { app, origin, credentials, connect };
}

function state(result: Ack): RoomSnapshot {
  if (!result.ok || !result.state) throw new Error(`Missing snapshot: ${result.ok ? 'empty' : result.code}`);
  return result.state;
}
function requestId() { return randomUUID(); }

describe('real Socket.IO room protocol', () => {
  it('authenticates two roles, shares an ordered queue and rejects a stranger without state', async () => {
    const { credentials, connect } = await setup();
    expect(credentials.hostSecret.length).toBeGreaterThanOrEqual(32);
    expect(credentials.guestSecret === credentials.hostSecret).toBe(false);
    const host = await connect(credentials.hostSecret, 'Host');
    const guest = await connect(credentials.guestSecret, 'Guest');
    const stranger = await connect('x'.repeat(32), 'Stranger');
    expect(stranger.result.ok).toBe(false);
    expect('state' in stranger.result).toBe(false);
    expect(state(guest.result).participants.filter(person => person.online)).toHaveLength(2);
    const guestState = new Promise<RoomSnapshot>(resolve => guest.socket.once('room:state', resolve));
    const added = await host.socket.emitWithAck('queue:add', { url: 'https://youtu.be/dQw4w9WgXcQ', requestId: requestId() });
    const broadcast = await guestState;
    expect(broadcast).toEqual(state(added));
    expect(broadcast.queue.map(item => item.addedBy)).toEqual(['host']);
    expect(JSON.stringify(broadcast).includes(credentials.hostSecret)).toBe(false);
    expect(JSON.stringify(broadcast).includes(credentials.guestSecret)).toBe(false);
    const second = await guest.socket.emitWithAck('queue:add', { url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk', requestId: requestId() });
    expect(state(second).queue.map(item => item.addedBy)).toEqual(['host', 'guest']);
  });

  it('deduplicates retries, rejects stale NEXT and advances once when both players end', async () => {
    const { credentials, connect } = await setup();
    const host = await connect(credentials.hostSecret, 'Host');
    const guest = await connect(credentials.guestSecret, 'Guest');
    const add = { url: 'https://youtu.be/dQw4w9WgXcQ', requestId: requestId() };
    const first = state(await host.socket.emitWithAck('queue:add', add));
    const repeated = state(await host.socket.emitWithAck('queue:add', add));
    expect(repeated.queue).toHaveLength(1);
    expect(repeated.revision).toBe(first.revision);
    await host.socket.emitWithAck('queue:add', { url: 'https://youtu.be/jfKfPfyJRdk', requestId: requestId() });
    const play = state(await host.socket.emitWithAck('playback:control', { action: 'PLAY', expectedPlaybackRevision: first.playback.revision, requestId: requestId() }));
    const ended = { videoId: play.playback.videoId!, playbackRevision: play.playback.revision };
    const next = state(await host.socket.emitWithAck('playback:ended', ended));
    await guest.socket.emitWithAck('playback:ended', ended);
    const pingJoin = await guest.socket.emitWithAck('room:join', { roomId: credentials.roomId, credential: credentials.guestSecret, displayName: 'Guest' });
    expect(state(pingJoin).playback.currentQueueItemId).toBe(next.playback.currentQueueItemId);
    expect(state(pingJoin).playback.revision).toBe(next.playback.revision);
    const stale = await host.socket.emitWithAck('playback:control', { action: 'NEXT', expectedPlaybackRevision: play.playback.revision, requestId: requestId() });
    expect(stale.ok).toBe(false);
  });

  it('replaces the old role and restores canonical state after disconnect/rejoin', async () => {
    const { credentials, connect } = await setup();
    const host = await connect(credentials.hostSecret, 'Host');
    const guest = await connect(credentials.guestSecret, 'Guest');
    const replaced = new Promise<void>(resolve => guest.socket.once('room:replaced', () => resolve()));
    const newGuest = await connect(credentials.guestSecret, 'Guest again');
    await replaced;
    expect(state(newGuest.result).participants.find(person => person.role === 'guest')?.displayName).toBe('Guest again');
    await host.socket.emitWithAck('queue:add', { url: 'https://youtu.be/dQw4w9WgXcQ', requestId: requestId() });
    newGuest.socket.disconnect();
    const recovered = await connect(credentials.guestSecret, 'Guest again');
    expect(state(recovered.result).queue).toHaveLength(1);
    expect(state(recovered.result).participants.filter(person => person.online)).toHaveLength(2);
  });

  it('serializes asynchronous video checks before later controls without blocking another room', async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const { credentials, connect } = await setup({ check: async () => { await waiting; return { madeForKids: true, title: null }; } });
    const host = await connect(credentials.hostSecret, 'Host');
    const add = host.socket.emitWithAck('queue:add', { url: 'https://youtu.be/dQw4w9WgXcQ', requestId: requestId() });
    const ping = await host.socket.emitWithAck('sync:ping', { clientSentAtMs: Date.now() });
    expect(ping.ok).toBe(true);
    release();
    const result = state(await add);
    expect(result.queue[0].madeForKids).toBe(true);
    const removed = await host.socket.emitWithAck('queue:remove', { itemId: result.queue[0].id, expectedRevision: 0, requestId: requestId() });
    expect(removed.ok).toBe(false);
  });
});
