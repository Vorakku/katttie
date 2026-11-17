import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createApplication } from '../server/app';
import { YouTubeVideoStatusService } from '../server/youtube-video-status';
import type { Ack, RoomCredentials, RoomSnapshot } from '../src/shared/protocol';

const cleanup: Array<() => Promise<void> | void> = [];
const socketOnce = (socket: Socket, event: string) => new Promise<unknown[]>(resolve => socket.once(event, (...args: unknown[]) => resolve(args)));
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(options: Parameters<typeof createApplication>[0] = {}) {
  const application = createApplication({ videoStatus: { check: async () => ({ madeForKids: false, title: null }) }, ...options });
  application.httpServer.listen(0, '127.0.0.1');
  await once(application.httpServer, 'listening');
  cleanup.push(() => application.close());
  const address = application.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  const base = `http://127.0.0.1:${address.port}`;
  const credentials = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json()) as RoomCredentials;
  async function connect(secret = credentials.hostSecret) {
    const socket = io(base, { transports: ['websocket'], forceNew: true });
    cleanup.push(() => { socket.disconnect(); });
    await socketOnce(socket, 'connect');
    const joined = await command(socket, 'room:join', { roomId: credentials.roomId, credential: secret, displayName: ' Listener ' });
    return { socket, joined };
  }
  return { ...application, base, credentials, connect };
}
const command = (socket: Socket, event: string, payload: unknown) => socket.timeout(2000).emitWithAck(event, payload) as Promise<Ack>;
function state(ack: Ack): RoomSnapshot { if (!ack.ok || !ack.state) throw new Error(JSON.stringify(ack)); return ack.state; }
const add = (socket: Socket, video = 'dQw4w9WgXcQ', requestId = randomUUID()) => command(socket, 'queue:add', { url: `https://youtu.be/${video}`, requestId });
const control = (socket: Socket, s: RoomSnapshot, action: string, requestId = randomUUID(), positionSec?: number) => command(socket, 'playback:control', { action, expectedPlaybackRevision: s.playback.revision, requestId, ...(positionSec === undefined ? {} : { positionSec }) });

describe('private authoritative room server', () => {
  it('creates separate high entropy credentials and serves secret-free health and secure headers', async () => {
    const f = await fixture();
    expect(f.credentials.roomId.length).toBeGreaterThanOrEqual(24);
    expect(f.credentials.hostSecret.length).toBeGreaterThanOrEqual(32);
    expect(f.credentials.guestSecret).not.toBe(f.credentials.hostSecret);
    const response = await fetch(`${f.base}/api/health`);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('content-security-policy')).toContain('https://www.youtube.com');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('authenticates two roles, validates schemas, hides credentials, and replaces the older role', async () => {
    const f = await fixture();
    const host = await f.connect();
    const guest = await f.connect(f.credentials.guestSecret);
    expect(state(guest.joined).participants.every(p => p.online)).toBe(true);
    expect(JSON.stringify(state(guest.joined))).not.toContain(f.credentials.hostSecret);
    expect((await f.connect('x'.repeat(32))).joined).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    expect(await command(host.socket, 'queue:add', { url: 'https://youtu.be/dQw4w9WgXcQ', role: 'host', requestId: randomUUID() })).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' });
    const replaced = socketOnce(host.socket, 'room:replaced');
    const newcomer = await f.connect();
    await replaced;
    expect(host.socket.connected).toBe(false);
    expect(state(newcomer.joined).participants.filter(p => p.online)).toHaveLength(2);
  });

  it('keeps anchor math authoritative, deduplicates additions and next, and ends only once', async () => {
    let now = 1000;
    const f = await fixture({ now: () => now });
    const { socket } = await f.connect();
    const id = randomUUID();
    let s = state(await add(socket, undefined, id));
    expect(s.playback.status).toBe('paused');
    expect(state(await add(socket, undefined, id)).queue).toHaveLength(1);
    s = state(await add(socket, 'aaaaaaaaaaa'));
    s = state(await control(socket, s, 'PLAY'));
    now = 4500;
    s = state(await control(socket, s, 'PAUSE'));
    expect(s.playback.anchorPositionSec).toBe(3.5);
    s = state(await control(socket, s, 'SEEK', randomUUID(), 60));
    expect(s.playback.anchorPositionSec).toBe(60);
    const nextId = randomUUID();
    const beforeNext = s;
    s = state(await control(socket, beforeNext, 'NEXT', nextId));
    expect(s.playback.videoId).toBe('aaaaaaaaaaa');
    expect(state(await control(socket, beforeNext, 'NEXT', nextId)).playback.revision).toBe(s.playback.revision);
    expect(await control(socket, beforeNext, 'PLAY')).toMatchObject({ ok: false, code: 'STALE_REVISION' });
    s = state(await control(socket, s, 'PLAY'));
    const ended = { videoId: s.playback.videoId, playbackRevision: s.playback.revision };
    s = state(await command(socket, 'playback:ended', ended));
    expect(s.playback.status).toBe('paused');
    expect(state(await command(socket, 'playback:ended', ended)).playback.revision).toBe(s.playback.revision);
  });

  it('pauses on removing the selected item, rejects stale destructive operations and restores on reconnect', async () => {
    const f = await fixture();
    const { socket } = await f.connect();
    await add(socket);
    let s = state(await add(socket, 'aaaaaaaaaaa'));
    s = state(await control(socket, s, 'PLAY'));
    expect(await command(socket, 'queue:remove', { itemId: s.queue[0].id, expectedRevision: 0, requestId: randomUUID() })).toMatchObject({ ok: false, code: 'STALE_REVISION' });
    s = state(await command(socket, 'queue:remove', { itemId: s.queue[0].id, expectedRevision: s.revision, requestId: randomUUID() }));
    expect(s.playback.videoId).toBe('aaaaaaaaaaa');
    expect(s.playback.status).toBe('paused');
    socket.disconnect();
    expect(state((await f.connect()).joined).queue).toHaveLength(1);
  });

  it('serializes slow video lookups before later controls and blocks superseded pending changes', async () => {
    let resolve!: (value: { madeForKids: boolean; title: null }) => void;
    const f = await fixture({ videoStatus: { check: () => new Promise(r => { resolve = r; }) } });
    const host = await f.connect();
    const pendingAdd = add(host.socket);
    await new Promise(r => setTimeout(r, 30));
    const pendingPlay = control(host.socket, state(host.joined), 'PLAY');
    resolve({ madeForKids: false, title: null });
    expect(state(await pendingAdd).queue).toHaveLength(1);
    expect(await pendingPlay).toMatchObject({ ok: false, code: 'STALE_REVISION' });
    const invalidated = add(host.socket, 'aaaaaaaaaaa').catch(() => null);
    await new Promise(r => setTimeout(r, 30));
    const fresh = await f.connect();
    resolve({ madeForKids: false, title: null });
    await invalidated;
    expect(state(await command(fresh.socket, 'sync:ping', { clientSentAtMs: 0 })).queue).toHaveLength(1);
  });

  it('fails closed without a public API key and rejects external host/forwarded access in prototype mode', async () => {
    const f = await fixture({ videoStatus: undefined, youtubeApiKey: '', prototypeMode: false });
    expect(await add((await f.connect()).socket)).toMatchObject({ ok: false, code: 'VIDEO_STATUS_UNAVAILABLE' });
    const local = await fixture({ videoStatus: undefined, youtubeApiKey: '', prototypeMode: true });
    expect(state(await add((await local.connect()).socket)).prototypeMode).toBe(true);
    const hostStatus = await new Promise(resolve => { const req = request(`${local.base}/api/health`, { headers: { Host: 'public.ngrok-free.app' } }, response => { response.resume(); resolve(response.statusCode); }); req.end(); });
    expect(hostStatus).toBe(403);
    expect((await fetch(`${local.base}/api/health`, { headers: { 'x-forwarded-host': 'public.ngrok-free.app' } })).status).toBe(403);
    const outsider = io(local.base, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { 'x-forwarded-for': '8.8.8.8' } });
    cleanup.push(() => { outsider.disconnect(); });
    const [error] = await socketOnce(outsider, 'connect_error');
    expect(error).toBeDefined();
  });

  it('enforces queue and room bounds and expires empty rooms', async () => {
    let now = 0;
    const f = await fixture({ maxRooms: 1, maxQueueLength: 1, now: () => now });
    expect((await fetch(`${f.base}/api/rooms`, { method: 'POST' })).status).toBe(503);
    const { socket } = await f.connect();
    await add(socket);
    expect(await add(socket, 'aaaaaaaaaaa')).toMatchObject({ ok: false, code: 'QUEUE_FULL' });
    await command(socket, 'room:leave', {});
    now = 12 * 60 * 60 * 1000 + 1;
    f.rooms.cleanup();
    expect(f.rooms.snapshot(f.credentials.roomId)).toBeUndefined();
  });

  it('bounds pending work and serializes controls behind a status lookup', async () => {
    let release!: (value: { madeForKids: boolean; title: null }) => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    const f = await fixture({ maxPendingIntents: 1, videoStatus: { check: () => { started(); return new Promise(resolve => { release = resolve; }); } } });
    const host = await f.connect();
    const pending = add(host.socket);
    await waiting;
    expect(await control(host.socket, state(host.joined), 'PLAY')).toMatchObject({ ok: false, code: 'BUSY' });
    // Clock samples must stay responsive while the external lookup is pending.
    expect(await command(host.socket, 'sync:ping', { clientSentAtMs: 0 })).toMatchObject({ ok: true });
    release({ madeForKids: false, title: null });
    expect(state(await pending).queue).toHaveLength(1);
  });

  it('limits join attempts, queue submissions, controls and room creation', async () => {
    const f = await fixture();
    const host = await f.connect();
    for (let i = 0; i < 12; i++) await add(host.socket);
    expect(await add(host.socket)).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    for (let i = 0; i < 60; i++) await control(host.socket, state(host.joined), 'PLAY');
    expect(await control(host.socket, state(host.joined), 'PLAY')).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    const join = { roomId: f.credentials.roomId, credential: 'x'.repeat(43), displayName: 'Unknown' };
    for (let i = 0; i < 29; i++) await command(host.socket, 'room:join', join);
    expect(await command(host.socket, 'room:join', join)).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    for (let i = 0; i < 19; i++) await fetch(`${f.base}/api/rooms`, { method: 'POST' });
    expect((await fetch(`${f.base}/api/rooms`, { method: 'POST' })).status).toBe(429);
  });

  it('rejects multibyte credentials, unknown events, conflicting retries and cross-origin creation', async () => {
    const f = await fixture();
    expect((await f.connect('é'.repeat(43))).joined).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    const host = await f.connect();
    expect(await command(host.socket, 'made:up', {})).toMatchObject({ ok: false, code: 'UNKNOWN_EVENT' });
    const requestId = randomUUID();
    await add(host.socket, 'dQw4w9WgXcQ', requestId);
    expect(await add(host.socket, 'aaaaaaaaaaa', requestId)).toMatchObject({ ok: false, code: 'REQUEST_CONFLICT' });
    expect((await fetch(`${f.base}/api/rooms`, { method: 'POST', headers: { Origin: 'https://untrusted.example' } })).status).toBe(403);
    expect((await fetch(`${f.base}/api/rooms`, { method: 'POST', headers: { Origin: 'not a URL' } })).status).toBe(403);
  });

  it('selects a queue item paused, keeps playback on other removals, and clears the final removal', async () => {
    const f = await fixture();
    const { socket } = await f.connect();
    await add(socket);
    let s = state(await add(socket, 'aaaaaaaaaaa'));
    s = state(await command(socket, 'queue:select', { itemId: s.queue[1].id, expectedRevision: s.revision, requestId: randomUUID() }));
    expect(s.playback.videoId).toBe('aaaaaaaaaaa');
    expect(s.playback.status).toBe('paused');
    s = state(await control(socket, s, 'PLAY'));
    const playbackRevision = s.playback.revision;
    s = state(await command(socket, 'queue:remove', { itemId: s.queue[0].id, expectedRevision: s.revision, requestId: randomUUID() }));
    expect(s.playback.status).toBe('playing');
    expect(s.playback.revision).toBe(playbackRevision);
    s = state(await command(socket, 'queue:remove', { itemId: s.queue[0].id, expectedRevision: s.revision, requestId: randomUUID() }));
    expect(s.playback).toMatchObject({ currentQueueItemId: null, videoId: null, status: 'paused', anchorPositionSec: 0 });
    expect(await control(socket, s, 'PLAY')).toMatchObject({ ok: false, code: 'EMPTY_QUEUE' });
  });
});

describe('official video status policy', () => {
  it('uses only official videos.list, checks embeddability and caches a valid kids status', async () => {
    const requests: string[] = [];
    const service = new YouTubeVideoStatusService({ apiKey: 'private-key', fetch: async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ items: [{ id: 'dQw4w9WgXcQ', status: { madeForKids: true, embeddable: true } }] }), { status: 200 });
    } });
    expect(await service.check('dQw4w9WgXcQ')).toEqual({ madeForKids: true, title: null });
    await service.check('dQw4w9WgXcQ');
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]);
    expect(url.origin).toBe('https://www.googleapis.com');
    expect(url.searchParams.get('part')).toBe('id,status,snippet');
    expect(url.searchParams.get('id')).toBe('dQw4w9WgXcQ');
    await expect(service.check('bad-id')).rejects.toMatchObject({ code: 'INVALID_VIDEO' });
  });

  it.each([{ items: [] }, { items: [{ status: { embeddable: false, madeForKids: false } }] }, { items: [{ status: { embeddable: true } }] }])('rejects unavailable, non-embeddable, or unchecked videos: %j', async body => {
    const service = new YouTubeVideoStatusService({ apiKey: 'key', fetch: async () => new Response(JSON.stringify(body)) });
    await expect(service.check('dQw4w9WgXcQ')).rejects.toBeDefined();
  });

  it('fails closed on quota, network and invalid JSON errors without exposing the key', async () => {
    for (const fetcher of [async () => new Response('{}', { status: 403 }), async () => { throw new Error('secret-api-key'); }, async () => new Response('not JSON')]) {
      const service = new YouTubeVideoStatusService({ apiKey: 'secret-api-key', fetch: fetcher });
      const error = await service.check('dQw4w9WgXcQ').catch(error => error);
      expect(error).toMatchObject({ code: 'VIDEO_STATUS_UNAVAILABLE' });
      expect(error.message).not.toContain('secret-api-key');
    }
  });

  it('expires status results after one day and caps cache entries', async () => {
    let now = 0;
    let requests = 0;
    const service = new YouTubeVideoStatusService({ apiKey: 'key', maxCacheEntries: 1, now: () => now, fetch: async input => {
      requests++;
      return new Response(JSON.stringify({ items: [{ id: new URL(String(input)).searchParams.get('id'), status: { madeForKids: false, embeddable: true } }] }));
    } });
    await service.check('dQw4w9WgXcQ');
    await service.check('aaaaaaaaaaa');
    await service.check('dQw4w9WgXcQ');
    expect(requests).toBe(3);
    now = 24 * 60 * 60 * 1000;
    await service.check('dQw4w9WgXcQ');
    expect(requests).toBe(4);
  });
});
