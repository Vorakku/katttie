import { describe, expect, it } from 'vitest';
import { extractYouTubeVideoId } from '../src/shared/youtube-url';
import { expectedPositionSec, selectClockOffset } from '../src/shared/playback-math';
import { schemas, type PlaybackState } from '../src/shared/protocol';

describe('YouTube URL boundary', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=test',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
  ])('normalizes supported link %s', url => expect(extractYouTubeVideoId(url)).toBe('dQw4w9WgXcQ'));
  it.each([
    'javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com/playlist?list=abc',
    'https://youtube.com/watch?v=short', 'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://user:password@youtube.com/watch?v=dQw4w9WgXcQ',
    'ftp://youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com:8080/watch?v=dQw4w9WgXcQ',
    'dQw4w9WgXcQ', 'not a URL',
  ])('rejects unsupported input %s', url => expect(extractYouTubeVideoId(url)).toBeNull());
});

const playing: PlaybackState = { currentQueueItemId: null, videoId: null, status: 'playing', anchorPositionSec: 12, anchorServerTimeMs: 10000, revision: 1 };
describe('canonical playback math', () => {
  it('advances from the server anchor', () => expect(expectedPositionSec(playing, 13500)).toBe(15.5));
  it('freezes paused state', () => expect(expectedPositionSec({ ...playing, status: 'paused' }, 13500)).toBe(12));
  it('clamps early clocks and known duration', () => {
    expect(expectedPositionSec(playing, 9000)).toBe(12);
    expect(expectedPositionSec(playing, 20000, 18)).toBe(18);
    expect(expectedPositionSec({ ...playing, anchorPositionSec: -2 }, 10000)).toBe(0);
    expect(expectedPositionSec(playing, 20000, Number.NaN)).toBe(22);
  });
  it('uses the least latent clock sample', () => {
    expect(selectClockOffset([
      { clientSentAtMs: 1000, clientReceivedAtMs: 1200, serverNowMs: 2000 },
      { clientSentAtMs: 2000, clientReceivedAtMs: 2020, serverNowMs: 3010 },
      { clientSentAtMs: 3000, clientReceivedAtMs: 3100, serverNowMs: 4000 },
    ])).toBe(1000);
    expect(selectClockOffset([])).toBe(0);
  });
});

describe('socket input validation', () => {
  it('rejects unknown keys, infinite positions, missing seek and invalid ids', () => {
    const base = { action: 'SEEK', expectedPlaybackRevision: 1, requestId: 'c3e6bdc0-08c5-4d86-aa0a-ab75b610a56d' };
    expect(schemas['playback:control'].safeParse(base).success).toBe(false);
    expect(schemas['playback:control'].safeParse({ ...base, positionSec: Infinity }).success).toBe(false);
    expect(schemas['playback:control'].safeParse({ ...base, positionSec: 12, role: 'host' }).success).toBe(false);
    expect(schemas['queue:add'].safeParse({ url: 'https://youtu.be/dQw4w9WgXcQ', requestId: 'same' }).success).toBe(false);
  });
  it('counts names by Unicode code points', () => {
    const base = { roomId: 'a'.repeat(32), credential: 'b'.repeat(32) };
    expect(schemas['room:join'].safeParse({ ...base, displayName: '\u2661'.repeat(24) }).success).toBe(true);
    expect(schemas['room:join'].safeParse({ ...base, displayName: '\u{1F600}'.repeat(25) }).success).toBe(false);
  });
});


