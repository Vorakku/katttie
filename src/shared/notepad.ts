import { z } from 'zod';

export const MAX_NOTE_LENGTH = 10_000;
export const MAX_NOTE_BYTES = 256 * 1024;
export const NOTE_TEXT_NAME = 'notepad';
export const NOTE_CARDS_NAME = 'sticky-notes';
export const MAIN_NOTE_ID = 'main';
export const MAX_NOTES = 20;
export const NOTE_COLORS = ['yellow', 'pink', 'lilac', 'mint', 'blue'] as const;
export const noteLayoutSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  color: z.enum(NOTE_COLORS),
  pinned: z.boolean(),
}).strict();
export type NoteLayout = z.infer<typeof noteLayoutSchema>;
export const DEFAULT_NOTE_LAYOUT: NoteLayout = { x: 0.7, y: 0.1, color: 'lilac', pinned: false };
export const noteIdSchema = z.union([z.literal(MAIN_NOTE_ID), z.string().uuid()]);
export const LOCAL_NOTE_ORIGIN = 'notepad-input';

export const noteBytesSchema = z.union([
  z.instanceof(Uint8Array),
  z.instanceof(ArrayBuffer).transform(value => new Uint8Array(value)),
]).refine(value => value.byteLength > 0 && value.byteLength <= MAX_NOTE_BYTES, 'The notepad update is too large.');

export const noteUpdateSchema = z.object({ update: noteBytesSchema }).strict();
export type NotePayload = { update: Uint8Array };
export type NoteAck = { ok: true; update?: Uint8Array | ArrayBuffer } | { ok: false; code: string; message: string };
export type NoteAckCallback = (result: NoteAck) => void;
