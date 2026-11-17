import { describe, expect, it, vi } from 'vitest';
import { PlayerCommandController, type PlayerAdapter } from '../src/shared/player-controller';
import type { PlaybackState, SendCommand } from '../src/shared/protocol';

function setup() {
  let now = 100_000;
  let time = 0;
  let state = 2;
  let videoId = '';
  const calls: string[] = [];
  const player: PlayerAdapter = {
    cueVideoById: ({ videoId: id, startSeconds }) => { videoId = id; time = startSeconds; calls.push('cue'); },
    loadVideoById: ({ videoId: id, startSeconds }) => { videoId = id; time = startSeconds; calls.push('load'); },
    playVideo: () => { state = 1; calls.push('play'); },
    pauseVideo: () => { state = 2; calls.push('pause'); },
    seekTo: position => { time = position; calls.push('seek'); },
    getCurrentTime: () => time,
    getDuration: () => 300,
    getPlayerState: () => state,
    getVideoData: () => ({ video_id: videoId }),
  };
  const send = vi.fn<SendCommand>().mockResolvedValue({ ok: true });
  const controller = new PlayerCommandController(player, send, () => now);
  const playback: PlaybackState = { videoId: 'abcdefghijk', currentQueueItemId: 'song', status: 'playing', anchorPositionSec: 10, anchorServerTimeMs: 90_000, revision: 1 };
  return { controller, playback, calls, send, player, setTime: (value: number) => { time = value; }, setState: (value: number) => { state = value; }, advance: (ms: number) => { now += ms; } };
}

describe('canonical playback', () => {
  it('cues without autoplay before local activation and activates at the live anchor', () => {
    const s = setup();
    s.controller.apply(s.playback, 0, false);
    expect(s.calls).toEqual(['cue']);
    expect(s.player.getCurrentTime()).toBe(20);
    s.advance(5000);
    s.controller.apply(s.playback, 0, true, true);
    expect(s.player.getCurrentTime()).toBe(25);
    expect(s.calls).toEqual(['cue', 'seek', 'play']);
    expect(s.send).not.toHaveBeenCalled();
  });

  it('does not broadcast programmatic play, pause, or seek events', () => {
    const s = setup();
    s.controller.apply(s.playback, 0, true);
    s.controller.onStateChange(1);
    s.controller.onStateChange(2);
    s.controller.onStateChange(1);
    expect(s.send).not.toHaveBeenCalled();
  });

  it('detects clear native pause, play, and seek after programmatic correlation ends', () => {
    const s = setup();
    s.controller.apply(s.playback, 0, true);
    s.controller.onStateChange(1);
    s.advance(3000);
    s.setTime(23);
    s.controller.onStateChange(2);
    expect(s.send).toHaveBeenLastCalledWith('playback:control', expect.objectContaining({ action: 'PAUSE', expectedPlaybackRevision: 1 }));
    s.controller.apply({ ...s.playback, status: 'paused', revision: 2, anchorPositionSec: 23 }, 0, true);
    s.advance(3000);
    s.controller.onStateChange(1);
    expect(s.send).toHaveBeenLastCalledWith('playback:control', expect.objectContaining({ action: 'PLAY' }));
    s.advance(3000);
    s.controller.samplePosition();
    s.setTime(90);
    s.controller.onStateChange(3);
    s.controller.onStateChange(1);
    expect(s.send).toHaveBeenLastCalledWith('playback:control', expect.objectContaining({ action: 'SEEK', positionSec: 90 }));
  });

  it('corrects drift above tolerance with cooldown and skips buffering and scrubbing', () => {
    const s = setup();
    s.controller.apply(s.playback, 0, true);
    s.setState(1);
    s.advance(6000);
    s.setTime(0);
    s.controller.correctDrift(false);
    expect(s.calls.filter(call => call === 'seek')).toHaveLength(1);
    s.advance(6000);
    s.setTime(0);
    s.controller.correctDrift(false);
    expect(s.calls.filter(call => call === 'seek')).toHaveLength(1);
    s.advance(6000);
    s.controller.correctDrift(true);
    s.setState(3);
    s.controller.correctDrift(false);
    expect(s.calls.filter(call => call === 'seek')).toHaveLength(1);
    s.setState(1);
    s.controller.correctDrift(false);
    expect(s.calls.filter(call => call === 'seek')).toHaveLength(2);
  });

  it('sends each ended video/revision once and ignores previous video events', () => {
    const s = setup();
    s.controller.apply(s.playback, 0, true);
    s.controller.onStateChange(1);
    s.setTime(300);
    s.controller.onStateChange(0);
    s.controller.onStateChange(0);
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.send).toHaveBeenCalledWith('playback:ended', { videoId: 'abcdefghijk', playbackRevision: 1 });
    s.player.getVideoData = () => ({ video_id: 'oldvideo123' });
    s.controller.apply({ ...s.playback, revision: 2 }, 0, true);
    s.controller.onStateChange(0);
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it('does not broadcast buffering, blocked, or offline events', () => {
    const s = setup();
    s.controller.apply(s.playback, 0, true);
    s.advance(5000);
    s.controller.onStateChange(3);
    s.controller.setConnected(false);
    s.controller.onStateChange(2);
    s.controller.onStateChange(0);
    expect(s.send).not.toHaveBeenCalled();
  });

  it('ignores delayed programmatic resume and buffering without a position jump', () => {
    const s = setup();
    s.controller.apply(s.playback, 0, true);
    s.controller.onStateChange(2);
    s.advance(5000);
    s.setTime(25);
    s.controller.onStateChange(1);
    expect(s.send).not.toHaveBeenCalled();
    s.controller.samplePosition();
    s.controller.onStateChange(3);
    s.advance(15_000);
    s.setTime(25.1);
    s.controller.onStateChange(1);
    expect(s.send).not.toHaveBeenCalled();
  });

  it('recognizes native paused seeks from sampled position jumps', () => {
    const s = setup();
    s.controller.apply({ ...s.playback, status: 'paused' }, 0, true);
    s.advance(3000);
    s.controller.samplePosition();
    s.setTime(80);
    s.advance(500);
    s.controller.samplePosition();
    expect(s.send).toHaveBeenLastCalledWith('playback:control', expect.objectContaining({ action: 'SEEK', positionSec: 80 }));
  });

  it('does not use the previous video duration when loading a new song', () => {
    const s = setup();
    s.player.getDuration = () => 5;
    s.controller.apply(s.playback, 0, true);
    expect(s.player.getCurrentTime()).toBe(20);
  });

  it('ignores a stale ended event after a seek back on the same video', () => {
    const s = setup();
    s.controller.apply(s.playback, 0, true);
    s.controller.onStateChange(0);
    expect(s.send).not.toHaveBeenCalled();
  });

  it('does not stamp a delayed ended event with a newer asynchronous seek revision', () => {
    const s = setup();
    s.controller.apply(s.playback, 0, true);
    s.controller.onStateChange(1);
    s.setTime(300);
    s.controller.onStateChange(0);
    expect(s.send).toHaveBeenCalledTimes(1);
    s.player.seekTo = () => { s.calls.push('async-seek'); };
    s.controller.apply({ ...s.playback, revision: 2, anchorPositionSec: 0, anchorServerTimeMs: 100_000 }, 0, true);
    s.controller.onStateChange(0);
    expect(s.send).toHaveBeenCalledTimes(1);
    s.advance(5000);
    s.controller.onStateChange(0);
    expect(s.send).toHaveBeenCalledTimes(1);
    s.setTime(5);
    s.setState(1);
    s.controller.samplePosition();
    s.advance(295_000);
    s.setTime(300);
    s.controller.onStateChange(0);
    expect(s.send).toHaveBeenCalledTimes(2);
    expect(s.send).toHaveBeenLastCalledWith('playback:ended', { videoId: 'abcdefghijk', playbackRevision: 2 });
  });
});
