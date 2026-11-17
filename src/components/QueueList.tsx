import { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical, Music2, Trash2 } from 'lucide-react';
import type { RoomSnapshot } from '../shared/protocol';

type QueueDrag = {
  id: string; pointerId: number; revision: number; ids: string[];
  startX: number; startY: number; x: number; y: number; moved: boolean;
};

export function QueueList({ snapshot, disabled, onSelect, onRemove, onReorder }: {
  snapshot: RoomSnapshot;
  disabled: boolean;
  onSelect: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onReorder: (ids: string[], revision: number) => Promise<void>;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const drag = useRef<QueueDrag | null>(null);
  const [draft, setDraft] = useState<{ id: string; ids: string[] } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const cancelDrag = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    setDraft(null);
    if (current && listRef.current?.hasPointerCapture(current.pointerId)) listRef.current.releasePointerCapture(current.pointerId);
  }, []);

  const reorderAt = useCallback((x: number, y: number) => {
    const current = drag.current;
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-queue-id]');
    if (!current?.moved || !row || !listRef.current?.contains(row)) return;
    const from = current.ids.indexOf(current.id);
    const to = current.ids.indexOf(row.dataset.queueId ?? '');
    if (from < 0 || to < 0 || from === to) return;
    const bounds = row.getBoundingClientRect();
    const middle = bounds.top + bounds.height / 2;
    if ((from < to && y < middle) || (from > to && y > middle)) return;
    const ids = [...current.ids];
    ids.splice(from, 1);
    ids.splice(to, 0, current.id);
    current.ids = ids;
    setDraft({ id: current.id, ids });
  }, []);

  useEffect(() => {
    if (disabled || (drag.current && drag.current.revision !== snapshot.revision)) cancelDrag();
  }, [disabled, snapshot.revision, cancelDrag]);

  useEffect(() => {
    if (!draft?.id) return;
    let frame = 0;
    let previousTime = 0;
    const scroll = (now: number) => {
      const current = drag.current;
      const list = listRef.current;
      if (!current || !list) return;
      const bounds = list.getBoundingClientRect();
      const speed = Math.min(16, previousTime ? (now - previousTime) * 0.6 : 0);
      previousTime = now;
      if (current.moved && current.x >= bounds.left && current.x <= bounds.right) {
        const previousTop = list.scrollTop;
        if (current.y < bounds.top + 32) list.scrollTop -= speed;
        else if (current.y > bounds.bottom - 32) list.scrollTop += speed;
        const previousPageTop = window.scrollY;
        if (list.scrollTop === previousTop) {
          if (current.y < 48) window.scrollBy(0, -speed);
          else if (current.y > window.innerHeight - 48) window.scrollBy(0, speed);
        }
        if (list.scrollTop !== previousTop || window.scrollY !== previousPageTop) reorderAt(current.x, Math.max(1, Math.min(window.innerHeight - 1, current.y)));
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [draft?.id, reorderAt]);

  const queue = draft && draft.ids.length === snapshot.queue.length
    ? draft.ids.map(id => snapshot.queue.find(item => item.id === id)).filter(item => item !== undefined)
    : snapshot.queue;

  return <>
    <p className="queue-reorder-hint" id="queue-reorder-help">Drag a handle to reorder. You can also focus it and use ↑ / ↓, Home or End.</p>
    <span className="sr-only" role="status">{announcement}</span>
    <ol className="queue-list" ref={listRef}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        current.x = event.clientX;
        current.y = event.clientY;
        current.moved ||= Math.hypot(current.x - current.startX, current.y - current.startY) > 5;
        reorderAt(current.x, current.y);
      }}
      onPointerUp={event => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const changed = current.moved && current.ids.some((id, index) => id !== snapshot.queue[index]?.id);
        cancelDrag();
        if (changed && !disabled) {
          setAnnouncement(`Moving song to position ${current.ids.indexOf(current.id) + 1}.`);
          void onReorder(current.ids, current.revision);
        }
      }} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
      {queue.map((item, index) => {
        const selected = item.id === snapshot.playback.currentQueueItemId;
        const title = item.title ?? `YouTube · ${item.videoId}`;
        const addedBy = snapshot.participants.find(person => person.role === item.addedBy)?.displayName ?? 'Your person';
        return <li className={`queue-item${selected ? ' is-selected' : ''}${draft?.id === item.id ? ' is-dragging' : ''}`}
          key={item.id} data-queue-id={item.id} data-cursor-anchor="queue" data-cursor-item={item.id}>
          <div className="queue-rank"><button className="queue-drag-handle" type="button" disabled={disabled || snapshot.queue.length < 2}
            aria-label={`Move ${title}`} aria-describedby="queue-reorder-help" title="Drag to reorder, or use arrow keys"
            onPointerDown={event => {
              if (event.button !== 0 || disabled || snapshot.queue.length < 2 || drag.current) return;
              event.preventDefault();
              event.currentTarget.focus();
              const ids = snapshot.queue.map(song => song.id);
              drag.current = { id: item.id, ids, revision: snapshot.revision, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
              listRef.current?.setPointerCapture(event.pointerId);
              setDraft({ id: item.id, ids });
            }}
            onKeyDown={event => {
              const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? queue.length - 1 : index;
              if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              if (disabled || to === index || to < 0 || to >= queue.length) return;
              const ids = queue.map(song => song.id);
              ids.splice(index, 1);
              ids.splice(to, 0, item.id);
              setAnnouncement(`Moving ${title} to position ${to + 1}.`);
              void onReorder(ids, snapshot.revision);
            }}><GripVertical size={17} aria-hidden="true" /></button>
            <span className="queue-number">{selected ? <Music2 size={14} aria-label="Selected song" /> : String(index + 1).padStart(2, '0')}</span></div>
          <button className="song-select" type="button" onClick={() => { void onSelect(item.id); }} disabled={disabled || selected} aria-label={`Select ${title}`}>
            <strong>{title}</strong><span>Added by {addedBy}</span></button>
          <button className="icon-button remove-song" type="button" disabled={disabled} onClick={() => { void onRemove(item.id); }} aria-label={`Remove ${title}`}><Trash2 size={16} /></button>
        </li>;
      })}
    </ol>
  </>;
}
