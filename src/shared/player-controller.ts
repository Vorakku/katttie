import { expectedPositionSec } from './playback-math';
import type { PlaybackState, SendCommand } from './protocol';

export interface PlayerAdapter {
  cueVideoById(video: { videoId: string; startSeconds: number }): void;
  loadVideoById(video: { videoId: string; startSeconds: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(position: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  // Undefined until a video is cued into the player.
  getVideoData(): { video_id?: string; title?: string; author?: string } | undefined;
}

export class PlayerCommandController {
  private playback: PlaybackState | null = null;
  private offsetMs = 0;
  private activated = false;
  private connected = true;
  private suppressUntilMs = 0;
  private lastCorrectionMs = -Infinity;
  private lastState = -1;
  private stableState = -1;
  private endedKey = '';
  private lastIntentKey = '';
  private positionSample: { position: number; timeMs: number; state: number } | null = null;
  private positionConfirmed = false;

  constructor(
    private player: PlayerAdapter,
    private send: SendCommand,
    private now = Date.now,
    private onError: (message: string) => void = () => {},
  ) {}

  setConnected(connected: boolean) { this.connected = connected; }

  apply(playback: PlaybackState, offsetMs: number, activated: boolean, force = false) {
    const previous = this.playback;
    this.playback = playback;
    this.offsetMs = offsetMs;
    this.activated = activated;
    if (!force && previous?.revision === playback.revision && previous.videoId === playback.videoId) return;
    this.suppressUntilMs = this.now() + 1800;
    this.positionConfirmed = false;
    if (!playback.videoId) {
      this.player.pauseVideo();
      return;
    }
    const position = this.targetPosition();
    this.positionSample = { position, timeMs: this.now(), state: playback.status === 'playing' && activated ? 1 : 2 };
    if (previous?.videoId !== playback.videoId) {
      const video = { videoId: playback.videoId, startSeconds: position };
      if (activated && playback.status === 'playing') this.player.loadVideoById(video);
      else this.player.cueVideoById(video);
      this.lastState = -1;
      this.stableState = -1;
      return;
    }
    this.player.seekTo(position, true);
    if (activated && playback.status === 'playing') this.player.playVideo();
    else this.player.pauseVideo();
  }

  correctDrift(scrubbing: boolean) {
    if (!this.connected || !this.activated || scrubbing || this.playback?.status !== 'playing' || this.player.getPlayerState() !== 1) return;
    if (this.currentVideoId() !== this.playback.videoId) return;
    if (this.now() - this.lastCorrectionMs < 12_000) return;
    const target = this.targetPosition();
    if (Math.abs(this.player.getCurrentTime() - target) <= 1.5) return;
    this.lastCorrectionMs = this.now();
    this.suppressUntilMs = this.now() + 1800;
    this.positionConfirmed = false;
    this.player.seekTo(target, true);
    this.positionSample = { position: target, timeMs: this.now(), state: 1 };
  }

  samplePosition() {
    const state = this.player.getPlayerState();
    if (state !== 1 && state !== 2) return;
    const position = this.player.getCurrentTime();
    this.confirmPosition(position);
    this.detectNativeSeek(position);
    this.positionSample = { position, timeMs: this.now(), state };
  }

  onStateChange(state: number) {
    const previousState = this.lastState;
    const previousStable = this.stableState;
    this.lastState = state;
    if (state === 1 || state === 2) this.stableState = state;
    const playback = this.playback;
    if (!this.connected || !playback?.videoId || this.currentVideoId() !== playback.videoId) return;
    if (state === 1 || state === 2) this.confirmPosition(this.player.getCurrentTime());
    if (state === 0) {
      if (!this.activated || playback.status !== 'playing') return;
      const duration = this.player.getDuration();
      if (duration > 0 && this.player.getCurrentTime() < duration - 2) return;
      // A delayed ENDED from before an asynchronous seek belongs to the previous operation.
      if (!this.positionConfirmed && (duration <= 0 || this.targetPosition() < duration - 2)) return;
      const key = `${playback.videoId}:${playback.revision}`;
      if (key === this.endedKey) return;
      this.endedKey = key;
      void this.send('playback:ended', { videoId: playback.videoId, playbackRevision: playback.revision }).then(result => {
        if (!result.ok) this.onError(result.message);
      }).catch(() => this.onError('The end of this song could not be sent. Use Next to continue.'));
      return;
    }
    if (this.now() < this.suppressUntilMs || state === previousState) return;
    if (state === 3) {
      const sample = this.positionSample;
      if (this.activated && this.positionConfirmed && sample && this.now() - sample.timeMs <= 2500) {
        const elapsed = sample.state === 1 ? Math.max(0, (this.now() - sample.timeMs) / 1000) : 0;
        // Freeze the comparison point so buffering time cannot hide a native seek.
        this.positionSample = { position: sample.position + elapsed, timeMs: this.now(), state: 3 };
      }
      return;
    }
    const position = this.player.getCurrentTime();
    const nativeSeek = (state === 1 || state === 2) && previousState === 3 && this.detectNativeSeek(position);
    if (nativeSeek) {
      this.positionSample = { position, timeMs: this.now(), state };
      return;
    }
    if (state === 2 && previousStable === 1 && previousState !== 3 && playback.status === 'playing') {
      this.intent('PAUSE');
    } else if (state === 1 && previousStable === 2 && playback.status === 'paused') {
      this.intent('PLAY');
    } else if (state === 1 && !this.activated && playback.status === 'paused') {
      this.intent('PLAY');
    }
    if (state === 1 || state === 2) this.positionSample = { position, timeMs: this.now(), state };
  }

  private detectNativeSeek(position: number) {
    const sample = this.positionSample;
    if (!sample || !this.connected || !this.activated || !this.positionConfirmed || !this.playback?.videoId || this.now() < this.suppressUntilMs) return false;
    if (this.currentVideoId() !== this.playback.videoId || (sample.state !== 3 && this.now() - sample.timeMs > 2500)) return false;
    const elapsed = sample.state === 1 ? Math.max(0, (this.now() - sample.timeMs) / 1000) : 0;
    const jump = position - sample.position;
    if (jump >= -2 && jump <= elapsed + 2) return false;
    if (Math.abs(position - this.targetPosition()) <= 2) return false;
    this.intent('SEEK', position);
    return true;
  }

  private confirmPosition(position: number) {
    if (this.playback?.videoId === this.currentVideoId() && Math.abs(position - this.targetPosition()) <= 2) this.positionConfirmed = true;
  }

  private currentVideoId() {
    return this.player.getVideoData()?.video_id;
  }

  private targetPosition() {
    if (!this.playback) return 0;
    const duration = this.player.getDuration();
    const durationKnown = this.currentVideoId() === this.playback.videoId && duration > 0;
    return expectedPositionSec(this.playback, this.now() + this.offsetMs, durationKnown ? duration : undefined);
  }

  private intent(action: 'PLAY' | 'PAUSE' | 'SEEK', positionSec?: number) {
    if (!this.playback) return;
    const key = `${this.playback.revision}:${action}:${positionSec ?? ''}`;
    if (this.lastIntentKey === key) return;
    this.lastIntentKey = key;
    void this.send('playback:control', {
      action, ...(positionSec === undefined ? {} : { positionSec }),
      expectedPlaybackRevision: this.playback.revision, requestId: crypto.randomUUID(),
    }).then(result => {
      if (!result.ok) this.onError(result.message);
    }).catch(() => this.onError('The playback change could not be sent. Try again.'));
  }
}
