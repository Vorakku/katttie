import type { PlayerAdapter } from '../shared/player-controller';

export interface YouTubePlayerInstance extends PlayerAdapter {
  destroy(): void;
  setVolume(volume: number): void;
  getIframe(): HTMLIFrameElement;
}

export type YouTubeApi = {
  Player: new (target: HTMLElement, options: {
    width: string; height: string;
    playerVars: { origin: string; playsinline: number; controls: number; autoplay: number };
    events: {
      onReady(event: { target: YouTubePlayerInstance }): void;
      onStateChange(event: { data: number; target: YouTubePlayerInstance }): void;
      onError(event: { data: number }): void;
      onAutoplayBlocked(): void;
    };
  }) => YouTubePlayerInstance;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let pending: Promise<YouTubeApi> | null = null;

export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;
  pending = new Promise<YouTubeApi>((resolve, reject) => {
    const script = document.createElement('script');
    const previousCallback = window.onYouTubeIframeAPIReady;
    const finish = () => {
      clearTimeout(timeout);
      script.onerror = null;
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previousCallback;
    };
    const fail = () => {
      finish();
      script.remove();
      pending = null;
      reject(new Error('YouTube could not load. Check your connection and try again.'));
    };
    const ready = () => {
      if (!window.YT?.Player) return;
      finish();
      resolve(window.YT);
      previousCallback?.();
    };
    const timeout = setTimeout(fail, 15_000);
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = fail;
    window.onYouTubeIframeAPIReady = ready;
    document.head.appendChild(script);
  });
  return pending;
}
