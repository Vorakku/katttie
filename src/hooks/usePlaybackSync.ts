import { useCallback, useEffect, useRef, useState } from 'react';
import { PlayerCommandController } from '../shared/player-controller';
import type { YouTubePlayerInstance } from '../lib/youtube-api-loader';
import type { PlaybackState, SendCommand } from '../shared/protocol';

export function usePlaybackSync({ player, playback, send, offsetMs, activated, connected, scrubbing, blocked, onError }: {
  player: YouTubePlayerInstance | null; playback: PlaybackState; send: SendCommand;
  offsetMs: number; activated: boolean; connected: boolean; scrubbing: boolean;
  blocked: boolean; onError: (message: string) => void;
}) {
  const controller = useRef<PlayerCommandController | null>(null);
  const flags = useRef({ scrubbing, blocked });
  flags.current = { scrubbing, blocked };
  const errorCallback = useRef(onError);
  errorCallback.current = onError;
  const previous = useRef({ activated: false, connected: false });
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!player) return;
    const current = new PlayerCommandController(player, send, Date.now, message => errorCallback.current(message));
    controller.current = current;
    previous.current = { activated: false, connected: false };
    const driftTimer = setInterval(() => {
      if (!flags.current.blocked) current.correctDrift(flags.current.scrubbing);
    }, 6000);
    const progressTimer = setInterval(() => {
      if (!flags.current.blocked && !flags.current.scrubbing) current.samplePosition();
      setPosition(player.getCurrentTime());
      setDuration(player.getDuration());
    }, 500);
    return () => { clearInterval(driftTimer); clearInterval(progressTimer); controller.current = null; };
  }, [player, send]);

  useEffect(() => {
    const current = controller.current;
    if (!current) return;
    current.setConnected(connected);
    const force = (activated && !previous.current.activated) || (connected && !previous.current.connected);
    previous.current = { activated, connected };
    if (connected) current.apply(playback, offsetMs, activated, force);
  }, [player, playback, offsetMs, activated, connected]);

  const onStateChange = useCallback((state: number) => {
    if (!flags.current.blocked) controller.current?.onStateChange(state);
  }, []);
  const activate = useCallback(() => {
    previous.current.activated = true;
    controller.current?.apply(playback, offsetMs, true, true);
  }, [playback, offsetMs]);
  return { position, duration, onStateChange, activate };
}
