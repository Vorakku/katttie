const hosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

export function extractYouTubeVideoId(raw: string): string | null {
  if (raw.length > 2048) return null;
  try {
    const url = new URL(raw.trim());
    if (!['https:', 'http:'].includes(url.protocol) || !hosts.has(url.hostname) || url.username || url.password || url.port) return null;
    let id: string | null = null;
    if (url.hostname === 'youtu.be') {
      if (/^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[1];
    } else if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      id = url.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

export function extractYouTubePlaylistId(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (!['https:', 'http:'].includes(url.protocol) || !hosts.has(url.hostname) || url.pathname !== '/playlist') return null;
    const id = url.searchParams.get('list');
    return id && /^[A-Za-z0-9_-]{10,64}$/.test(id) ? id : null;
  } catch { return null; }
}

export type YouTubeLink = { videoId: string } | { playlistId: string };

// Finds every video or playlist link in pasted text or a file. Links may be glued
// together when a single-line input drops the newlines, so split at each "http".
export function findYouTubeLinks(text: string): YouTubeLink[] {
  const links: YouTubeLink[] = [];
  for (const raw of text.match(/https?:\/\/.*?(?=https?:\/\/|\s|$)/g) ?? []) {
    const playlistId = extractYouTubePlaylistId(raw);
    const videoId = playlistId ? null : extractYouTubeVideoId(raw);
    if (playlistId) links.push({ playlistId });
    else if (videoId) links.push({ videoId });
  }
  return links;
}
