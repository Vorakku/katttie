import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { GripVertical, Pin, PinOff, Plus, StickyNote, Trash2 } from 'lucide-react';
import type { NotepadStatus, SharedNote, SharedNotepadConnection } from '../lib/shared-notepad';
import { MAX_NOTES, NOTE_COLORS } from '../shared/notepad';
import { SharedNotepad } from './SharedNotepad';

export function FloatingNotes({ notepad, status = { state: 'loading' }, readOnly, author }: {
  notepad: SharedNotepadConnection | undefined;
  status?: NotepadStatus;
  readOnly: boolean;
  author: string;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<SharedNote[]>([]);
  const [frontId, setFrontId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!notepad) return;
    const render = () => setNotes(notepad.getNotes());
    render();
    notepad.notes.observeDeep(render);
    notepad.text.observe(render);
    return () => { notepad.notes.unobserveDeep(render); notepad.text.unobserve(render); };
  }, [notepad]);

  function addNote() {
    const id = notepad?.createNote(author);
    if (id) setFrontId(id);
    setOpen(true);
  }

  return <>
    <div className="notes-tools" data-cursor-anchor="notepad">
      <button className="secondary-button notes-toggle" type="button" aria-expanded={open} aria-controls="room-notes-menu"
        disabled={!notepad || status.state === 'loading'} onClick={() => {
          if (!open && !notes.length && !readOnly) addNote();
          else setOpen(!open);
        }}>
        <StickyNote size={18} aria-hidden="true" /> Notes <span className="notes-count">{notes.length}</span>
      </button>
      {open && <div className="notes-menu" id="room-notes-menu">
        <button className="primary-button" type="button" disabled={readOnly || notes.length >= MAX_NOTES} onClick={addNote}><Plus size={16} /> Add a note</button>
        <p>Pick a color, drag a note anywhere, or pin it to keep it in place. Both of you can edit.</p>
        <p className={status.state === 'error' ? 'error' : 'muted'} role="status">{status.message ?? (status.state === 'synced' ? 'Notes shared with your room.' : status.state === 'offline' ? 'Offline. Changes will sync when you reconnect.' : 'Syncing notes…')}</p>
        <p className="notes-lifetime">Notes last until the room ends or the server restarts.</p>
      </div>}
    </div>
    {notepad && notes.filter(note => open || note.pinned).map(note => <FloatingNote key={note.id} note={note}
      notepad={notepad} status={status} readOnly={readOnly} front={frontId === note.id} onFront={() => setFrontId(note.id)} />)}
  </>;
}

function FloatingNote({ note, notepad, status, readOnly, front, onFront }: {
  note: SharedNote;
  notepad: SharedNotepadConnection;
  status: NotepadStatus;
  readOnly: boolean;
  front: boolean;
  onFront: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number; next: { x: number; y: number } } | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  const position = preview ?? note;

  useEffect(() => {
    if (note.pinned || readOnly) { drag.current = null; setPreview(null); }
  }, [note.pinned, readOnly]);

  function finish(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!cancel && !note.pinned && !readOnly) notepad.updateNote(note.id, current.next);
    setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <section ref={cardRef} className={`sticky-note sticky-note-${note.color}${note.pinned ? ' is-pinned' : ''}${preview ? ' is-moving' : ''}`}
    data-cursor-anchor="notepad" data-cursor-note={note.id} aria-label={note.pinned ? 'Pinned shared note' : 'Movable shared note'}
    style={{ '--note-x': position.x, '--note-y': position.y, zIndex: front ? 510 : 500 } as CSSProperties}
    onPointerDownCapture={onFront} onFocusCapture={onFront}>
    <div className="sticky-note-header">
      <button className="note-drag-handle" type="button" disabled={readOnly || note.pinned}
        aria-label="Move note. Drag, or use arrow keys." title={note.pinned ? 'Unpin to move this note' : 'Drag to move. Arrow keys also work.'}
        onPointerDown={event => {
          if (event.button !== 0 || note.pinned || readOnly) return;
          event.preventDefault();
          event.currentTarget.focus();
          drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: note.x, y: note.y, next: { x: note.x, y: note.y } };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const current = drag.current;
          const bounds = cardRef.current?.getBoundingClientRect();
          if (!current || current.pointerId !== event.pointerId || !bounds) return;
          const width = Math.max(1, window.innerWidth - bounds.width - 24);
          const height = Math.max(1, window.innerHeight - bounds.height - 96);
          current.next = { x: Math.max(0, Math.min(1, current.x + (event.clientX - current.clientX) / width)), y: Math.max(0, Math.min(1, current.y + (event.clientY - current.clientY) / height)) };
          setPreview(current.next);
        }}
        onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
        onKeyDown={event => {
          const dx = event.key === 'ArrowLeft' ? -0.04 : event.key === 'ArrowRight' ? 0.04 : 0;
          const dy = event.key === 'ArrowUp' ? -0.04 : event.key === 'ArrowDown' ? 0.04 : 0;
          if (!dx && !dy) return;
          event.preventDefault();
          notepad.updateNote(note.id, { x: Math.max(0, Math.min(1, note.x + dx)), y: Math.max(0, Math.min(1, note.y + dy)) });
        }}><GripVertical size={17} /><span>{note.pinned ? 'Pinned' : 'Move note'}</span></button>
      <button className="note-icon-button" type="button" disabled={readOnly} aria-label={note.pinned ? 'Unpin note' : 'Pin note'} aria-pressed={note.pinned}
        onClick={() => notepad.updateNote(note.id, { pinned: !note.pinned })}>{note.pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
      <button className="note-icon-button" type="button" disabled={readOnly} aria-label="Delete shared note" onClick={() => {
        if (!note.text.length || window.confirm('Delete this note for both of you?')) notepad.deleteNote(note.id);
      }}><Trash2 size={15} /></button>
    </div>
    <div className="note-colors" role="group" aria-label="Note color">{NOTE_COLORS.map(color => <button key={color} type="button"
      className={`note-color note-color-${color}`} aria-label={`${color} note`} title={color} aria-pressed={note.color === color} disabled={readOnly}
      onClick={() => notepad.updateNote(note.id, { color })} />)}</div>
    <SharedNotepad notepad={notepad} status={status} readOnly={readOnly} noteText={note.text} noteId={note.id} author={note.author} autoFocus={front} />
  </section>;
}
