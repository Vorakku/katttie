import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as Y from 'yjs';
import { MAIN_NOTE_ID, MAX_NOTES, MAX_NOTE_BYTES, MAX_NOTE_LENGTH, NOTE_CARDS_NAME, NOTE_TEXT_NAME, noteIdSchema, noteLayoutSchema, type NoteAck } from '../src/shared/notepad';
import { displayNameSchema, type Ack, type ClientPayloads, type Participant, type PlaybackState, type QueueItem, type Role, type RoomCredentials, type RoomSnapshot } from '../src/shared/protocol';
import { extractYouTubeVideoId, findYouTubeLinks } from '../src/shared/youtube-url';
import { expectedPositionSec } from '../src/shared/playback-math';
import { VideoStatusError, type VideoStatusService } from './youtube-video-status';

export type Identity = { roomId: string; role: Role; socketId: string };
type Room = {
  credentials: RoomCredentials; revision: number; queue: QueueItem[]; playback: PlaybackState;
  participants: Record<Role, Participant>; sockets: Partial<Record<Role, string>>; emptySince: number | null;
  tail: Promise<void>; pending: number; requests: Record<Role, Map<string, string>>;
  notepad: Y.Doc;
};
export type RoomManagerOptions = {
  videoStatus: VideoStatusService; prototypeMode?: boolean; now?: () => number;
  maxRooms?: number; maxQueueLength?: number; maxPendingIntents?: number;
};
const fail = (code: string, message: string): Ack => ({ ok: false, code, message });

export class RoomManager {
  private rooms = new Map<string, Room>();
  private now: () => number;
  constructor(private options: RoomManagerOptions) { this.now = options.now ?? Date.now; }

  create(): RoomCredentials | undefined {
    this.cleanup();
    if (this.rooms.size >= (this.options.maxRooms ?? 1000)) return;
    const credentials = { roomId: randomBytes(18).toString('base64url'), hostSecret: randomBytes(32).toString('base64url'), guestSecret: randomBytes(32).toString('base64url') };
    this.rooms.set(credentials.roomId, {
      credentials, revision: 0, queue: [],
      playback: { currentQueueItemId: null, videoId: null, status: 'paused', anchorPositionSec: 0, anchorServerTimeMs: this.now(), revision: 0 },
      participants: { host: { role: 'host', displayName: 'Host', online: false }, guest: { role: 'guest', displayName: 'Guest', online: false } },
      sockets: {}, emptySince: this.now(), tail: Promise.resolve(), pending: 0, requests: { host: new Map(), guest: new Map() },
      notepad: new Y.Doc(),
    });
    return credentials;
  }

  snapshot(roomId: string): RoomSnapshot | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return;
    return structuredClone({ roomId, revision: room.revision, queue: room.queue, playback: room.playback, participants: Object.values(room.participants), serverNowMs: this.now(), prototypeMode: !!this.options.prototypeMode });
  }

  join(roomId: string, credential: string, displayName: string, socketId: string): { identity: Identity; replaced?: string } | undefined {
    this.cleanup();
    const room = this.rooms.get(roomId);
    if (!room) return;
    const candidate = Buffer.from(credential);
    const matches = (secret: string) => Buffer.byteLength(secret) === candidate.length && timingSafeEqual(Buffer.from(secret), candidate);
    const role = matches(room.credentials.hostSecret) ? 'host' : matches(room.credentials.guestSecret) ? 'guest' : undefined;
    if (!role) return;
    const replaced = room.sockets[role];
    room.sockets[role] = socketId;
    room.participants[role] = { role, displayName, online: true };
    room.emptySince = null;
    room.revision++;
    return { identity: { roomId, role, socketId }, replaced: replaced === socketId ? undefined : replaced };
  }

  active(identity: Identity): boolean { return this.rooms.get(identity.roomId)?.sockets[identity.role] === identity.socketId; }

  leave(identity: Identity): void {
    const room = this.rooms.get(identity.roomId);
    if (!room || !this.active(identity)) return;
    delete room.sockets[identity.role];
    room.participants[identity.role].online = false;
    room.revision++;
    if (!Object.keys(room.sockets).length) room.emptySince = this.now();
  }

  cleanup(): void {
    for (const [id, room] of this.rooms) {
      if (room.emptySince !== null && this.now() - room.emptySince >= 12 * 60 * 60 * 1000 && !room.pending) {
        room.notepad.destroy();
        this.rooms.delete(id);
      }
    }
  }

  updateNotepad(identity: Identity, update: Uint8Array, sync: boolean): NoteAck {
    const room = this.rooms.get(identity.roomId);
    if (!room || !this.active(identity)) return fail('UNAUTHORIZED', 'Join the room again before editing the notepad.');
    if (!update.byteLength || update.byteLength > MAX_NOTE_BYTES) return fail('NOTE_TOO_LARGE', 'The notepad update is too large.');
    const candidate = new Y.Doc();
    try {
      // Validate on a copy so rejected updates cannot alter the shared note.
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.notepad));
      Y.applyUpdate(candidate, update);
      const text = candidate.getText(NOTE_TEXT_NAME);
      const notes = candidate.getMap<Y.Map<unknown>>(NOTE_CARDS_NAME);
      if ([...candidate.share.keys()].some(key => key !== NOTE_TEXT_NAME && key !== NOTE_CARDS_NAME)) {
        return fail('INVALID_NOTE', 'The notepad contains unsupported data.');
      }
      if (notes.size + (text.length && !notes.has(MAIN_NOTE_ID) ? 1 : 0) > MAX_NOTES) return fail('TOO_MANY_NOTES', 'The room can hold up to 20 notes. Remove a note to sync.');
      const bodies = [text];
      for (const [id, card] of notes) {
        if (!noteIdSchema.safeParse(id).success || !(card instanceof Y.Map)
          || [...card.keys()].some(key => !['x', 'y', 'color', 'pinned', 'body', 'author'].includes(key))
          || (card.has('author') && !displayNameSchema.safeParse(card.get('author')).success)
          || !noteLayoutSchema.safeParse({ x: card.get('x'), y: card.get('y'), color: card.get('color'), pinned: card.get('pinned') }).success) {
          return fail('INVALID_NOTE', 'A note has invalid colors or placement.');
        }
        const body = card.get('body');
        if (id === MAIN_NOTE_ID) {
          if (body !== undefined) return fail('INVALID_NOTE', 'The original note contains unsupported data.');
        } else {
          if (!(body instanceof Y.Text)) return fail('INVALID_NOTE', 'Notes accept plain text only.');
          bodies.push(body);
        }
      }
      if (bodies.some(body => body.toDelta().some(part => typeof part.insert !== 'string' || part.attributes))) return fail('INVALID_NOTE', 'Notes accept plain text only.');
      if (bodies.reduce((length, body) => length + body.length, 0) > MAX_NOTE_LENGTH) return fail('NOTE_TOO_LONG', 'Shared notes can hold 10,000 characters in total. Shorten your text to sync it.');
      const encoded = Y.encodeStateAsUpdate(candidate);
      if (encoded.byteLength > MAX_NOTE_BYTES) return fail('NOTE_TOO_LARGE', 'This notepad has reached its room storage limit. Copy your text before starting a new room.');
      room.notepad.destroy();
      room.notepad = candidate;
      return sync ? { ok: true, update: encoded } : { ok: true };
    } catch {
      return fail('INVALID_NOTE', 'The notepad update could not be read. Your local text is still available.');
    } finally {
      if (room.notepad !== candidate) candidate.destroy();
    }
  }

  async dispatch<K extends Exclude<keyof ClientPayloads, 'room:join' | 'room:leave'>>(identity: Identity, event: K, payload: ClientPayloads[K]): Promise<Ack> {
    const room = this.rooms.get(identity.roomId);
    if (!room || !this.active(identity)) return fail('UNAUTHORIZED', 'Join the room again before using its controls.');
    if (room.pending >= (this.options.maxPendingIntents ?? 16)) return fail('BUSY', 'Too many pending changes. Try again shortly.');
    room.pending++;
    const task = room.tail.then(async (): Promise<Ack> => {
      if (!this.active(identity)) return fail('UNAUTHORIZED', 'This session has been replaced.');
      const data = payload as ClientPayloads[Exclude<keyof ClientPayloads, 'room:join' | 'room:leave'>];
      const requestId = 'requestId' in data ? data.requestId : undefined;
      const fingerprint = JSON.stringify([event, payload]);
      const requests = room.requests[identity.role];
      if (requestId && requests.has(requestId)) {
        if (requests.get(requestId) !== fingerprint) return fail('REQUEST_CONFLICT', 'This request ID was already used for another action.');
        return { ok: true, state: this.snapshot(identity.roomId) };
      }
      const result = await this.apply(room, identity, event, data);
      if (result) return result;
      if (requestId) {
        if (requests.size >= 256) requests.delete(requests.keys().next().value!);
        requests.set(requestId, fingerprint);
      }
      return { ok: true, state: this.snapshot(identity.roomId), serverNowMs: this.now() };
    }).catch((error: unknown): Ack => error instanceof VideoStatusError ? fail(error.code, error.message) : fail('INTERNAL_ERROR', 'The change could not be applied. Please retry.'));
    room.tail = task.then(() => { room.pending--; });
    return task;
  }

  private select(room: Room, item: QueueItem | undefined, status: 'playing' | 'paused' = 'paused'): void {
    room.playback = { currentQueueItemId: item?.id ?? null, videoId: item?.videoId ?? null, status: item ? status : 'paused', anchorPositionSec: 0, anchorServerTimeMs: this.now(), revision: room.playback.revision + 1 };
  }

  private next(room: Room): void {
    const index = room.queue.findIndex(item => item.id === room.playback.currentQueueItemId);
    const next = room.queue[index + 1];
    if (next) this.select(room, next, room.playback.status);
    else {
      room.playback.anchorPositionSec = expectedPositionSec(room.playback, this.now());
      room.playback.anchorServerTimeMs = this.now();
      room.playback.status = 'paused';
      room.playback.revision++;
    }
  }

  private async apply(room: Room, identity: Identity, event: string, payload: ClientPayloads[Exclude<keyof ClientPayloads, 'room:join' | 'room:leave'>]): Promise<Ack | undefined> {
    if (event === 'sync:ping') return { ok: true, state: this.snapshot(identity.roomId), serverNowMs: this.now() };
    if (event === 'queue:add' && 'url' in payload) {
      if (room.queue.length >= (this.options.maxQueueLength ?? 50)) return fail('QUEUE_FULL', 'The queue can hold up to 50 songs.');
      const videoId = extractYouTubeVideoId(payload.url);
      if (!videoId) return fail('INVALID_VIDEO', 'Paste a supported YouTube video link.');
      const status = await this.options.videoStatus.check(videoId);
      if (!this.active(identity)) return fail('UNAUTHORIZED', 'This session has been replaced.');
      const item = { id: randomUUID(), videoId, title: status.title, madeForKids: status.madeForKids, addedBy: identity.role, addedAtMs: this.now() };
      room.queue.push(item);
      if (!room.playback.currentQueueItemId) this.select(room, item);
    } else if (event === 'queue:import' && 'text' in payload) {
      const space = (this.options.maxQueueLength ?? 50) - room.queue.length;
      if (space <= 0) return fail('QUEUE_FULL', 'The queue can hold up to 50 songs.');
      const ids: string[] = [];
      for (const link of findYouTubeLinks(payload.text)) {
        if ('videoId' in link) ids.push(link.videoId);
        else if (!this.options.videoStatus.playlist) return fail('PLAYLIST_UNAVAILABLE', 'Playlist links are not supported on this server.');
        else ids.push(...await this.options.videoStatus.playlist(link.playlistId));
        if (ids.length >= space) break;
      }
      if (!ids.length) return fail('INVALID_VIDEO', 'No YouTube video or playlist links were found.');
      // Unplayable videos (private, deleted, not embeddable) are skipped, not fatal.
      const checks = await Promise.allSettled(ids.slice(0, space).map(id => this.options.videoStatus.check(id)));
      if (!this.active(identity)) return fail('UNAUTHORIZED', 'This session has been replaced.');
      const items = checks.flatMap((check, index) => check.status === 'fulfilled'
        ? [{ id: randomUUID(), videoId: ids[index], title: check.value.title, madeForKids: check.value.madeForKids, addedBy: identity.role, addedAtMs: this.now() }] : []);
      if (!items.length) return fail('VIDEO_UNAVAILABLE', 'None of those videos can be played here.');
      room.queue.push(...items);
      if (!room.playback.currentQueueItemId) this.select(room, items[0]);
    } else if (event === 'queue:reorder' && 'itemIds' in payload) {
      if (payload.expectedRevision !== room.revision) return fail('STALE_REVISION', 'The queue changed while you were moving a song. Please try again.');
      const items = new Map(room.queue.map(item => [item.id, item]));
      if (payload.itemIds.length !== room.queue.length || new Set(payload.itemIds).size !== room.queue.length || payload.itemIds.some(id => !items.has(id))) {
        return fail('INVALID_QUEUE', 'The new order must contain every queued song exactly once.');
      }
      room.queue = payload.itemIds.map(id => items.get(id)!);
    } else if ((event === 'queue:remove' || event === 'queue:select') && 'itemId' in payload) {
      if (payload.expectedRevision !== room.revision) return fail('STALE_REVISION', 'The queue changed. Please try again.');
      const index = room.queue.findIndex(item => item.id === payload.itemId);
      if (index < 0) return fail('ITEM_NOT_FOUND', 'This song is no longer in the queue.');
      if (event === 'queue:select') this.select(room, room.queue[index]);
      else {
        const [removed] = room.queue.splice(index, 1);
        if (removed.id === room.playback.currentQueueItemId) this.select(room, room.queue[index] ?? room.queue[index - 1]);
      }
    } else if (event === 'playback:control' && 'action' in payload) {
      if (payload.expectedPlaybackRevision !== room.playback.revision) return fail('STALE_REVISION', 'Playback changed. Please try again.');
      if (!room.playback.currentQueueItemId) return fail('EMPTY_QUEUE', 'Add a song to begin.');
      if (payload.action === 'NEXT') this.next(room);
      else {
        room.playback.anchorPositionSec = payload.action === 'SEEK' ? payload.positionSec! : expectedPositionSec(room.playback, this.now());
        room.playback.anchorServerTimeMs = this.now();
        if (payload.action !== 'SEEK') room.playback.status = payload.action === 'PLAY' ? 'playing' : 'paused';
        room.playback.revision++;
      }
    } else if (event === 'playback:ended' && 'playbackRevision' in payload) {
      if (payload.videoId !== room.playback.videoId || payload.playbackRevision !== room.playback.revision || room.playback.status !== 'playing') return { ok: true, state: this.snapshot(identity.roomId) };
      this.next(room);
    }
    room.revision++;
  }
}
