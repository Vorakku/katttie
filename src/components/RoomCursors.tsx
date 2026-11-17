import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { CircleOff, CircleQuestionMark, Copy, CornerUpRight, Crosshair, Hand, HandGrab, List, LoaderCircle, Move, MoveDiagonal, MoveDiagonal2, MoveHorizontal, MoveVertical, Plus, TextCursor, ZoomIn, ZoomOut } from 'lucide-react';
import { cursorShapeAt } from '../lib/cursor-shape';
import type { CursorPosition, CursorShape, Participant, Role, RoomCursor } from '../shared/protocol';

function PointerHand({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 13V4a2 2 0 0 1 4 0v6h1a2 2 0 0 1 2 1h1a2 2 0 0 1 2 1h1a2 2 0 0 1 2 2v3c0 4-2 6-6 6h-2c-2 0-3-1-4-3l-4-6a2 2 0 0 1 3-2l2 2Z" />
  </svg>;
}

const cursorIcons: Record<Exclude<CursorShape, 'default' | 'none'>, ComponentType<{ size?: number }>> = {
  pointer: PointerHand, text: TextCursor, 'vertical-text': TextCursor,
  grab: Hand, grabbing: HandGrab, 'not-allowed': CircleOff, 'no-drop': CircleOff,
  move: Move, 'all-scroll': Move, crosshair: Crosshair, cell: Plus,
  help: CircleQuestionMark, wait: LoaderCircle, progress: LoaderCircle,
  copy: Copy, alias: CornerUpRight, 'context-menu': List, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut,
  'n-resize': MoveVertical, 's-resize': MoveVertical, 'ns-resize': MoveVertical, 'row-resize': MoveVertical,
  'e-resize': MoveHorizontal, 'w-resize': MoveHorizontal, 'ew-resize': MoveHorizontal, 'col-resize': MoveHorizontal,
  'ne-resize': MoveDiagonal, 'sw-resize': MoveDiagonal, 'nesw-resize': MoveDiagonal,
  'nw-resize': MoveDiagonal2, 'se-resize': MoveDiagonal2, 'nwse-resize': MoveDiagonal2,
};

export function RoomCursors({ cursor, participants, role, displayName, connected, sendCursor }: {
  cursor: RoomCursor | undefined;
  participants: Participant[];
  role: Role;
  displayName: string;
  connected: boolean;
  sendCursor: (position: CursorPosition) => void;
}) {
  const [localPosition, setLocalPosition] = useState<CursorPosition>(null);
  const person = participants.find(participant => participant.role === cursor?.role && participant.online);

  useEffect(() => {
    if (!connected) return;
    let pointer: { x: number; y: number } | null = null;
    let visible = false;
    let refreshFrame = 0;

    const hide = () => {
      pointer = null;
      setLocalPosition(null);
      if (visible) sendCursor(null);
      visible = false;
    };
    const publish = () => {
      if (!pointer || document.hidden || !document.hasFocus()) { hide(); return; }
      const target = document.elementFromPoint(pointer.x, pointer.y);
      if (!target) { hide(); return; }
      // The iframe reports entry only; keep an explicitly marked last-known position.
      const overPlayer = target instanceof HTMLIFrameElement;
      const anchor = target.closest<HTMLElement>('.sticky-note') ?? target.closest<HTMLElement>('[data-cursor-anchor]');
      if (!anchor) { hide(); return; }
      const bounds = anchor.getBoundingClientRect();
      if (!bounds.width || !bounds.height) { hide(); return; }
      const name = anchor.dataset.cursorAnchor as NonNullable<CursorPosition>['anchor'];
      visible = true;
      const position = {
        anchor: name,
        ...(anchor.dataset.cursorItem ? { queueItemId: anchor.dataset.cursorItem } : {}),
        ...(anchor.dataset.cursorNote ? { noteId: anchor.dataset.cursorNote } : {}),
        shape: overPlayer ? 'default' as const : cursorShapeAt(target, pointer.x, pointer.y),
        overPlayer,
        x: Math.max(0, Math.min(1, (pointer.x - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (pointer.y - bounds.top) / bounds.height)),
      };
      setLocalPosition(position);
      sendCursor(position);
    };
    const refresh = () => {
      cancelAnimationFrame(refreshFrame);
      refreshFrame = requestAnimationFrame(publish);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') { hide(); return; }
      pointer = { x: event.clientX, y: event.clientY };
      publish();
    };
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      if (document.elementFromPoint(event.clientX, event.clientY) instanceof HTMLIFrameElement) {
        pointer = { x: event.clientX, y: event.clientY };
        publish();
      } else hide();
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointer = { x: event.clientX, y: event.clientY };
      refresh();
    };
    const observer = new MutationObserver(changes => {
      if (pointer && changes.some(change => change.target instanceof Element && !change.target.closest('.room-cursor-layer'))) refresh();
    });
    const room = document.querySelector('[data-cursor-anchor="room"]');
    if (room) observer.observe(room, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'style', 'disabled', 'readonly', 'contenteditable'],
    });
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerdown', refresh, { passive: true });
    document.addEventListener('pointerup', refresh, { passive: true });
    document.addEventListener('pointercancel', refresh, { passive: true });
    document.addEventListener('pointerout', leave);
    document.addEventListener('pointerover', enter);
    document.addEventListener('visibilitychange', hide);
    document.addEventListener('scroll', publish, { capture: true, passive: true });
    window.addEventListener('resize', publish);
    window.addEventListener('blur', refresh);
    window.addEventListener('pagehide', hide);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(refreshFrame);
      hide();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', refresh);
      document.removeEventListener('pointerup', refresh);
      document.removeEventListener('pointercancel', refresh);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('pointerover', enter);
      document.removeEventListener('visibilitychange', hide);
      document.removeEventListener('scroll', publish, true);
      window.removeEventListener('resize', publish);
      window.removeEventListener('blur', refresh);
      window.removeEventListener('pagehide', hide);
    };
  }, [connected, sendCursor]);

  if (!connected) return null;
  return <div className="room-cursor-layer" aria-hidden="true">
    {localPosition && <CursorMarker position={localPosition} role={role} displayName={`${displayName} (you)`} local />}
    {cursor?.position && person && <CursorMarker position={cursor.position} role={cursor.role} displayName={person.displayName} />}
  </div>;
}

function CursorMarker({ position, role, displayName, local = false }: {
  position: NonNullable<CursorPosition>;
  role: Role;
  displayName: string;
  local?: boolean;
}) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const shape = position.shape ?? 'default';
  const ShapeIcon = shape === 'default' || shape === 'none' ? undefined : cursorIcons[shape];
  useLayoutEffect(() => {
    const element = cursorRef.current;
    if (!element) return;
    const selector = position.noteId
      ? `.sticky-note[data-cursor-note="${position.noteId}"]`
      : position.queueItemId ? `[data-cursor-item="${position.queueItemId}"]` : `[data-cursor-anchor="${position.anchor}"]`;
    const anchor = document.querySelector<HTMLElement>(selector);
    let wasVisible = element.style.visibility === 'visible';
    const place = () => {
      element.style.visibility = 'hidden';
      if (!anchor?.isConnected || document.hidden) { wasVisible = false; return; }
      const bounds = anchor.getBoundingClientRect();
      const x = bounds.left + bounds.width * position.x;
      const y = bounds.top + bounds.height * position.y;
      const queue = anchor.closest('.queue-list')?.getBoundingClientRect();
      if (!bounds.width || !bounds.height || x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight
        || (queue && (x < queue.left || x > queue.right || y < queue.top || y > queue.bottom))) {
        wasVisible = false;
        return;
      }
      element.style.transitionDuration = wasVisible ? '' : '0s';
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      element.style.visibility = 'visible';
      const label = element.querySelector<HTMLElement>('.room-cursor-name');
      if (label) {
        const shiftX = Math.min(0, window.innerWidth - x - label.offsetWidth - 8);
        const shiftY = y + 38 + label.offsetHeight > window.innerHeight ? -38 - label.offsetHeight - 5 : 0;
        label.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
      }
      wasVisible = true;
    };
    place();
    const observer = new ResizeObserver(place);
    if (anchor) observer.observe(anchor);
    const mutations = new MutationObserver(place);
    if (anchor) {
      mutations.observe(anchor, { attributes: true, attributeFilter: ['style', 'class'] });
      if (anchor.parentElement) mutations.observe(anchor.parentElement, { childList: true });
    }
    document.addEventListener('scroll', place, { capture: true, passive: true });
    document.addEventListener('visibilitychange', place);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      document.removeEventListener('scroll', place, true);
      document.removeEventListener('visibilitychange', place);
      window.removeEventListener('resize', place);
    };
  }, [position, displayName]);

  return <div ref={cursorRef} className={`room-cursor room-cursor-${role}${local ? ' room-cursor-local' : ''}`}>
    {!local && shape !== 'none' && (ShapeIcon
      ? <span className={`room-cursor-symbol room-cursor-symbol-${shape}`}><ShapeIcon size={24} /></span>
      : <span className="room-cursor-arrow"><span /></span>)}
    <span className="room-cursor-name">{displayName}{position.overPlayer ? ' · in YouTube' : ''}</span>
  </div>;
}
