import { cursorShapeSchema, type CursorShape } from '../shared/protocol';

export function cursorShapeAt(target: Element, x: number, y: number): CursorShape {
  const style = getComputedStyle(target);
  const cursor = style.cursor.split(',').pop()?.trim();
  const explicit = cursorShapeSchema.options.find(shape => shape === cursor);
  if (explicit) return explicit;
  if (cursor !== 'auto') return 'default';

  if ((target instanceof HTMLElement && target.isContentEditable)
    || (target instanceof HTMLTextAreaElement && !target.disabled)
    || (target instanceof HTMLInputElement && !target.disabled
      && ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(target.type))) {
    return 'text';
  }
  if (style.userSelect === 'none') return 'default';

  // An auto cursor becomes a caret over actual text, not the element's padding.
  const node = document.caretPositionFromPoint?.(x, y)?.offsetNode
    ?? document.caretRangeFromPoint?.(x, y)?.startContainer;
  if (node?.nodeType === Node.TEXT_NODE && target.contains(node)) {
    const range = document.createRange();
    range.selectNodeContents(node);
    if ([...range.getClientRects()].some(bounds => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom)) {
      return style.writingMode.startsWith('vertical') ? 'vertical-text' : 'text';
    }
  }
  return 'default';
}
