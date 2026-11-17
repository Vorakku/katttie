import * as Y from 'yjs';
import type { Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents } from '../shared/protocol';
import { DEFAULT_NOTE_LAYOUT, LOCAL_NOTE_ORIGIN, MAIN_NOTE_ID, MAX_NOTES, MAX_NOTE_BYTES, NOTE_CARDS_NAME, NOTE_TEXT_NAME, noteBytesSchema, noteLayoutSchema, type NoteAck, type NoteLayout } from '../shared/notepad';

export type NotepadStatus = { state: 'loading' | 'syncing' | 'synced' | 'offline' | 'error'; message?: string };
export type SharedNote = NoteLayout & { id: string; text: Y.Text; author?: string };
const remoteOrigin = 'notepad-remote';

export function connectNotepad(socket: Socket<ServerEvents, ClientEvents>, roomId: string, onStatus: (status: NotepadStatus) => void) {
  const doc = new Y.Doc();
  const text = doc.getText(NOTE_TEXT_NAME);
  const notes = doc.getMap<Y.Map<unknown>>(NOTE_CARDS_NAME);
  const undoManager = new Y.UndoManager([text, notes], { trackedOrigins: new Set([LOCAL_NOTE_ORIGIN]) });
  let status: NotepadStatus = { state: 'loading' };
  let active = false;
  let ready = false;
  let closed = false;
  let busy = false;
  let blocked = false;
  let composing = false;
  let deferredRemote: Uint8Array | null = null;
  let generation = 0;
  let localVersion = 0;
  let savedVersion = 0;
  let savedVector: Uint8Array | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const notify = (state: NotepadStatus['state'], message?: string) => {
    if (closed || (status.state === state && status.message === message)) return;
    status = { state, message };
    onStatus(status);
  };
  const applyRemote = (bytes: Uint8Array) => {
    if (composing) deferredRemote = deferredRemote ? Y.mergeUpdates([deferredRemote, bytes]) : bytes;
    else Y.applyUpdate(doc, bytes, remoteOrigin);
  };
  const schedule = (delay = 80) => {
    if (timer !== undefined || !active || closed || blocked || busy) return;
    timer = setTimeout(() => {
      timer = undefined;
      void transmit(!ready);
    }, delay);
  };
  const settle = () => {
    if (blocked) return;
    if (!active) { notify('offline'); return; }
    if (ready && localVersion === savedVersion && !composing) notify('synced');
    else {
      notify('syncing');
      if (!ready || localVersion !== savedVersion) schedule();
    }
  };
  const transmit = async (sync: boolean) => {
    if (!active || closed || busy || blocked || !socket.connected) return;
    const update = Y.encodeStateAsUpdate(doc, sync ? undefined : savedVector);
    if (update.byteLength > MAX_NOTE_BYTES) {
      blocked = true;
      notify('error', 'This notepad has reached its room storage limit. Copy your text before starting a new room.');
      return;
    }
    busy = true;
    notify('syncing');
    const token = generation;
    const sentVersion = localVersion;
    const sentVector = Y.encodeStateVector(doc);
    try {
      const result: NoteAck = await socket.timeout(6000).volatile.emitWithAck(sync ? 'note:sync' : 'note:update', { update });
      if (closed || generation !== token || !active) return;
      if (!result.ok) {
        ready = false;
        if (result.code === 'RATE_LIMITED') {
          busy = false;
          notify('syncing', result.message);
          schedule(1200);
          return;
        }
        blocked = true;
        notify('error', result.message);
        return;
      }
      if (sync) {
        const parsed = noteBytesSchema.safeParse(result.update);
        if (!parsed.success) throw new Error('Missing notepad state');
        applyRemote(parsed.data);
      }
      ready = true;
      savedVersion = sentVersion;
      savedVector = sentVector;
      busy = false;
      settle();
    } catch {
      if (closed || generation !== token || !active) return;
      busy = false;
      ready = false;
      notify('syncing', 'Waiting to confirm your edits. Retrying…');
      schedule(1200);
    } finally {
      if (generation === token) busy = false;
    }
  };
  const sync = () => {
    if (closed) return;
    active = true;
    blocked = false;
    ready = false;
    schedule(0);
  };
  const localUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === remoteOrigin) return;
    localVersion++;
    blocked = false;
    notify(active ? 'syncing' : 'offline');
    schedule();
  };
  const receive = (payload: { roomId: string; update: Uint8Array | ArrayBuffer }) => {
    if (!active || closed || payload.roomId !== roomId) return;
    const parsed = noteBytesSchema.safeParse(payload.update);
    if (!parsed.success) return;
    try { applyRemote(parsed.data); }
    catch {
      ready = false;
      notify('syncing', 'Restoring the shared notepad…');
      schedule(1200);
    }
  };
  doc.on('update', localUpdate);
  socket.on('note:update', receive);

  const getNotes = (): SharedNote[] => {
    const result: SharedNote[] = [];
    for (const [id, card] of notes) {
      if (!(card instanceof Y.Map)) continue;
      const layout = noteLayoutSchema.safeParse({ x: card.get('x'), y: card.get('y'), color: card.get('color'), pinned: card.get('pinned') });
      const body = id === MAIN_NOTE_ID ? text : card.get('body');
      const author = card.get('author');
      if (layout.success && body instanceof Y.Text) result.push({ id, text: body, ...layout.data, author: typeof author === 'string' ? author : undefined });
    }
    if (text.length && !notes.has(MAIN_NOTE_ID)) result.unshift({ id: MAIN_NOTE_ID, text, ...DEFAULT_NOTE_LAYOUT });
    return result;
  };

  return {
    doc,
    text,
    notes,
    getNotes,
    undoManager,
    sync,
    createNote(author: string) {
      const count = getNotes().length;
      if (count >= MAX_NOTES) { notify('error', 'The room can hold up to 20 notes. Remove a note to add another.'); return; }
      const id = !notes.has(MAIN_NOTE_ID) && !text.length ? MAIN_NOTE_ID : crypto.randomUUID();
      undoManager.stopCapturing();
      doc.transact(() => {
        const card = new Y.Map<unknown>();
        notes.set(id, card);
        const layout = { ...DEFAULT_NOTE_LAYOUT, x: Math.min(0.95, 0.6 + (count % 4) * 0.08), y: Math.min(0.85, 0.08 + (count % 5) * 0.12) };
        for (const [key, value] of Object.entries(layout)) card.set(key, value);
        card.set('author', author);
        if (id !== MAIN_NOTE_ID) card.set('body', new Y.Text());
      }, LOCAL_NOTE_ORIGIN);
      undoManager.stopCapturing();
      return id;
    },
    updateNote(id: string, patch: Partial<NoteLayout>) {
      if (!notes.has(id) && id !== MAIN_NOTE_ID) return;
      doc.transact(() => {
        let card = notes.get(id);
        if (!card) {
          card = new Y.Map<unknown>();
          notes.set(id, card);
          for (const [key, value] of Object.entries(DEFAULT_NOTE_LAYOUT)) card.set(key, value);
        }
        for (const [key, value] of Object.entries(patch)) card.set(key, value);
      }, LOCAL_NOTE_ORIGIN);
    },
    deleteNote(id: string) {
      undoManager.stopCapturing();
      doc.transact(() => {
        if (id === MAIN_NOTE_ID) text.delete(0, text.length);
        notes.delete(id);
      }, LOCAL_NOTE_ORIGIN);
      undoManager.stopCapturing();
    },
    replaceText(value: string, target = text) {
      const previous = [...target.toString()];
      const next = [...value];
      let start = 0;
      while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
      let previousEnd = previous.length;
      let nextEnd = next.length;
      while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) { previousEnd--; nextEnd--; }
      const offset = previous.slice(0, start).join('').length;
      const removedLength = previous.slice(start, previousEnd).join('').length;
      const inserted = next.slice(start, nextEnd).join('');
      doc.transact(() => {
        if (removedLength) target.delete(offset, removedLength);
        if (inserted) target.insert(offset, inserted);
      }, LOCAL_NOTE_ORIGIN);
    },
    setComposing(value: boolean) {
      composing = value;
      if (!value && deferredRemote) {
        const update = deferredRemote;
        deferredRemote = null;
        Y.applyUpdate(doc, update, remoteOrigin);
      }
      settle();
    },
    disconnect() {
      active = false;
      ready = false;
      busy = false;
      generation++;
      clearTimeout(timer);
      timer = undefined;
      notify('offline');
    },
    close() {
      closed = true;
      active = false;
      generation++;
      clearTimeout(timer);
      socket.off('note:update', receive);
      doc.off('update', localUpdate);
      undoManager.destroy();
      doc.destroy();
    },
  };
}

export type SharedNotepadConnection = ReturnType<typeof connectNotepad>;
