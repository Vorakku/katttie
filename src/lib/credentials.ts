import type { Role } from '../shared/protocol';

export type SavedAccess = { role: Role; credential: string; guestSecret?: string; displayName: string };
const secretPattern = /^[A-Za-z0-9_-]{32,128}$/;
const storageKey = (roomId: string) => `our-little-radio:room:${roomId}`;

export function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function readAccess(roomId: string, storage: Storage | null = browserStorage()): SavedAccess | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(storageKey(roomId)) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const access = value as Partial<SavedAccess>;
    if ((access.role !== 'host' && access.role !== 'guest') || typeof access.credential !== 'string' ||
      !secretPattern.test(access.credential) || typeof access.displayName !== 'string' || [...access.displayName].length > 24 ||
      (access.guestSecret !== undefined && (typeof access.guestSecret !== 'string' || !secretPattern.test(access.guestSecret)))) return null;
    return { role: access.role, credential: access.credential, displayName: access.displayName,
      ...(access.role === 'host' && access.guestSecret ? { guestSecret: access.guestSecret } : {}) };
  } catch { return null; }
}

export function saveAccess(roomId: string, access: SavedAccess, storage: Storage | null = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(storageKey(roomId), JSON.stringify(access));
    return true;
  } catch { return false; }
}

export function consumeInvite(
  roomId: string,
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
  storage: Storage | null = browserStorage(),
): { access: SavedAccess | null; persisted: boolean } {
  const secret = new URLSearchParams(location.hash.slice(1)).get('key');
  // Strip the capability before rendering anything that can contact a third party.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const previous = readAccess(roomId, storage);
  if (!secret || !secretPattern.test(secret) || previous?.role === 'host') return { access: previous, persisted: !!previous };
  const access: SavedAccess = { role: 'guest', credential: secret, displayName: previous?.displayName ?? '' };
  return { access, persisted: saveAccess(roomId, access, storage) };
}

export function buildGuestInvite(origin: string, roomId: string, access: SavedAccess): string {
  const secret = access.role === 'host' ? access.guestSecret : access.credential;
  if (!secret || !secretPattern.test(secret)) throw new Error('The guest invitation is unavailable.');
  return `${origin}/r/${encodeURIComponent(roomId)}#key=${encodeURIComponent(secret)}`;
}
