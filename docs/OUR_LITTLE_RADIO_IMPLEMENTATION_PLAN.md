# OUR LITTLE RADIO — Agent Implementation Plan

**Working title:** Our Little Radio  
**Status:** Ready for implementation  
**Date:** 2026-11-17  
**Product type:** Private, two-person, synchronized YouTube listening room  
**Deployment:** One Windows PC + a free ngrok HTTPS tunnel  
**Budget target:** $0 for the MVP

> **Instructions to coding agents:** This is an implementation specification, not a request for mockups or an architectural essay. Build a working, tested application incrementally. Prioritize functional two-device synchronization over visual extras. Make pragmatic decisions where details are unspecified, document them in `README.md`, and do not add accounts, databases, Docker, cloud hosting, music downloading, audio extraction, or features explicitly deferred below. Use only the official YouTube IFrame API plus a small server-side YouTube Data API lookup required by the current Made-for-Kids policy for public sharing. Avoid speculative complexity. Deliver runnable code, tests, and Windows setup instructions.

---

## 1. Product vision

Build an intimate, cozy website where two people in different locations can listen to the same YouTube video/song at nearly the same time. One person starts a room on their PC-hosted website and sends a private invitation link to their partner. Both open the same room, see each other's presence, add YouTube links to a shared queue, and control playback together. The app should feel like a small shared space, not a generic streaming dashboard.

**Product promise:** "A little place where our favorite songs play together."

### Primary user journey

1. Host opens the website on their PC (or any browser), taps **Create our room**, and receives a private guest invitation link.
2. Host sends the link to their partner via chat.
3. Guest opens the link on phone or desktop, chooses a display name, and taps **Join room**.
4. Each person taps **Enable listening / Start listening** if the browser requires user interaction before playing audio.
5. Either user pastes a supported YouTube URL into **Add a song**.
6. The song enters the shared queue; if no song is loaded, the first queued song becomes the selected song, initially paused.
7. Either user presses **Play**. Both players attempt playback from the same timestamp, with a fallback manual resume action on a device that blocks autoplay.
8. Play, pause, seek, next song, queue updates, and online presence are synchronized in real time.
9. If one person refreshes or temporarily loses connection, they rejoin the same room and recover its latest state.
10. The room remains accessible only while the host PC, server, and ngrok tunnel are running.

### Product qualities

- Cozy, private-feeling, warm, thoughtful, calm, mobile-first.
- Fast start: no sign-up, payment, or third-party user login. The IFrame player itself needs no API key, but public deployment needs a separate free-quota video-status check (see policy requirement below).
- Honest connection and sync feedback: never pretend playback succeeded when the browser blocked it.
- Two-person design; do not optimize for large public rooms.

---

## 2. Scope and non-goals

### MVP — must ship

- [ ] Create a private two-person room and generate a **guest invitation link**.
- [ ] Separate **host** and **guest** capabilities using distinct secret credentials, without traditional accounts.
- [ ] Join an existing room by link and choose a short display name.
- [ ] Show both participants' online/offline presence.
- [ ] Accept individual YouTube video links; parse and validate video IDs.
- [ ] Check each video's Made-for-Kids status with YouTube Data API before public playback, following current YouTube developer policies (free quota; owner-supplied API key).
- [ ] Render an actual visible, accessible YouTube embedded player.
- [ ] Play/pause/seek/next synchronized in both browsers.
- [ ] Shared queue with add/remove/select song, with deterministic order.
- [ ] Joining, refresh, and reconnection restore room state.
- [ ] Handle autoplay block, unsupported embed, unavailable/deleted video, buffering, and disconnect states gracefully.
- [ ] Responsive desktop and mobile layout; accessible controls.
- [ ] One-command development startup and one-port production server.
- [ ] Windows + ngrok setup documentation.
- [ ] Automated unit/integration tests and a two-device manual test checklist.

### After the MVP — optional polish

- [ ] Floating heart reactions (ephemeral; no database).
- [ ] Short personal note attached to a queued song, typed by the person adding it.
- [ ] Gentle motion effects, shared mood/status, themes, optional personalization.
- [ ] Local JSON-file persistence for room queue and notes across server restart (only after reliable sync).
- [ ] Optional "host-only skip/remove" room setting, if desired.

### Explicitly out of scope

- No Spotify integration, music search engine, YouTube audio ripping, `yt-dlp`, playback proxy, downloadable MP3s, or DRM bypass.
- No audio-only or hidden YouTube player; no claim of reliable playback with phone screen locked or app in background.
- No real-time voice call/chat service, payments, notifications, accounts, recommendation engine, user-generated audio, or playlist import in the MVP.
- No video/audio redistribution through Express or ngrok. Each browser requests media directly from YouTube.
- No promise of sample-accurate synchronization; target *reasonably close* audible playback on normal connections.

---

## 3. Constraints that must shape the implementation

### YouTube policy and browser behavior

1. Use the **official YouTube IFrame Player API**, not a media URL extractor. `https://www.youtube.com/iframe_api` is the client SDK.
2. The embedded video must be actually displayed, not made invisible, reduced below allowed dimensions, obscured by decorations, or placed off-screen as a disguised audio player. Official minimum embedded player viewport is **200 × 200 px**, and 16:9 players **480 × 270 px or larger** are recommended. On narrow phones, choose a compliant layout with a suitable viewport and accessible controls; avoid shrinking below the minimum.
3. Do not cover or remove YouTube attribution, advertising, or standard player functionality. Custom external controls are okay as companion controls, not replacements that block YouTube's interface.
4. Browser autoplay restrictions apply. Use a deliberate user gesture on **each device**, show **Tap to start listening** when necessary, and handle YouTube's `onAutoplayBlocked` event. `allow="autoplay; fullscreen"` on the embedded iframe helps permission delegation but does *not* guarantee autoplay.
5. Some videos disallow embedding, are deleted/private, age- or region-restricted, or behave differently during ads. Do not bypass restrictions. Provide a **Try another YouTube link** error state. YouTube player errors `100`, `101`, `150`, and `153` need explicit handling.
6. Preserve browser referrer identity for YouTube embeds. Use an appropriate production-origin setting for the player; do not force `referrerpolicy="no-referrer"` on the iframe, which may contribute to player error `153`. Avoid placing invite secrets into third-party referrers.
7. The IFrame player itself does not require an API key. However, current YouTube developer policies **require API clients to check each embedded video's Made-for-Kids status**, using `videos.list` with `part=id,status`. For a publicly exposed app, implement this lookup server-side with a `YOUTUBE_DATA_API_KEY` from a free-quota Google Cloud project before loading arbitrary video IDs; disable app-owned tracking for Made-for-Kids content. This key is not needed for *basic SDK playback*, but it is needed for the policy-required compliance check. No HTML scraping or alternate stream extraction.
8. If the owner has not configured the key, development can proceed with a visibly labeled local-only prototype mode, but the app **must not be described as fully ready for public deployment** until this policy requirement is addressed. Never expose the Google API key in browser code.

### Free ngrok realities

- Public access is through one `https://...ngrok-free.app` development-domain URL and one HTTP tunnel to the application port.
- At the time of planning, ngrok Free advertises **1 GB monthly outbound traffic**, **20,000 monthly HTTP(S) requests**, and a **browser interstitial** on free endpoints. These terms can change; do not hard-code assumptions about quota. Check the official dashboard/docs.
- The hosted site and Socket.IO events pass through ngrok, but YouTube video bytes go directly between each user's browser and YouTube; the PC is **not** a video relay.
- The Windows PC must remain powered, connected to the internet, and running both the Node server and ngrok.
- Use one domain/origin in production; avoid a separate public tunnel for Socket.IO.

---

## 4. Chosen stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript, strict mode | Shared types, predictable event contracts |
| Client | React + Vite | Lightweight, fast development |
| Styling | Tailwind CSS + CSS variables | Responsive and easy visual iteration |
| Icons | lucide-react | Clean, consistent visual language |
| State | React context/hooks or small Zustand store | Only room/player state; avoid unnecessary complexity |
| Server | Node.js LTS + Express | Serves production SPA and lightweight REST |
| Realtime | Socket.IO client/server | Rooms, acknowledgements, reconnection |
| Validation | Zod | Validate all untrusted client payloads |
| Video | Official YouTube IFrame Player API | Allowed embedded playback and controls |
| Tests | Vitest + Socket.IO integration tests + Playwright | Verify protocol and browser flow |
| Hosting | Local machine + ngrok | Free personal development deployment |
| Database | In-memory `Map` for MVP | Zero setup, one room / two people |
| Video status check | YouTube Data API `videos.list` (free quota) | Required Made-for-Kids compliance check for public sharing |

**Dependency policy:** Install currently supported stable releases, commit the lockfile, and avoid using unstable/canary dependencies. Use npm scripts on Windows PowerShell.

---

## 5. Architecture

```text
              HTTPS public invite URL
                       |
                     ngrok
                       |
                 localhost:3000
                       |
       +---------------+----------------+
       |       Express / Node.js        |
       |   GET /api/health              |
       |   POST /api/rooms              |
       |   Static compiled React SPA    |
       |   Socket.IO /socket.io         |
       |   Room manager (in memory)     |
       +---------------+----------------+
                       |
             event/state messages only
             /                       \
      Host browser                 Guest browser
      React + Socket.IO            React + Socket.IO
      Visible YouTube iframe       Visible YouTube iframe
             |                           |
      Direct YouTube streaming     Direct YouTube streaming
```

**Single origin:** In production, Express serves the Vite build and Socket.IO on the same port (`PORT=3000`). Client creates a same-origin socket with `io()`; no hardcoded `localhost` URL in production.

**Local development:** Run Vite (e.g. port 5173) and Express/Socket.IO (port 3000) with one `npm run dev`. Configure the Vite dev server proxy for `/api` and `/socket.io` (including `ws: true`). The browser still uses same-origin relative URLs.

**Server authority:** The server owns the current queue, selected song, playback status, anchor position, anchor time, revision counter, and participant presence. Clients send **intents**; they do not authoritatively replace room state. All accepted changes result in a canonical full room snapshot broadcast to both clients.

**Local autonomy:** Each browser owns local volume, whether sound has been unlocked by a gesture, buffering indicators, IFrame readiness, and player errors. These should never pause everyone else solely because one browser is buffering.

---

## 6. Proposed repository structure

```text
our-little-radio/
├─ package.json
├─ package-lock.json
├─ index.html
├─ vite.config.ts
├─ tsconfig.json
├─ tsconfig.node.json
├─ postcss.config.js              # only if required by selected Tailwind setup
├─ .env.example
├─ .gitignore
├─ README.md
├─ docs/
│  ├─ IMPLEMENTATION_PLAN.md       # this document (copy here)
│  └─ MANUAL_QA.md
├─ public/
│  └─ favicon.svg
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ styles/
│  │  └─ globals.css
│  ├─ shared/
│  │  ├─ protocol.ts                # shared client/server schemas and types
│  │  ├─ youtube-url.ts             # video URL normalization + tests
│  │  └─ playback-math.ts           # clock/position math + tests
│  ├─ components/
│  │  ├─ RoomLanding.tsx
│  │  ├─ JoinRoom.tsx
│  │  ├─ RoomPage.tsx
│  │  ├─ YouTubePlayer.tsx
│  │  ├─ PlayerControls.tsx
│  │  ├─ SharedQueue.tsx
│  │  ├─ PresenceIndicator.tsx
│  │  ├─ AddSongForm.tsx
│  │  ├─ ConnectionBanner.tsx
│  │  └─ ListeningGate.tsx
│  ├─ hooks/
│  │  ├─ useRoomSocket.ts
│  │  ├─ useYouTubePlayer.ts
│  │  └─ usePlaybackSync.ts
│  └─ lib/
│     ├─ socket.ts
│     ├─ credentials.ts
│     └─ youtube-api-loader.ts
├─ server/
│  ├─ index.ts
│  ├─ app.ts
│  ├─ room-manager.ts
│  ├─ socket-handlers.ts
│  ├─ room-auth.ts
│  ├─ validation.ts
│  └─ youtube-video-status.ts      # videos.list policy/status lookup, server-only
├─ tests/
│  ├─ room-manager.test.ts
│  ├─ socket-protocol.test.ts
│  └─ sync.test.ts
└─ e2e/
   ├─ room-flow.spec.ts
   └─ reconnect.spec.ts
```

Agents may revise file decomposition when necessary; keep the same responsibilities and avoid creating an excessively layered architecture for two users.

---

## 7. Room model, access, and privacy

### Room creation

`POST /api/rooms` returns:

```json
{
  "roomId": "opaque-unguessable-id",
  "hostSecret": "high-entropy-secret",
  "guestSecret": "different-high-entropy-secret"
}
```

- Generate both credentials with Node `crypto.randomBytes` (at least 24 random bytes each), encoded as URL-safe strings. Do not use human-readable 4-digit codes as the only protection.
- Create at most one **host role** and one **guest role** per room, with no sign-up or password.
- Build a guest invite URL like `https://YOUR_DOMAIN/r/ROOM_ID#key=GUEST_SECRET`.
- Host credential stays local; never put `hostSecret` into the copied guest invitation.
- URL fragments are not transmitted as HTTP URL paths/queries. The SPA reads `location.hash` on first launch, stores the credential locally by room ID, and removes the fragment from the visible URL using `history.replaceState`. The guest invite shown in the UI must still include the secret; use it from the app's local private room state.
- When Socket.IO connects, it sends room ID + credential in a validated `room:join` message over HTTPS/WSS.
- Store only credentials necessary for rejoining in local storage (or session storage with a clear UX choice). Never log secrets, analytics events containing secrets, or full invite URLs.
- Use `Referrer-Policy: strict-origin-when-cross-origin` for the app (not a blanket `no-referrer` policy applied to the YouTube iframe); keep invites in URL fragments for privacy.
- Treat invitation links as bearer secrets: anyone who receives the guest link may join. Document that the link is for trusted sharing only.

### Participants

```ts
type Role = 'host' | 'guest';
type Participant = {
  role: Role;
  displayName: string;
  online: boolean;
};
```

- Display-name length 1–24 Unicode characters, trimmed and escaped through React rendering.
- Maximum two live participants: one host session and one guest session.
- If the same role reconnects from a new tab, decide on a deterministic policy: **newest validated connection replaces the old connection for that role**. Disconnect the old socket with a friendly explanation, avoiding accidental 3-person rooms.
- On disconnect mark presence offline; do not destroy queue or pause music for the other person.
- Expire empty rooms after 12 hours of inactivity, or on server restart (in-memory only); clean up timers to prevent leaks.
- Host may optionally close the room, requiring confirmation. This is an enhancement, not a blocker.

### Safety / abuse prevention

- Validate all REST and socket payloads with Zod.
- Rate-limit room creation, join attempts, queue submissions, and control commands. Use sensible small limits for a two-person app; prevent unbounded room creation or huge payloads.
- Reject invalid URLs, unexpected video ID lengths, arbitrary protocols, oversized strings, unknown events, and malformed data.
- Do not let the client choose a different room's ID or role without a valid secret.
- Cap the queue at 50 videos and cap note/message length if notes are added later.
- Use `helmet` with a content-security policy adapted carefully for YouTube (`youtube.com`, `youtube-nocookie.com` if used, `youtube.com/iframe_api`, `i.ytimg.com`, necessary YouTube/Google player resources) and Socket.IO. Verify playback rather than enabling CSP settings blindly. Do not block required player functionality.
- Disable verbose error details in production. Provide a basic `/api/health` that does not leak secrets.

---

## 8. Shared state and protocol

### Types

```ts
type QueueItem = {
  id: string;                     // UUID generated by server
  videoId: string;                // validated 11-character YouTube ID
  title: string | null;           // optional, may be unavailable without Data API
  addedBy: Role;
  addedAtMs: number;
};

type PlaybackState = {
  currentQueueItemId: string | null;
  videoId: string | null;
  status: 'playing' | 'paused';
  anchorPositionSec: number;
  anchorServerTimeMs: number;     // Date.now() on server at last accepted action
  revision: number;              // increment on each accepted playback change
};

type RoomSnapshot = {
  roomId: string;
  revision: number;              // increment on ANY room state change
  queue: QueueItem[];
  playback: PlaybackState;
  participants: Participant[];
  serverNowMs: number;
};
```

**Meaning of the playback anchor:** At `anchorServerTimeMs`, canonical playback was at `anchorPositionSec`. When status is `playing`, the expected position at server time `t` is `anchorPositionSec + (t - anchorServerTimeMs) / 1000`. When paused, it is always `anchorPositionSec`. Clamp to `>= 0` and known duration where available.

### Socket protocol (event names are a contract)

**Client → server** (all mutations use acknowledgement with `{ok: true}` or `{ok: false, code, message}`):

| Event | Payload | Server behavior |
|---|---|---|
| `room:join` | `{roomId, credential, displayName}` | Authenticate, assign role, join socket room, return full snapshot |
| `room:leave` | `{}` | Mark offline and leave socket room |
| `queue:add` | `{url}` | Parse video ID server-side, append one item, select if first |
| `queue:remove` | `{itemId}` | Remove item; if current removed, select next valid item and pause |
| `queue:select` | `{itemId}` | Select item; set position 0 and paused |
| `playback:control` | `{action, positionSec?, expectedPlaybackRevision?, requestId}` | Apply PLAY, PAUSE, SEEK, or NEXT through state manager |
| `playback:ended` | `{videoId, playbackRevision}` | Advance only if video and revision still match, at most once |
| `sync:ping` | `{clientSentAtMs}` | Acknowledge with authoritative `serverNowMs` |

**Server → client**:

| Event | Payload | Meaning |
|---|---|---|
| `room:state` | `RoomSnapshot` | Canonical full state after any mutation / reconnect |
| `room:error` | `{code, message}` | Permission, validation or availability error |
| `room:replaced` | `{message}` | Another tab or device took the same role |

For just two participants, **broadcasting the entire authoritative snapshot after each accepted change** is simpler and safer than maintaining independent partial state patches. Make sure the initiating socket also receives the same canonical state.

### Protocol invariants

1. Never send raw YouTube audio/video data through Socket.IO.
2. All room actions are scoped by the authenticated socket identity, not client-supplied role strings.
3. All accepted state changes increment a monotonically increasing `room.revision`.
4. All accepted playback changes increment `playback.revision`.
5. Clients ignore snapshots older than their latest applied room revision.
6. Mutating actions use `requestId` for idempotency where needed; cache recent IDs per role/room to prevent a retry from applying NEXT or queue-add twice.
7. Accept commands in server receipt order. Reject stale expected revisions for destructive changes, or return a fresh snapshot so clients can reconcile.
8. `playback:ended` is idempotent across both browsers. Only one advance per current video/revision.
9. Queue removal and selection cannot leave a dangling `currentQueueItemId`.
10. If the queue is empty, playback is paused with no video selected.

---

## 9. Synchronization algorithm — core requirement

Do **not** implement sync as "send a Play event and hope both browsers start at the same millisecond." Network latency, buffering, refreshes, and autoplay restrictions make that unreliable.

### 9.1 Clock calibration

On joining or reconnecting, request 3 `sync:ping` samples:

```ts
// Client-side approximation:
const t0 = Date.now();
const { serverNowMs } = await emitWithAck('sync:ping', { clientSentAtMs: t0 });
const t2 = Date.now();
const roundTripMs = t2 - t0;
const estimatedClientMidpointMs = (t0 + t2) / 2;
const offsetMs = serverNowMs - estimatedClientMidpointMs;
```

Keep the offset from the sample with the lowest round-trip time (or median of the best samples). Estimated current server time = `Date.now() + offsetMs`. Recalibrate every ~30 seconds and after reconnection. This is an approximation, not NTP-grade clock sync.

### 9.2 Compute target position

```ts
function expectedPositionSec(
  p: PlaybackState,
  estimatedServerNowMs: number,
  durationSec?: number
): number {
  const elapsed = p.status === 'playing'
    ? Math.max(0, (estimatedServerNowMs - p.anchorServerTimeMs) / 1000)
    : 0;
  const value = Math.max(0, p.anchorPositionSec + elapsed);
  return typeof durationSec === 'number'
    ? Math.min(value, durationSec)
    : value;
}
```

- On new song: load YouTube video by ID, seek to expected canonical position when the player is ready, and start only if playing is requested **and** browser policy permits.
- On PLAY: compute/preserve the current canonical position, set status playing, anchor to server receipt time, broadcast.
- On PAUSE: freeze at the canonical position as of receipt time, broadcast; do not restart from zero.
- On SEEK: use the requested bounded position, anchor to server receipt time, retain current play/pause status, broadcast.
- On NEXT: select next item, reset position to 0. Attempt to play next if previously playing and user/player permissions allow it. If unsupported or blocked, surface the correct state and let users take an explicit action.
- On room join while already playing: show the current song, calculate live expected position, and try to play **only after local user activation is permitted**. One person's local **Enable listening** must not reset or pause the shared room.

### 9.3 Drift correction

While the YouTube player is ready and the canonical status is `playing`, compare `player.getCurrentTime()` with the expected position roughly every 6 seconds. If absolute drift exceeds **1.5 seconds**, seek to the corrected position with a cooldown of about **12 seconds** to avoid irritating seek loops. Tune constants during live testing.

- Do not seek continuously for tiny differences (< 1.5 seconds).
- Do not correct while changing songs, before video readiness, while buffering, during known player errors, or when the user is actively dragging a timeline.
- Do not blindly fight YouTube advertisements or restricted playback. The IFrame API cannot guarantee that both viewers get the same ads or identical buffering behavior.
- Distinguish `canonical state = playing` from `local player actually playing`; show a local syncing/blocked/buffering badge when they differ.
- Target *usually within ~1–2 seconds on healthy connections*, not exact synchronization. Record actual live-test results.

### 9.4 Prevent feedback loops

The YouTube player fires `onStateChange` for programmatic calls **and** user interactions within the native player. Implement a `PlayerCommandController` or equivalent with:

- `isApplyingRemoteState` / recent-command correlation tracking;
- a short suppression window around programmatic `playVideo`, `pauseVideo`, `seekTo`, `loadVideoById` operations;
- deduplication of repeated player events;
- `onStateChange` handling that recognizes deliberate native-player actions when clearly distinguishable;
- primary custom UI buttons that send one explicit user intent to the server.

Never broadcast a new PLAY just because the local player handled an incoming PLAY. Never broadcast a room-wide PAUSE merely because one user's player entered BUFFERING or autoplay failed.

### 9.5 Song ended

Both players may fire `ENDED` at different times. Send `playback:ended` with the current video ID and playback revision. Server confirms the current song/revision and advances **once**. To avoid advancing too early when players drift, the server can require the expected canonical position to be near known duration (if available) or apply an acceptable end grace. If duration isn't reliable, ensure only one event can advance the room; do not let stale end events skip multiple songs.

### 9.6 Reconnect and temporary failures

- Socket.IO reconnects automatically, but client must **re-authenticate/rejoin** and request a full snapshot (do not trust the local queue after disconnect).
- Use event acknowledgements, bounded retries, and idempotent request IDs for mutations. Do not replay stale control events buffered during offline periods; disable transport buffering for playback controls or discard unsent commands when disconnected.
- Show a banner **Connection lost — trying to reconnect…**. Allow a locally loaded song to continue without broadcasting accidental changes; on reconnection, reconcile to server state.
- Handle server restarts: in-memory rooms disappear; show **The room ended because the host's server restarted. Create a new room.** Do not silently invent a new room with the old invite.

---

## 10. YouTube URL support, player integration, and metadata

### Accepted video URL shapes

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://m.youtube.com/watch?v=VIDEO_ID`
- `https://music.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- URLs with harmless extra parameters (e.g. `&t=12`) are allowed; ignore those parameters for MVP.

**Not required:** playlist URLs (`list=`), YouTube channels, arbitrary websites, raw MP3 URLs, direct stream links, or free-text searches.

Implement `extractYouTubeVideoId(raw: string): string | null` with the built-in `URL` parser, a strict allowed-host list, and an 11-character YouTube ID validation (`[A-Za-z0-9_-]{11}`). Never fetch or proxy the arbitrary input URL from the backend; only parse its string.

### Player wrapper

Build `useYouTubePlayer` / `YouTubePlayer.tsx` that:

- Loads the IFrame API once (singleton promise), cleans up player on unmount, survives React Strict Mode safely.
- Creates the player only after target DOM node exists.
- Supports `loadVideo(videoId, startSeconds)`, `play`, `pause`, `seek`, `getCurrentTime`, `getDuration`, `getPlayerState`, `getVideoData`, and `onReady/onStateChange/onError/onAutoplayBlocked`.
- Uses correct production `origin` and the SDK's supported configuration.
- Preserves a visible video viewport and native YouTube UI; styles the surrounding container rather than hiding video.
- Avoids remounting the YouTube iframe on every room state update.
- Exposes a clear `ready` state and handles player initialization/timeouts without throwing.

### Video status / Made-for-Kids policy gate

The IFrame SDK itself needs no key, but **YouTube's current developer policies require the app to look up the Made-for-Kids status of each embedded video**. Implement a small server-side `YouTubeVideoStatusService`:

- Use the owner-provided `YOUTUBE_DATA_API_KEY` stored only in the server environment.
- Before committing `queue:add` for a new video, request the official `videos.list` endpoint with `part=id,status&id=VIDEO_ID`, and optionally `snippet` for reliable metadata if desired. Parse `status.madeForKids` and `status.embeddable` if returned.
- Never fetch arbitrary user-provided URLs; requests go only to Google's known API origin with a validated video ID. Cache the result briefly (e.g., up to one day) while respecting API policies and the possibility of changing statuses.
- The app itself should use **no third-party analytics or tracking**. For Made-for-Kids videos, do not introduce tracking of video consumption, and follow YouTube's guidelines and applicable laws. No bypass of YouTube's own embed restrictions.
- Handle key missing, quota exhausted, API errors, or a missing/invalid video with a clear failure/retry state. For public access, do not silently skip this compliance check. For local prototyping without the key, label the app a development-only prototype in README/config.
- The standard daily API quota shown in the official guidance is 10,000 points; status checks for a two-person room fit within that normal free quota. Users may need to create a free Google Cloud project/enable the YouTube Data API and supply their own key.

### Metadata tradeoff

When the status lookup includes `snippet`, it can supply an official video title/thumbnail metadata, but the queue must function when metadata is missing. `getVideoData()` may also expose the loaded video's title/author. Do not depend on titles for synchronization or queue correctness. Do not write a YouTube HTML scraper. Keep a link to the original YouTube video when useful and preserve attribution.

### Errors

- `100`: video unavailable/deleted/private.
- `101` / `150`: owner disallows embedding.
- `153`: embed request missing appropriate client identification/referrer.
- `onAutoplayBlocked`: present a prominent local button **Tap to start listening**.
- General network/buffering: show **Waiting for YouTube…**, with Retry and Next options that obey shared-room controls.

---

## 11. UX and visual direction

### Aesthetic

**Theme:** A quiet evening, soft lilac/indigo sky, warm pink accents, subtle stars, restrained glass surfaces, warm human language, gentle animation. Avoid cluttered neon, overdone 3D effects, or an overly corporate music dashboard.

Suggested tokens (treat as a starting point, not a mandate):

```css
:root {
  --bg-deep: #111126;
  --bg-elevated: #1c1a37;
  --glass: rgba(255,255,255,.055);
  --border: rgba(255,255,255,.10);
  --text-primary: #f9f5ff;
  --text-muted: #b9b2d0;
  --accent-lilac: #b9a4ff;
  --accent-pink: #ffb4cf;
  --success: #9bd6b5;
  --radius-card: 24px;
}
```

### Core screens

**A. Landing — `/`**
- Soft illustration/CSS background, heading **Our Little Radio**, subheading **Some songs are better together.**
- Primary CTA **Create our room**.
- Short reassurance: **Just the two of you. No accounts needed.**

**B. Join — `/r/:roomId`**
- Greeting **You're invited to listen together ♡**.
- Name input, **Join room** button.
- Show friendly invalid/expired invite states without exposing technical details.

**C. Room — `/r/:roomId`**
- Top bar with room name, two avatars, online status, and guest invite-copy action for host.
- Prominent **visible** YouTube video card.
- Current-song label and **custom companion** controls: Play/Pause, seek, Next, local volume (do not sync local volume).
- Add-link input and **Add song** button.
- Shared queue (current song highlighted, who added it, remove/select actions).
- Local status area: **Listening together**, **Connecting…**, **Waiting for partner**, **Playback blocked — tap to resume**, **This video cannot be played here**.
- Invite link should never accidentally be copied with host credentials.

### Responsive layout

- **Mobile 320–480px:** single column; YouTube viewport stays compliant with minimum dimensions, queue below player, big ≥44px tappable controls, sticky or easy-reach core action area without obscuring the iframe.
- **Tablet:** spacious single/two-column hybrid.
- **Desktop:** centered max-width layout; video/controls on the left and queue/presence on the right.
- Test 320px viewport explicitly; if maintaining a compliant iframe and full controls is impossible at a narrow width, use a scrollable layout rather than scaling the YouTube player below minimum.
- Honor `prefers-reduced-motion`. Use keyboard focus rings, semantic labels, sufficient contrast, and graceful empty states.

### Suggested microcopy

- No songs: **The room is quiet. Add a song to begin.**
- Alone: **Your favorite person isn't here yet.**
- Both joined: **You're here together. ♡**
- Browser blocked: **Your browser needs one tap before music can play.**
- Connection lost: **The connection slipped. Reconnecting…**
- Unsupported video: **This video can't be played here. Try another YouTube link.**

### Anti-overengineering rule

Do not begin with animations, 3D, audio visualizers, theme settings, backend analytics, or animated backgrounds before end-to-end YouTube synchronization works on two actual devices.

---

## 12. Implementation phases and deliverables

### Phase 0 — Bootstrap and contracts

**Owner:** Foundation / Tech Lead Agent

Tasks:
1. Scaffold Vite + React + TypeScript + Tailwind, Express, Socket.IO, Zod, linting, Vitest.
2. Configure strict TypeScript, one repository/lockfile, `.env.example`, and npm scripts.
3. Establish shared `RoomSnapshot`, `PlaybackState`, `QueueItem`, and event input/output types and validation schemas in `src/shared/protocol.ts`.
4. Configure same-origin local dev proxy; production single-port server.
5. Add initial placeholder app and `/api/health`.
6. Establish `README.md` setup instructions for PowerShell.

**Gate:** `npm install`, `npm run dev`, `npm run build`, `npm start`, `npm run typecheck` work. `/api/health` responds; static SPA works in production.

### Phase 1 — Rooms and Socket.IO

**Owner:** Backend Agent

Tasks:
1. Build secure room creation and two independent role secrets.
2. Implement `RoomManager` as in-memory `Map` with cleanup and queue limit.
3. Implement validated room join, participant presence, role takeover, disconnect handling, and room state broadcasts.
4. Implement queue add/remove/select operations; use validated video IDs from URLs. For public deployment, add the server-side official `videos.list` Made-for-Kids status check (handle missing key/quota failures; never expose API key).
5. Implement server-authoritative playback commands and playback revision controls.
6. Add acknowledgements, idempotent action handling, rate limiting, typed errors, and log redaction.
7. Add socket integration tests with two simulated participants.

**Gate:** Two socket clients join one room; only valid credentials work; queue and playback commands produce identical snapshots; unauthorized third party cannot join; duplicate end/next requests cannot skip twice unintentionally.

### Phase 2 — Real YouTube playback

**Owner:** Frontend / Playback Agent

Tasks:
1. Implement app routes: landing, join, room.
2. Parse invite fragment safely and persist credentials on client.
3. Implement single-instance IFrame SDK loader and visible player wrapper.
4. Hook custom play/pause/seek/next controls to typed Socket.IO commands.
5. Implement local start-listening gate and `onAutoplayBlocked` handling.
6. Implement queue forms/list and presence indicators.
7. Handle unsupported videos, missing metadata, buffering, invalid links.
8. Ensure player SDK events never trigger uncontrolled broadcast loops.

**Gate:** With two local browsers, both can join, load the same YouTube video, use either browser to control playback, and see identical queue state. Browser audio activation is handled honestly.

### Phase 3 — Sync robustness

**Owner:** Sync / Integration Agent

Tasks:
1. Implement clock-offset estimation (three samples) and periodic recalibration.
2. Compute expected target position from canonical anchor.
3. Implement 6-second drift checks with reasonable tolerance and cooldown.
4. Implement late join at current playing position.
5. Implement idempotent track-ended handling and selected-song transition.
6. Implement reconnect/full snapshot restoration and stale event rejection.
7. Add unit tests for playback math and state transitions using a fake player adapter.

**Gate:** Under ordinary test conditions, two devices are usually within ~1–2 seconds; pause/seek/next converge; refresh and temporary disconnection restore canonical state; no infinite seek or event loops.

### Phase 4 — Design and polish

**Owner:** UI / UX Agent

Tasks:
1. Implement the cozy theme and refined typography.
2. Make all screens responsive with verified mobile player dimensions.
3. Improve empty/loading/disconnected/blocked/unavailable states.
4. Add gentle transitions and accessible interactive feedback.
5. Optional only after all prior gates: heart reaction and song-note UX.

**Gate:** Usable on desktop and phone, calm and warm, no iframe obstruction, good accessibility, and no regression of playback.

### Phase 5 — QA and deployment

**Owner:** QA / Release Agent

Tasks:
1. Add unit/integration/e2e coverage; use fake player adapter for deterministic tests.
2. Test a real host Windows browser and guest mobile browser on different networks.
3. Verify HTTPS, live socket connectivity through ngrok, browser interstitial behavior, and no mixed content.
4. Verify free-tier traffic considerations; no video proxying.
5. Produce final `README.md`, `.env.example`, and `docs/MANUAL_QA.md`.
6. Record limitations honestly and fix P0/P1 failures before styling extras.

**Gate:** Full manual end-to-end checklist passes under an actual public ngrok URL.

---

## 13. Agent delegation / collaboration protocol

If multiple agents are available, coordinate as follows:

| Agent | Owns | Must not modify without coordination |
|---|---|---|
| **Foundation / Lead** | Project scripts, configs, `src/shared/*`, integrations | Other agents' feature files |
| **Backend** | `server/*`, socket/room integration tests | UI components / design tokens |
| **Frontend** | `src/components/*`, core React routes, player wrapper | Authoritative server logic |
| **Sync** | `src/hooks/usePlaybackSync.ts`, playback math, sync tests | Event contract without lead agreement |
| **QA / Release** | `tests/*`, `e2e/*`, `docs/MANUAL_QA.md`, deployment review | Feature implementation unless assigned a fix |

**Sequencing:** Lead must define shared protocol **before** agents independently implement emitting/consuming events. Backend and frontend can then proceed in parallel using the contract. Sync integrates after both base pieces are working. QA runs from the beginning, not only at the end.

**Communication rules:**
- Each agent should report: files created/changed, commands run, test result, blockers, protocol changes.
- Do not silently change event payload shapes. Raise a contract proposal with a migration note.
- Keep builds green after each phase. If a feature cannot be completed, leave a clear TODO and disable the broken UI, rather than faking success.
- Focus on a complete vertical slice first: create → invite → join → add → play → pause → reconnect.

---

## 14. Scripts, configuration, and local hosting

### Environment variables

Create `.env.example`:

```dotenv
PORT=3000
NODE_ENV=development
# Recommended for public deployment: YouTube Data API key for required Made-for-Kids status checks
YOUTUBE_DATA_API_KEY=
# Optional: public absolute base URL. In production, prefer window.location.origin
# PUBLIC_BASE_URL=https://your-assigned-domain.ngrok-free.app
```

Room secrets are generated at runtime, not stored in `.env` in the MVP. Place any YouTube Data API key **only on the backend** and never commit it. Do not store the ngrok authtoken in the repository.

### Required npm commands

The agents must implement working equivalents of:

```powershell
npm install
npm run dev            # Starts Vite + backend together, for local development
npm run typecheck
npm run test
npm run build          # Produces client and server production artifacts
npm start              # Serves compiled app + Socket.IO on one PORT
npm run test:e2e       # Automated browser smoke tests
```

Suggested development implementation: `concurrently` for dev scripts, `tsx` to run/watch server TypeScript, Vite proxy to localhost:3000. For production, bundle/transpile backend (e.g. with `tsup`) and use `node dist-server/index.js`; serve client assets from `dist/`. Make sure SPA history fallback works for `/r/:roomId` while `/api` and `/socket.io` remain functional.

### Windows PC launch (after build)

PowerShell window 1:

```powershell
cd path\to\our-little-radio
npm install
npm run build
npm start
```

PowerShell window 2 (after ngrok is installed and authenticated):

```powershell
ngrok http 3000
```

Open the HTTPS URL displayed by ngrok; create a room; share **only the guest invitation URL**. The free tier may show an interstitial before the guest reaches the app.

### Hosting / network notes

- Ngrok tunnels the server, so inbound Windows router port forwarding is unnecessary.
- Same-origin Socket.IO on `/socket.io` avoids separate CORS/domain configuration.
- Keep PC sleep disabled during a listening session.
- ngrok URL and current free-plan behavior may change according to the account and provider rules.
- No public exposure of development debug endpoints, stack traces, local files, or room credentials.

---

## 15. Acceptance tests — required user-facing scenarios

Implement a `docs/MANUAL_QA.md` with a checkable copy of these scenarios.

| ID | Scenario | Expected result |
|---|---|---|
| A01 | Host creates room | Unique private guest invite created; host credential is not in copied link |
| A02 | Guest joins from another browser | Both appear online in same room |
| A03 | Third participant / invalid token | Access rejected; no state disclosure |
| A04 | Both add different YouTube URLs | Identical ordered queue in both browsers |
| A05 | Host presses Play | Both players attempt same song and converge near same time |
| A06 | Guest presses Pause | Both players become paused at near-equal position |
| A07 | Either seeks to 60 seconds | Both players converge near 60 seconds |
| A08 | Either presses Next | Both select exactly one next song |
| A09 | Song ends on both devices | Queue advances only once |
| A10 | Guest joins mid-song | Guest starts near the current canonical position after local activation |
| A11 | Guest refreshes | Guest re-authenticates and recovers current song, queue and status |
| A12 | Wi-Fi briefly disconnects | Status warns; reconnect restores authoritative state |
| A13 | Browser blocks autoplay | Clear local tap-to-listen CTA; other participant isn't paused |
| A14 | Video cannot be embedded | Friendly error; no bypass; room remains usable |
| A15 | Invalid YouTube URL | Rejected with clear feedback; queue unchanged |
| A16 | Rapid play/pause commands | No client/server event echo loops; last server-accepted intent wins |
| A17 | User opens same role on second tab | Documented newest-tab-takes-over policy applies |
| A18 | Server restarts | Old in-memory room invalid; clear recovery/create-new-room state |
| A19 | 320px-wide mobile viewport | Player usable/compliant, form readable, tap targets accessible |
| A20 | Different networks via ngrok | HTTPS loads; socket connects; both hear video directly from YouTube |
| A21 | One browser buffers | Other user's session isn't paused merely by buffering |
| A22 | Disconnect and send stale command | Stale offline intent does not overwrite fresh server state on reconnect |

### Automated test priorities

**Unit tests:** Video URL normalization and rejection; expected position math; state transition invariants; queue removal; end idempotency; secret/token validation.

**Integration tests:** Two Socket.IO clients joining; unauthorized join; presence; queue convergence; server-authenticated roles; duplicate request IDs; ordered control actions; reconnection snapshot.

**Browser tests:** Landing → room → guest join → queue update; mocked YouTube adapter for deterministic UI tests; one separate human-verified real YouTube playback smoke test because external embeds/autoplay/ads are not deterministic in headless browsers.

---

## 16. Edge cases and design decisions agents must explicitly handle

1. **No item selected:** Play disabled with friendly empty state.
2. **Queue item removed while playing:** Server selects next valid item and transitions to paused (avoid surprise autoplay).
3. **Next on final item:** Default to paused at the final item or no next action; do not loop unless an explicit loop feature is later added. Pick and document one deterministic behavior.
4. **Unsupported embed:** Do not fetch or pirate streams. User can remove/skip item.
5. **Autoplay blocked:** Local listener can tap to activate, without broadcasting a globally new PLAY action or resetting time.
6. **Native player controls:** Maintain YouTube's functionality; coordinate observable changes where possible without recursive events. Never obscure controls to enforce custom controls.
7. **YouTube buffering/ad divergence:** Do not seek aggressively or claim perfect sync during ads; present honest local status.
8. **Mobile lock screen / switched apps:** No guarantee of continued playback. Do not market this as a background music service.
9. **Clock skew:** Calibrate and base sync on server time, not just raw client `Date.now()`.
10. **User names:** Escape strings and cap length; React text interpolation protects against markup injection.
11. **Reorder/delete conflicts:** Server is canonical; use revisions, reject stale destructive operations, and reconcile.
12. **Server lifetime:** In-memory queue disappears after server restart. Persistence is a separate enhancement.
13. **Invite security:** Guest must not inherit host privileges. Guest link contains a secret; don't expose via referrers, analytics, or logs.
14. **Iframe origin/player error 153:** Use correct origin and standard referrer behavior; test against the actual ngrok domain.
15. **Free quota:** Keep transport lean; do not poll `/api` every second. Socket.IO already carries state changes.

---

## 17. Definition of done

The MVP is complete only when:

- [ ] A host can start the app on Windows and expose it through one ngrok HTTPS link.
- [ ] Host sends a guest invite and the guest joins from another device/network without an account.
- [ ] Both participants can add YouTube links and see one canonical queue.
- [ ] Either can play, pause, seek, and skip; state converges after typical latency.
- [ ] Late join, refresh, temporary disconnect, autoplay block, and unsupported videos have working recovery paths.
- [ ] Actual YouTube player remains visible, usable, and policy-compliant.
- [ ] No database, paid subscription, or cloud bill is needed for MVP use; public deployment includes the policy-required video-status lookup using a free-quota YouTube Data API key.
- [ ] Typecheck, unit tests, integration tests, and production build pass.
- [ ] README includes copy-and-paste PowerShell/ngrok deployment commands.
- [ ] All unresolved browser/provider limitations are documented accurately.

---

## 18. Start-here prompt for the lead coding agent

Copy the following instructions together with this document:

> Implement the attached **Our Little Radio — Agent Implementation Plan** in this repository. Treat the document as the source of truth. Start with Phase 0 and make sure the app builds/runs on Windows with npm. Define typed socket contracts and room state before parallelizing. Build the smallest complete end-to-end slice (create room, invite, join, paste YouTube URL, visible IFrame playback, shared controls) before polishing animations. Follow YouTube embedded-player policies, especially no hidden/audio-only player and browser autoplay limitations. Keep one Node/Express server serving both SPA and Socket.IO on one port for ngrok. Use no database in the MVP. Include the policy-required official YouTube Data API Made-for-Kids check before public deployment (the owner can supply a free-quota API key). Add tests for authoritative state, sync math, idempotency, and reconnect behavior. When done, report actual files changed, commands executed, tests passed/failed, and any remaining limitations. Do not stop after generating mockups or TODOs.

---

## 19. Official references (review before implementation)

- YouTube IFrame Player API: https://developers.google.com/youtube/iframe_api_reference
- YouTube embedded player dimensions/parameters: https://developers.google.com/youtube/player_parameters
- YouTube developer policies: https://developers.google.com/youtube/terms/developer-policies
- YouTube developer policy guidance: https://developers.google.com/youtube/terms/developer-policies-guide
- YouTube Made-for-Kids status guide (updated 2026-11-12): https://developers.google.com/youtube/data/guides/made_for_kids_status
- YouTube videos.list API (status.madeForKids): https://developers.google.com/youtube/data/reference/rest/v3/videos
- Chrome autoplay rules: https://developer.chrome.com/blog/autoplay
- Socket.IO mechanics and reconnection: https://socket.io/docs/v4/how-it-works
- Socket.IO acknowledgements: https://socket.io/docs/v4/emitting-events
- ngrok pricing and limits: https://ngrok.com/docs/pricing-limits
- ngrok free-tier documentation: https://ngrok.com/docs/pricing-limits/free-plan-limits

**Final principle:** Reliability first; compliance and safety always; warmth next; everything else later. The point is making it easy for two people to share a moment, not building a streaming company.
