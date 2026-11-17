import { z } from 'zod';
import type { NoteAckCallback, NotePayload } from './notepad';
import { noteIdSchema } from './notepad';

export type Role = 'host' | 'guest';
export type Participant = { role: Role; displayName: string; online: boolean };
export type QueueItem = { id: string; videoId: string; title: string | null; addedBy: Role; addedAtMs: number; madeForKids: boolean | null };
export type PlaybackState = {
  currentQueueItemId: string | null; videoId: string | null; status: 'playing' | 'paused';
  anchorPositionSec: number; anchorServerTimeMs: number; revision: number;
};
export type RoomSnapshot = {
  roomId: string; revision: number; queue: QueueItem[]; playback: PlaybackState;
  participants: Participant[]; serverNowMs: number; prototypeMode: boolean;
};
export type RoomCredentials = { roomId: string; hostSecret: string; guestSecret: string };
export type Ack = { ok: true; state?: RoomSnapshot; serverNowMs?: number } | { ok: false; code: string; message: string };
export type AckCallback = (result: Ack) => void;

export const cursorShapeSchema = z.enum([
  'default', 'none', 'pointer', 'text', 'vertical-text', 'grab', 'grabbing',
  'not-allowed', 'no-drop', 'move', 'all-scroll', 'crosshair', 'cell',
  'help', 'wait', 'progress', 'copy', 'alias', 'context-menu', 'zoom-in', 'zoom-out',
  'n-resize', 's-resize', 'e-resize', 'w-resize', 'ne-resize', 'sw-resize',
  'nw-resize', 'se-resize', 'ns-resize', 'ew-resize', 'nesw-resize', 'nwse-resize',
  'col-resize', 'row-resize',
]);
export type CursorShape = z.infer<typeof cursorShapeSchema>;

export const cursorPositionSchema = z.object({
  anchor: z.enum(['room', 'heading', 'player', 'together', 'people', 'queue', 'notepad']),
  queueItemId: z.string().uuid().optional(),
  noteId: noteIdSchema.optional(),
  shape: cursorShapeSchema.optional(),
  overPlayer: z.boolean().optional(),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
}).strict().nullable();
export type CursorPosition = z.infer<typeof cursorPositionSchema>;
export type RoomCursor = { roomId: string; role: Role; position: CursorPosition };

const requestId = z.string().uuid();
const revision = z.number().int().nonnegative();
export const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const displayNameSchema = z.string().trim().min(1).max(96).refine(value => [...value].length <= 24, 'Use at most 24 characters.');
export const schemas = {
  'room:join': z.object({ roomId: z.string().min(16).max(100), credential: z.string().min(32).max(128), displayName: displayNameSchema }).strict(),
  'room:leave': z.object({}).strict(),
  'queue:add': z.object({ url: z.string().trim().min(1).max(2048), requestId }).strict(),
  'queue:import': z.object({ text: z.string().trim().min(1).max(20_000), requestId }).strict(),
  'queue:remove': z.object({ itemId: z.string().uuid(), expectedRevision: revision, requestId }).strict(),
  'queue:select': z.object({ itemId: z.string().uuid(), expectedRevision: revision, requestId }).strict(),
  'queue:reorder': z.object({ itemIds: z.array(z.string().uuid()).min(1).max(50), expectedRevision: revision, requestId }).strict(),
  'playback:control': z.object({ action: z.enum(['PLAY', 'PAUSE', 'SEEK', 'NEXT']), positionSec: z.number().finite().min(0).max(86400).optional(), expectedPlaybackRevision: revision, requestId }).strict().refine(value => value.action !== 'SEEK' || value.positionSec !== undefined, 'A seek position is required.'),
  'playback:ended': z.object({ videoId: videoIdSchema, playbackRevision: revision }).strict(),
  'sync:ping': z.object({ clientSentAtMs: z.number().finite() }).strict(),
};
export type ClientPayloads = { [K in keyof typeof schemas]: z.infer<(typeof schemas)[K]> };
export type ClientEvents = { [K in keyof ClientPayloads]: (payload: ClientPayloads[K], ack: AckCallback) => void } & {
  'cursor:move': (position: CursorPosition) => void;
  'note:sync': (payload: NotePayload, ack: NoteAckCallback) => void;
  'note:update': (payload: NotePayload, ack: NoteAckCallback) => void;
};
export type ServerEvents = {
  'cursor:state': (cursor: RoomCursor) => void;
  'note:update': (payload: { roomId: string; update: Uint8Array | ArrayBuffer }) => void;
  'room:state': (state: RoomSnapshot) => void;
  'room:error': (error: { code: string; message: string }) => void;
  'room:replaced': (notice: { message: string }) => void;
};
export type SendCommand = <K extends keyof ClientPayloads>(event: K, payload: ClientPayloads[K]) => Promise<Ack>;
