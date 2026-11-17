import { describe, expect, it } from 'vitest';
import { buildGuestInvite, consumeInvite, readAccess, saveAccess } from '../src/lib/credentials';

const roomId = 'a-private-room-id-123';
const guestSecret = 'g'.repeat(32);
const hostSecret = 'h'.repeat(32);
function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); },
  };
}
describe('private room access', () => {
  it('captures a guest secret, removes the fragment, and restores the saved access', () => {
    const store = storage();
    const replacements: string[] = [];
    const result = consumeInvite(roomId, { hash: `#key=${guestSecret}`, pathname: `/r/${roomId}`, search: '' },
      { replaceState: (_data, _unused, url) => { replacements.push(String(url)); } }, store);
    expect(replacements).toEqual([`/r/${roomId}`]);
    expect(result.access).toEqual({ role: 'guest', credential: guestSecret, displayName: '' });
    expect(readAccess(roomId, store)).toEqual(result.access);
  });
  it('keeps the host credential local and puts only the guest credential in invitations', () => {
    const store = storage();
    const host = { role: 'host' as const, credential: hostSecret, guestSecret, displayName: 'Luna' };
    expect(saveAccess(roomId, host, store)).toBe(true);
    const result = consumeInvite(roomId, { hash: `#key=${guestSecret}`, pathname: `/r/${roomId}`, search: '' },
      { replaceState: () => {} }, store);
    expect(result.access).toEqual(host);
    expect(buildGuestInvite('https://radio.example', roomId, host)).toBe(`https://radio.example/r/${roomId}#key=${guestSecret}`);
    expect(buildGuestInvite('https://radio.example', roomId, host)).not.toContain(hostSecret);
  });
  it('removes an invalid invite fragment without saving it', () => {
    const store = storage();
    let cleaned = false;
    const result = consumeInvite(roomId, { hash: '#key=short', pathname: `/r/${roomId}`, search: '' },
      { replaceState: () => { cleaned = true; } }, store);
    expect(cleaned).toBe(true);
    expect(result.access).toBeNull();
    expect(store.length).toBe(0);
  });
  it('retains access for this visit when browser storage is blocked', () => {
    const store = storage();
    store.getItem = () => { throw new Error('blocked'); };
    store.setItem = () => { throw new Error('blocked'); };
    const result = consumeInvite(roomId, { hash: `#key=${guestSecret}`, pathname: `/r/${roomId}`, search: '' },
      { replaceState: () => {} }, store);
    expect(result.access?.credential).toBe(guestSecret);
    expect(result.persisted).toBe(false);
  });
  it('ignores malformed saved access rather than crashing or accepting a forged role', () => {
    const store = storage();
    saveAccess(roomId, { role: 'guest', credential: guestSecret, displayName: 'Guest' }, store);
    store.setItem(store.key(0)!, JSON.stringify({ role: 'admin', credential: guestSecret }));
    expect(readAccess(roomId, store)).toBeNull();
  });
});
