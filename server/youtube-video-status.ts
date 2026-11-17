import { z } from 'zod';
import { videoIdSchema } from '../src/shared/protocol';

export class VideoStatusError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export type VideoStatus = { madeForKids: boolean | null; title: string | null };
export type VideoStatusService = { check(videoId: string): Promise<VideoStatus>; playlist?(playlistId: string): Promise<string[]> };
type StatusOptions = { apiKey?: string; prototypeMode?: boolean; fetch?: typeof fetch; now?: () => number; maxCacheEntries?: number };

export class YouTubeVideoStatusService implements VideoStatusService {
  private cache = new Map<string, { expires: number; value: VideoStatus }>();
  constructor(private options: StatusOptions = {}) {}
  async check(videoId: string): Promise<VideoStatus> {
    if (!videoIdSchema.safeParse(videoId).success) throw new VideoStatusError('INVALID_VIDEO', 'Use a valid YouTube video link.');
    const now = (this.options.now ?? Date.now)();
    const cached = this.cache.get(videoId);
    if (cached && cached.expires > now) return cached.value;
    if (!this.options.apiKey) {
      if (this.options.prototypeMode) return { madeForKids: null, title: await this.oembedTitle(videoId) };
      throw new VideoStatusError('VIDEO_STATUS_UNAVAILABLE', 'The server needs a YouTube Data API key before songs can be added.');
    }
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({ part: 'id,status,snippet', id: videoId, key: this.options.apiKey }).toString();
    let response: Response;
    try { response = await (this.options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(8000) }); }
    catch { throw new VideoStatusError('VIDEO_STATUS_UNAVAILABLE', 'YouTube status could not be checked. Try again.'); }
    if (!response.ok) throw new VideoStatusError('VIDEO_STATUS_UNAVAILABLE', 'YouTube status is temporarily unavailable. Check the server API key and quota.');
    const schema = z.object({ items: z.array(z.object({ id: videoIdSchema, status: z.object({ madeForKids: z.boolean(), embeddable: z.boolean() }), snippet: z.object({ title: z.string() }).optional() })) });
    let parsed: ReturnType<typeof schema.safeParse>;
    try { parsed = schema.safeParse(await response.json()); }
    catch { throw new VideoStatusError('VIDEO_STATUS_UNAVAILABLE', 'YouTube returned an invalid status response.'); }
    if (!parsed.success) throw new VideoStatusError('VIDEO_STATUS_UNAVAILABLE', 'YouTube did not provide the required video status.');
    const item = parsed.data.items.find(item => item.id === videoId);
    if (!item || !item.status.embeddable) throw new VideoStatusError('VIDEO_UNAVAILABLE', 'This video cannot be played here. Try another YouTube link.');
    const value = { madeForKids: item.status.madeForKids, title: item.snippet?.title.slice(0, 200) || null };
    for (const [key, entry] of this.cache) if (entry.expires <= now) this.cache.delete(key);
    if (this.cache.size >= (this.options.maxCacheEntries ?? 1000)) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(videoId, { expires: now + 24 * 60 * 60 * 1000, value });
    return value;
  }

  // First 50 videos of a public playlist (the queue holds 50 at most).
  async playlist(playlistId: string): Promise<string[]> {
    if (!this.options.apiKey) throw new VideoStatusError('PLAYLIST_UNAVAILABLE', 'Playlist links need the server’s YouTube Data API key. Paste the song links instead.');
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.search = new URLSearchParams({ part: 'contentDetails', maxResults: '50', playlistId, key: this.options.apiKey }).toString();
    let response: Response;
    try { response = await (this.options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(8000) }); }
    catch { throw new VideoStatusError('VIDEO_STATUS_UNAVAILABLE', 'The playlist could not be loaded. Try again.'); }
    if (response.status === 404) throw new VideoStatusError('PLAYLIST_UNAVAILABLE', 'This playlist is private or does not exist. Mixes and private playlists can’t be imported.');
    if (!response.ok) throw new VideoStatusError('VIDEO_STATUS_UNAVAILABLE', 'YouTube could not load this playlist right now.');
    const parsed = z.object({ items: z.array(z.object({ contentDetails: z.object({ videoId: videoIdSchema }) })) }).safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new VideoStatusError('VIDEO_STATUS_UNAVAILABLE', 'YouTube returned an invalid playlist response.');
    return parsed.data.items.map(item => item.contentDetails.videoId);
  }

  // Keyless title lookup for prototype mode; a missing title is fine, so failures return null.
  private async oembedTitle(videoId: string): Promise<string | null> {
    try {
      const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
      const response = await (this.options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const title = z.object({ title: z.string() }).safeParse(await response.json());
      return title.success ? title.data.title.slice(0, 200) || null : null;
    } catch { return null; }
  }
}
