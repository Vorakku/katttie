import type { PlaybackState } from './protocol';
export type ClockSample = { clientSentAtMs: number; clientReceivedAtMs: number; serverNowMs: number };
export function expectedPositionSec(playback: PlaybackState, estimatedServerNowMs: number, durationSec?: number): number {
  const elapsed = playback.status === 'playing' ? Math.max(0, (estimatedServerNowMs - playback.anchorServerTimeMs) / 1000) : 0;
  const position = Math.max(0, playback.anchorPositionSec + elapsed);
  return typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec >= 0 ? Math.min(position, durationSec) : position;
}
export function selectClockOffset(samples: ClockSample[]): number {
  const best = samples.reduce<ClockSample | undefined>((previous, sample) => !previous || sample.clientReceivedAtMs - sample.clientSentAtMs < previous.clientReceivedAtMs - previous.clientSentAtMs ? sample : previous, undefined);
  return best ? best.serverNowMs - (best.clientSentAtMs + best.clientReceivedAtMs) / 2 : 0;
}
