import { useId, useLayoutEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { NotepadStatus, SharedNotepadConnection } from '../lib/shared-notepad';
import { LOCAL_NOTE_ORIGIN, MAX_NOTE_LENGTH } from '../shared/notepad';

const statusLabels: Record<NotepadStatus['state'], string> = {
  loading: 'Opening notepad…',
  syncing: 'Syncing…',
  synced: 'Synced to room',
  offline: 'Offline · edits kept in this tab',
  error: 'Edits need attention',
};

export function SharedNotepad({ notepad, status = { state: 'loading' }, readOnly, noteText, noteId, author, autoFocus = false }: {
  notepad: SharedNotepadConnection | undefined;
  status?: NotepadStatus;
  readOnly: boolean;
  noteText?: Y.Text;
  noteId?: string;
  author?: string;
  autoFocus?: boolean;
}) {
  const headingId = useId();
  const hintId = useId();
  const text = noteText ?? notepad?.text;
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(0);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field || !notepad || !text) return;
    const { doc } = notepad;
    let selection: { start: Y.RelativePosition; end: Y.RelativePosition; direction: 'forward' | 'backward' | 'none' } | null = null;
    const before = (transaction: Y.Transaction) => {
      selection = null;
      if (transaction.origin === LOCAL_NOTE_ORIGIN || document.activeElement !== field || composingRef.current) return;
      selection = {
        start: Y.createRelativePositionFromTypeIndex(text, field.selectionStart),
        end: Y.createRelativePositionFromTypeIndex(text, field.selectionEnd),
        direction: field.selectionDirection,
      };
    };
    const render = () => {
      const scrollTop = field.scrollTop;
      const scrollLeft = field.scrollLeft;
      const value = text.toString();
      if (field.value !== value) field.value = value;
      if (selection) {
        const start = Y.createAbsolutePositionFromRelativePosition(selection.start, doc);
        const end = Y.createAbsolutePositionFromRelativePosition(selection.end, doc);
        if (start && end) field.setSelectionRange(start.index, end.index, selection.direction);
      }
      field.scrollTop = scrollTop;
      field.scrollLeft = scrollLeft;
      selection = null;
      setLength(text.length);
    };
    render();
    doc.on('beforeTransaction', before);
    text.observe(render);
    return () => {
      doc.off('beforeTransaction', before);
      text.unobserve(render);
      composingRef.current = false;
      notepad.setComposing(false);
    };
  }, [notepad, text]);

  return <section className="surface notepad-surface" data-cursor-anchor="notepad" data-cursor-note={noteId} aria-labelledby={headingId}>
    <div className="section-heading"><h2 id={headingId}>{author ? <span className="note-author-chip">{author} said</span> : noteId ? 'Shared note' : 'Our notepad'}</h2>
      <span className={`notepad-status notepad-status-${status.state}`}>{statusLabels[status.state]}</span>
    </div>
    <textarea ref={fieldRef} className="notepad-input" aria-labelledby={headingId} aria-describedby={hintId} autoFocus={autoFocus}
      placeholder="A thought, a little list, something for us…" maxLength={MAX_NOTE_LENGTH} readOnly={readOnly || !notepad}
      onChange={event => { if (!composingRef.current && text) notepad?.replaceText(event.target.value, text); }}
      onCompositionStart={() => { composingRef.current = true; notepad?.setComposing(true); }}
      onCompositionEnd={event => {
        if (text) notepad?.replaceText(event.currentTarget.value, text);
        composingRef.current = false;
        notepad?.setComposing(false);
      }}
      onKeyDown={event => {
        if (readOnly || !notepad || composingRef.current || event.altKey || (!event.ctrlKey && !event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key !== 'z' && key !== 'y') return;
        event.preventDefault();
        if (key === 'y' || event.shiftKey) notepad.undoManager.redo();
        else notepad.undoManager.undo();
      }}
      onBeforeInput={event => {
        if (readOnly || !notepad || composingRef.current) return;
        const inputType = (event.nativeEvent as InputEvent).inputType;
        if (inputType !== 'historyUndo' && inputType !== 'historyRedo') return;
        event.preventDefault();
        if (inputType === 'historyUndo') notepad.undoManager.undo();
        else notepad.undoManager.redo();
      }} />
    <div className="notepad-footer"><p id={hintId}>Notes last until this room ends or the server restarts.</p>
      <span className={length > MAX_NOTE_LENGTH ? 'pink-text' : ''}>{length.toLocaleString()} / 10,000</span>
    </div>
    {status.message && <p className={status.state === 'error' ? 'error' : 'field-hint'} role="status">{status.message}</p>}
    {status.state === 'error' && !readOnly && <button className="secondary-button" type="button" onClick={() => notepad?.sync()}>Retry sync</button>}
  </section>;
}
