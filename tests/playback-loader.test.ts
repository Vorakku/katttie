import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

function fakeBrowser() {
  const scripts: Array<{ src: string; onerror: (() => void) | null; remove: () => void }> = [];
  const window: { YT?: { Player: unknown }; onYouTubeIframeAPIReady?: () => void } = {};
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', {
    createElement: () => { const element = { src: '', onerror: null, remove: vi.fn() }; scripts.push(element); return element; },
    head: { appendChild: vi.fn() },
  });
  return { window, scripts };
}

describe('official iframe SDK loader', () => {
  it('shares one pending SDK promise across mounts', async () => {
    const browser = fakeBrowser();
    const { loadYouTubeApi } = await import('../src/lib/youtube-api-loader');
    const first = loadYouTubeApi();
    const second = loadYouTubeApi();
    expect(first).toBe(second);
    expect(browser.scripts).toHaveLength(1);
    expect(browser.scripts[0].src).toBe('https://www.youtube.com/iframe_api');
    browser.window.YT = { Player: class {} };
    browser.window.onYouTubeIframeAPIReady?.();
    expect(await first).toBe(browser.window.YT);
  });

  it('clears a failed load so the listener can retry', async () => {
    const browser = fakeBrowser();
    const { loadYouTubeApi } = await import('../src/lib/youtube-api-loader');
    const first = loadYouTubeApi();
    browser.scripts[0].onerror?.();
    await expect(first).rejects.toThrow('YouTube');
    const second = loadYouTubeApi();
    expect(browser.scripts).toHaveLength(2);
    browser.window.YT = { Player: class {} };
    browser.window.onYouTubeIframeAPIReady?.();
    await expect(second).resolves.toBe(browser.window.YT);
  });

  it('bounds a stalled SDK request and allows retry', async () => {
    vi.useFakeTimers();
    const browser = fakeBrowser();
    const { loadYouTubeApi } = await import('../src/lib/youtube-api-loader');
    const stalled = loadYouTubeApi();
    const rejected = expect(stalled).rejects.toThrow('YouTube');
    await vi.advanceTimersByTimeAsync(15_001);
    await rejected;
    const retry = loadYouTubeApi();
    browser.window.YT = { Player: class {} };
    browser.window.onYouTubeIframeAPIReady?.();
    await expect(retry).resolves.toBe(browser.window.YT);
  });
});
