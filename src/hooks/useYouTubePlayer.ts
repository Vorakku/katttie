import { useEffect, useRef, useState } from 'react';
import { loadYouTubeApi, type YouTubePlayerInstance } from '../lib/youtube-api-loader';

export function useYouTubePlayer(onStateChange: (state: number) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callback = useRef(onStateChange);
  callback.current = onStateChange;
  const [player, setPlayer] = useState<YouTubePlayerInstance | null>(null);
  const [localState, setLocalState] = useState(-1);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let instance: YouTubePlayerInstance | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const host = containerRef.current;
    setPlayer(null);
    setError(null);
    setBlocked(false);
    setLocalState(-1);
    void loadYouTubeApi().then(api => {
      if (cancelled || !host) return;
      const target = document.createElement('div');
      host.replaceChildren(target);
      readyTimer = setTimeout(() => {
        if (!cancelled) setError('YouTube is taking too long to respond. Try loading the player again.');
      }, 20_000);
      instance = new api.Player(target, {
        width: '100%', height: '100%',
        playerVars: { origin: window.location.origin, playsinline: 1, controls: 1, autoplay: 0 },
        events: {
          onReady: event => {
            if (cancelled) return;
            clearTimeout(readyTimer);
            const iframe = event.target.getIframe();
            iframe.title = 'YouTube shared listening player';
            iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
            iframe.referrerPolicy = 'strict-origin-when-cross-origin';
            setError(null);
            setPlayer(event.target);
          },
          onStateChange: event => {
            if (cancelled) return;
            setLocalState(event.data);
            if (event.data === 1) { setBlocked(false); setError(null); }
            callback.current(event.data);
          },
          onAutoplayBlocked: () => { if (!cancelled) setBlocked(true); },
          onError: event => {
            if (cancelled) return;
            const messages: Record<number, string> = {
              2: 'This YouTube video link could not be played. Try another link.',
              5: 'YouTube could not play this video in this browser. Try again or choose another song.',
              100: 'This video is unavailable, private, or has been deleted. Try another YouTube link.',
              101: 'This video’s owner does not allow embedded playback. Try another YouTube link.',
              150: 'This video’s owner does not allow embedded playback. Try another YouTube link.',
              153: 'YouTube could not identify this embed. Reload the player from the app’s normal HTTPS address.',
            };
            setError(messages[event.data] ?? 'YouTube could not play this video. Try again or choose another song.');
          },
        },
      });
    }).catch(reason => {
      clearTimeout(readyTimer);
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'YouTube could not load. Please try again.');
    });
    return () => {
      cancelled = true;
      clearTimeout(readyTimer);
      instance?.destroy();
      host?.replaceChildren();
    };
  }, [attempt]);

  return { containerRef, player, localState, blocked, error, retry: () => setAttempt(value => value + 1), clearBlocked: () => setBlocked(false) };
}
