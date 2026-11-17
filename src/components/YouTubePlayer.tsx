import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Play, Pause, SkipForward, Volume2, RefreshCw, Headphones } from 'lucide-react';
import { useYouTubePlayer } from '../hooks/useYouTubePlayer';
import { usePlaybackSync } from '../hooks/usePlaybackSync';
import type { RoomSnapshot, SendCommand } from '../shared/protocol';

function timestamp(seconds: number) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function YouTubePlayer({ snapshot, send, offsetMs, connected }: {
  snapshot: RoomSnapshot; send: SendCommand; offsetMs: number; connected: boolean;
}) {
  const [activated, setActivated] = useState(false);
  const [volume, setVolume] = useState(70);
  const [draftPosition, setDraftPosition] = useState<number | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const youtube = useYouTubePlayer(state => {
    sync.onStateChange(state);
    if (state === 1) setActivated(true);
  });
  const sync = usePlaybackSync({
    player: youtube.player, playback: snapshot.playback, send, offsetMs, activated, connected,
    scrubbing: draftPosition !== null, blocked: youtube.blocked || !!youtube.error, onError: setCommandError,
  });
  const selected = snapshot.queue.find(item => item.id === snapshot.playback.currentQueueItemId);
  const hasVideo = !!snapshot.playback.videoId;
  const controlsDisabled = !connected || !hasVideo || pending;
  const gateVisible = !activated || youtube.blocked;
  const videoData = hasVideo ? youtube.player?.getVideoData() : undefined;
  const title = selected?.title || videoData?.title || (hasVideo ? `YouTube · ${snapshot.playback.videoId}` : 'Your next favorite memory');
  // hqdefault is 4:3 with letterbox bars; .cover zooms them out of frame.
  const cover = hasVideo ? { backgroundImage: `url(https://i.ytimg.com/vi/${encodeURIComponent(snapshot.playback.videoId!)}/hqdefault.jpg)` } : undefined;
  const playing = snapshot.playback.status === 'playing';
  const led = `${hasVideo ? 'NOW PLAYING' : 'OUR LITTLE RADIO'}  >  ${title.toUpperCase()}  ✦  `;
  const shownPosition = draftPosition ?? sync.position;

  useEffect(() => { youtube.player?.setVolume(volume); }, [youtube.player, volume]);
  useEffect(() => { setDraftPosition(null); setCommandError(null); }, [snapshot.playback.videoId]);

  async function control(action: 'PLAY' | 'PAUSE' | 'SEEK' | 'NEXT', positionSec?: number) {
    if (controlsDisabled) return;
    setPending(true);
    setCommandError(null);
    try {
      const result = await send('playback:control', {
        action, ...(positionSec === undefined ? {} : { positionSec }),
        expectedPlaybackRevision: snapshot.playback.revision, requestId: crypto.randomUUID(),
      });
      if (!result.ok) setCommandError(result.message);
    } catch { setCommandError('The playback change could not be sent. Please try again.'); }
    finally { setPending(false); }
  }

  function enableListening() {
    if (!youtube.player || !hasVideo) return;
    youtube.clearBlocked();
    setActivated(true);
    // Keep the playback call inside the gesture for browser sound permission.
    sync.activate();
  }

  // Start listening on its own. Browsers only allow sound after a user gesture, so if
  // they block it, the first tap or key press anywhere on the page turns it on.
  const enableRef = useRef(enableListening);
  enableRef.current = enableListening;
  useEffect(() => {
    if (!youtube.player || !hasVideo || youtube.error || (activated && !youtube.blocked)) return;
    if (!activated) enableRef.current();
    const onGesture = () => enableRef.current();
    const options = { capture: true, once: true };
    document.addEventListener('pointerdown', onGesture, options);
    document.addEventListener('keydown', onGesture, options);
    return () => {
      document.removeEventListener('pointerdown', onGesture, options);
      document.removeEventListener('keydown', onGesture, options);
    };
  }, [youtube.player, hasVideo, youtube.error, activated, youtube.blocked]);

  function commitSeek() {
    if (draftPosition === null) return;
    void control('SEEK', draftPosition);
    setDraftPosition(null);
  }

  const localStatus = youtube.error ? youtube.error
    : youtube.blocked ? 'Playback blocked. Tap to start listening on this device.'
    : !youtube.player ? 'Loading the YouTube player…'
    : !hasVideo ? 'Add a song to start your little radio.'
    : !activated ? 'Enable listening on this device when you’re ready.'
    : youtube.localState === 3 ? 'Waiting for YouTube to finish buffering…'
    : snapshot.playback.status === 'playing' && youtube.localState !== 1 ? 'Syncing this device with your room…'
    : snapshot.playback.status === 'playing' ? 'Listening together'
    : 'Paused together';

  return (
    <section className="player-card" aria-label="Shared YouTube player">
      <div className="led-board" aria-hidden="true"><div className="led-track" style={{ animationDuration: `${Math.max(10, led.length * 0.28)}s` }}><span>{led}</span><span>{led}</span></div></div>
      <div className="deck">
        <div className="cd-stage" aria-hidden="true">
          <div className={`cd${playing ? ' is-spinning' : ''}`}>
            <div className="cd-disc cover" style={cover} /><div className="cd-shine" /><div className="cd-hole" />
          </div>
        </div>
        <div className="deck-panel">
          <div className="deck-track">
            <div className="deck-thumb cover" style={cover} />
            <div><h2>{title}</h2><p>{videoData?.author || 'On our little radio'}</p></div>
          </div>
          <input className="deck-seek" aria-label="Playback position" type="range" min="0" max={Math.max(1, sync.duration)} step="0.1"
            value={Math.min(shownPosition, Math.max(1, sync.duration))}
            style={{ '--progress': `${sync.duration ? Math.min(100, shownPosition / sync.duration * 100) : 0}%` } as CSSProperties}
            disabled={controlsDisabled || !youtube.player || !sync.duration}
            onChange={event => setDraftPosition(Number(event.target.value))}
            onPointerUp={commitSeek} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commitSeek(); }}
            onBlur={commitSeek} onPointerCancel={() => setDraftPosition(null)} />
          <p className="deck-time"><strong>{timestamp(shownPosition)}</strong><span>{timestamp(sync.duration)}</span></p>
        </div>
      </div>
      <div className="player-details">
        <p className={youtube.error ? 'error' : 'muted'} role={youtube.error ? 'alert' : 'status'}>{localStatus}</p>
        {gateVisible && hasVideo && !youtube.error && (
          <div className="listening-gate">
            <button className="primary-button" onClick={enableListening} disabled={!youtube.player}>
              <Headphones size={18} aria-hidden="true" /> {youtube.blocked ? 'Tap to start listening' : 'Enable listening'}
            </button>
            <span className="muted">Sound permission is just for this device.</span>
          </div>
        )}
        {youtube.error && <button className="secondary-button" onClick={youtube.retry}><RefreshCw size={16} aria-hidden="true" /> Retry player</button>}
        <div className="player-controls">
          <button className="primary-button" disabled={controlsDisabled} aria-label={snapshot.playback.status === 'playing' ? 'Pause for both' : 'Play for both'}
            onClick={() => { void control(snapshot.playback.status === 'playing' ? 'PAUSE' : 'PLAY'); }}>
            {snapshot.playback.status === 'playing' ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
            {snapshot.playback.status === 'playing' ? 'Pause' : 'Play'}
          </button>
          <button className="secondary-button" disabled={controlsDisabled} onClick={() => { void control('NEXT'); }}><SkipForward size={18} aria-hidden="true" /> Next</button>
          <label className="volume-control"><Volume2 size={18} aria-hidden="true" /><span className="sr-only">Volume on this device</span>
            <input aria-label="Volume on this device" type="range" min="0" max="100" value={volume} onChange={event => setVolume(Number(event.target.value))} />
          </label>
        </div>
        {commandError && <p className="error" role="alert">{commandError}</p>}
      </div>
      {/* Hidden by owner's choice; this breaks YouTube's visible-player rule. opacity keeps it unthrottled. */}
      <div className="player-viewport" ref={youtube.containerRef} aria-hidden="true" inert />
    </section>
  );
}
