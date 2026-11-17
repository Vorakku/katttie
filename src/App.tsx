import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Copy, Download, Headphones, Heart, Link, Music2, Plus, Radio, Shuffle, Upload, Users } from 'lucide-react';
import { z } from 'zod';
import { YouTubePlayer } from './components/YouTubePlayer';
import { RoomCursors } from './components/RoomCursors';
import { FloatingNotes } from './components/FloatingNotes';
import { QueueList } from './components/QueueList';
import { useRoomSocket } from './hooks/useRoomSocket';
import { buildGuestInvite, consumeInvite, saveAccess, type SavedAccess } from './lib/credentials';
import { displayNameSchema, type RoomCredentials } from './shared/protocol';
import { findYouTubeLinks } from './shared/youtube-url';

type Route = { roomId: string | null; access: SavedAccess | null; persisted: boolean; notFound?: boolean };

export function readRoute(): Route {
  const match = /^\/r\/([A-Za-z0-9_-]{16,100})\/?$/.exec(window.location.pathname);
  if (match) return { roomId: match[1], ...consumeInvite(match[1], window.location, window.history) };
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return { roomId: null, access: null, persisted: true, notFound: window.location.pathname !== '/' };
}

const roomResponse = z.object({
  roomId: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
  hostSecret: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  guestSecret: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
});

function Brand() {
  return <a className="brand" href="/" aria-label="Our Little Radio home"><span className="brand-icon"><Radio size={23} /></span>our little radio<span className="brand-star" aria-hidden="true">✧</span></a>;
}

function NameField({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  return <div className="field"><label htmlFor="display-name">What should we call you?</label>
    <input id="display-name" name="displayName" autoComplete="nickname" placeholder="Your name" value={value}
      onChange={event => onChange([...event.target.value].slice(0, 24).join(''))} required aria-describedby="name-hint" />
    <span id="name-hint" className="field-hint">A little name, up to 24 characters.</span></div>;
}

export function App({ initialRoute }: { initialRoute: Route }) {
  const [route, setRoute] = useState(initialRoute);
  const [name, setName] = useState(initialRoute.access?.displayName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [joined, setJoined] = useState(Boolean(initialRoute.access?.displayName));
  useEffect(() => {
    const onPop = () => {
      const next = readRoute();
      setRoute(next); setName(next.access?.displayName ?? ''); setJoined(Boolean(next.access?.displayName)); setError(null);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  async function enterRoom(event: FormEvent) {
    event.preventDefault();
    const parsedName = displayNameSchema.safeParse(name);
    if (!parsedName.success) { setError('Choose a name between 1 and 24 characters.'); return; }
    setError(null);
    if (route.roomId && route.access) {
      const access = { ...route.access, displayName: parsedName.data };
      setRoute({ ...route, access, persisted: saveAccess(route.roomId, access) }); setJoined(true);
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : 'We could not create a room. Please try again.';
        throw new Error(message);
      }
      const room: RoomCredentials = roomResponse.parse(body);
      const access: SavedAccess = { role: 'host', credential: room.hostSecret, guestSecret: room.guestSecret, displayName: parsedName.data };
      const persisted = saveAccess(room.roomId, access);
      window.history.pushState(null, '', `/r/${room.roomId}`);
      setRoute({ roomId: room.roomId, access, persisted }); setJoined(true);
    } catch (cause) {
      setError(cause instanceof z.ZodError ? 'The server returned an unexpected room. Please try again.' : cause instanceof Error ? cause.message : 'We could not create a room. Please try again.');
    } finally { setCreating(false); }
  }

  const inRoom = route.roomId && route.access && joined;
  return <div className="app-shell"><header className="site-header"><Brand /><span className="header-note"><Heart size={14} aria-hidden="true" /> a small space for two</span></header>
    <main id="main-content">
      {inRoom ? <Room key={`${route.roomId}:${route.access!.role}`} roomId={route.roomId!} access={route.access!} persisted={route.persisted} /> :
        route.notFound || (route.roomId && !route.access) ? <section className="welcome-card invalid-card"><span className="eyebrow">LET’S FIND YOUR WAY BACK</span><h1>This invitation needs its link.</h1><p className="muted">Ask your person for the complete invitation link. This room may also have ended if the server restarted.</p><a className="button primary-button" href="/">Create a new room <ArrowRight size={17} /></a></section> :
          <section className="landing"><div className="landing-copy"><div className="eyebrow"><span className="little-dot" /> MADE FOR YOUR SHARED MOMENTS</div>
            <h1>{route.roomId ? <>You’re invited to<br /><em>listen together.</em></> : <>Some songs are<br /><em>better together.</em></>}</h1>
            <p className="landing-description">{route.roomId ? 'Make yourself comfortable. Your favorite person saved you a seat.' : 'A little place for your favorite songs and your favorite person. Press play, wherever you both are.'}</p>
            <form className="entry-form" onSubmit={enterRoom}>
              <NameField value={name} onChange={setName} />
              {error && <p className="error" role="alert">{error}</p>}
              <button className="primary-button" type="submit" disabled={creating}>{creating ? 'Making a little space…' : route.roomId ? 'Join room' : 'Create our room'}<ArrowRight size={18} /></button>
            </form><p className="reassurance"><Users size={15} aria-hidden="true" /> Just the two of you. No accounts needed.</p></div>
            <div className="record-scene" aria-hidden="true"><span className="scene-spark spark-one">✧</span><span className="scene-spark spark-two">✦</span><div className="record-sleeve"><div className="sleeve-heading">OUR LITTLE RADIO<span>VOL. 01</span></div><div className="vinyl"><div className="vinyl-label"><Heart size={32} fill="currentColor" /><span>side by side</span></div></div><div className="sleeve-footer">different places,<br /><em>the same song.</em><Headphones size={25} /></div></div><div className="scene-caption"><span className="little-dot" /> a shared soundtrack, a little closer</div></div>
          </section>}
    </main><footer className="site-footer"><span>Made for a little togetherness.</span><span>Music plays directly from YouTube.</span></footer>
  </div>;
}

function Room({ roomId, access, persisted }: { roomId: string; access: SavedAccess; persisted: boolean }) {
  const { snapshot, connection, error, send, sendCursor, cursor, offsetMs, notepad, notepadStatus } = useRoomSocket({ roomId, credential: access.credential, displayName: access.displayName });
  const [url, setUrl] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const connected = connection === 'online';
  const terminal = connection === 'ended' || connection === 'replaced';
  const invite = access.role === 'host' && access.guestSecret ? buildGuestInvite(window.location.origin, roomId, access) : null;
  const bothOnline = snapshot?.participants.filter(person => person.online).length === 2;
  const current = snapshot?.queue.find(item => item.id === snapshot.playback.currentQueueItemId);

  async function copyInvite() {
    if (!invite) return;
    setCopyError(null);
    try { await navigator.clipboard.writeText(invite); setCopied(true); }
    catch { setCopyError('Select and copy the invitation below to share it.'); }
  }

  // One video link uses queue:add; a playlist link or several links import in one request.
  async function addSongs(text: string) {
    if (!connected || pending || !text.trim()) return false;
    const links = findYouTubeLinks(text);
    const single = links.length === 1 && 'videoId' in links[0];
    setPending(true); setMutationError(null); setImportNote(null);
    const before = snapshot?.queue.length ?? 0;
    try {
      const result = single ? await send('queue:add', { url: text.trim(), requestId: crypto.randomUUID() })
        : await send('queue:import', { text: text.slice(0, 20_000), requestId: crypto.randomUUID() });
      if (!result.ok) { setMutationError(result.message); return false; }
      if (!single && result.state) {
        const added = result.state.queue.length - before;
        setImportNote(`Added ${added} song${added === 1 ? '' : 's'}.${result.state.queue.length >= 50 ? ' The queue is full at 50.' : ''}`);
      }
      return true;
    } catch { setMutationError('The songs could not be added. Please try again when connected.'); return false; }
    finally { setPending(false); }
  }

  async function addSong(event: FormEvent) {
    event.preventDefault();
    if (await addSongs(url)) setUrl('');
  }

  async function importFile(file: File | undefined) {
    if (file) await addSongs(await file.text());
  }

  async function changeQueue(event: 'queue:remove' | 'queue:select', itemId: string) {
    if (!snapshot || !connected || pending) return;
    setPending(true); setMutationError(null);
    try {
      const result = await send(event, { itemId, expectedRevision: snapshot.revision, requestId: crypto.randomUUID() });
      if (!result.ok) setMutationError(result.message);
    } catch { setMutationError('That change did not reach the room. Please try again.'); }
    finally { setPending(false); }
  }

  async function reorderQueue(itemIds: string[], expectedRevision: number) {
    if (!connected || pending) return;
    setPending(true); setMutationError(null);
    try {
      const result = await send('queue:reorder', { itemIds, expectedRevision, requestId: crypto.randomUUID() });
      if (!result.ok) setMutationError(result.message);
    } catch { setMutationError('The new queue order could not be saved. Please try again.'); }
    finally { setPending(false); }
  }

  function shuffleQueue() {
    if (!snapshot || snapshot.queue.length < 2) return;
    const ids = snapshot.queue.map(item => item.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    void reorderQueue(ids, snapshot.revision);
  }

  function exportQueue() {
    if (!snapshot?.queue.length) return;
    const lines = snapshot.queue.map((item, index) => `${index + 1}. ${item.title ?? `YouTube · ${item.videoId}`}\nhttps://www.youtube.com/watch?v=${item.videoId}`);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`Our little radio playlist\n\n${lines.join('\n\n')}\n`], { type: 'text/plain' }));
    link.download = 'our-little-radio-playlist.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return <div className="room-page" data-cursor-anchor="room"><RoomCursors cursor={cursor} participants={snapshot?.participants ?? []} role={access.role} displayName={access.displayName} connected={connected} sendCursor={sendCursor} /><section className="room-heading" data-cursor-anchor="heading"><div><span className="eyebrow">YOUR SHARED LITTLE SPACE</span><h1>Our listening room <Heart size={24} aria-hidden="true" /></h1><p className="muted">{bothOnline ? 'You’re here together. Make it a good soundtrack.' : 'Your favorite person isn’t here yet. Set the mood.'}</p></div><div className="room-status"><span className={`status-dot ${connected ? 'is-online' : ''}`} />{connected ? 'Room connected' : connection === 'connecting' ? 'Connecting…' : connection === 'offline' ? 'Reconnecting…' : connection === 'replaced' ? 'Opened in another tab' : 'Room ended'}</div></section>
    {!persisted && <p className="notice" role="status">Browser storage is unavailable. Keep this tab open; your room access cannot be restored after a refresh.</p>}
    {error && error !== mutationError && <p className="error" role="alert">{error}</p>}
    {!connected && <div className={`notice ${terminal ? 'error' : ''}`} role="status">{connection === 'replaced' ? 'This seat was opened in another tab. Continue there, or refresh here to take the seat back.' : connection === 'ended' ? 'This room is no longer available. The server may have restarted or the room expired.' : connection === 'connecting' ? 'Finding your room…' : 'The connection slipped. Reconnecting… Your queue will return when the room is reachable.'}{terminal && <a href="/">Create a new room</a>}</div>}
    {snapshot?.prototypeMode && <p className="notice prototype-notice" role="status">Local prototype · Video status checks are disabled. Configure the server’s YouTube Data API key before sharing publicly.</p>}
    <div className="room-layout"><div className="listening-column"><section className="surface listening-surface" data-cursor-anchor="player"><div className="section-heading"><span className="eyebrow">ON THE TURNTABLE</span><span className="tiny-label">{current ? 'YOUR SHARED PICK' : 'WAITING FOR A SONG'}</span></div>
      {snapshot ? <YouTubePlayer snapshot={snapshot} send={send} offsetMs={offsetMs} connected={connected} /> : <div className="player-loading"><Radio size={42} aria-hidden="true" /><p>{terminal ? 'A new room is one little click away.' : 'Tuning into your little radio…'}</p></div>}
    </section><FloatingNotes notepad={notepad} status={notepadStatus} readOnly={terminal} author={access.displayName} /></div>
      <aside className="room-sidebar"><section className="surface people-surface" data-cursor-anchor="people"><div className="section-heading"><h2>Just us</h2><Heart size={17} className="pink-text" aria-hidden="true" /></div><div className="people-list">{(['host', 'guest'] as const).map(role => {
        const person = snapshot?.participants.find(candidate => candidate.role === role);
        const isYou = role === access.role;
        const displayName = person?.displayName || (isYou ? access.displayName : 'Your person');
        const online = connected && Boolean(person?.online);
        return <div className="person" key={role}><span className={`avatar avatar-${role}`} aria-hidden="true">{[...displayName][0]?.toLocaleUpperCase()}</span><div><strong>{displayName} {isYou && <span className="you-label">you</span>}</strong><span className="person-status"><span className={`status-dot ${online ? 'is-online' : ''}`} />{online ? 'Here with you' : 'Not here yet'}</span></div></div>;
      })}</div>{invite && <div className="invite-area"><button className="secondary-button full-width" onClick={copyInvite} type="button">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Invitation copied' : 'Copy guest invitation'}</button><label className="sr-only" htmlFor="guest-invite">Guest invitation link</label><input id="guest-invite" className="invite-input" value={invite} readOnly onFocus={event => event.target.select()} />{copyError && <p className="field-hint" role="status">{copyError}</p>}<p className="invite-hint"><Link size={12} /> Private link · share with your person only</p></div>}</section>
      <section className="surface queue-surface" data-cursor-anchor="queue"><div className="section-heading"><h2>Our queue</h2><span className="count-pill">{snapshot?.queue.length ?? 0} / 50</span></div><p className="queue-description muted">A song from you, a song from me.</p><form className="add-song-form" onSubmit={addSong}><label className="sr-only" htmlFor="song-url">YouTube song or playlist links</label><input id="song-url" type="text" inputMode="url" autoComplete="off" placeholder="Paste a song, playlist, or several links" value={url} onChange={event => setUrl(event.target.value)} maxLength={20000} required disabled={!connected || pending} /><button className="primary-button full-width" type="submit" disabled={!connected || pending || !url.trim()}><Plus size={17} />{pending ? 'Saving…' : 'Add a song'}</button></form><div className="queue-actions">
          <button className="secondary-button" type="button" onClick={shuffleQueue} disabled={!connected || pending || (snapshot?.queue.length ?? 0) < 2}><Shuffle size={15} aria-hidden="true" /> Shuffle</button>
          <button className="secondary-button" type="button" onClick={exportQueue} disabled={!snapshot?.queue.length}><Download size={15} aria-hidden="true" /> Export</button>
          <label className={`secondary-button${!connected || pending ? ' is-disabled' : ''}`}><Upload size={15} aria-hidden="true" /> Import
            <input className="sr-only" type="file" accept=".txt,text/plain" disabled={!connected || pending}
              onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
        </div>{importNote && <p className="field-hint" role="status">{importNote}</p>}{mutationError && <p className="error" role="alert">{mutationError}</p>}
        {!snapshot?.queue.length ? <div className="queue-empty"><Music2 size={27} aria-hidden="true" /><strong>The room is quiet.</strong><p>Add a song to begin your shared soundtrack.</p></div> : <QueueList snapshot={snapshot} disabled={!connected || pending}
          onSelect={id => changeQueue('queue:select', id)} onRemove={id => changeQueue('queue:remove', id)} onReorder={reorderQueue} />}
      </section></aside></div><p className="room-footnote">Keep this tab open to stay together. Playback on a locked phone or in the background depends on your browser.</p>
  </div>;
}
