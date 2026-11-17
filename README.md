# Our Little Radio

A private, two-person room for listening to YouTube together. React and a small Node.js server share one authoritative queue and playback clock. Video streams directly from YouTube to each browser; the PC and ngrok carry only the application and room events.

## Windows setup

Install a supported Node.js LTS version (22.12 or newer; Node 24 recommended) and npm. In PowerShell:

```powershell
cd E:\Test\katttie
npm install
Copy-Item .env.example .env
notepad .env
npm run dev
```

Open the Vite URL printed in the terminal, normally `http://localhost:5173`. Development uses Vite's `/api` and WebSocket proxy to the backend on port 3000. Use the same hostname consistently: browser credentials belong to an origin, so `localhost` and `127.0.0.1` have separate storage.

If npm cannot write to its system cache, use `npm install --cache .npm-cache`. The cache and all secrets are ignored by Git.

## YouTube setup before public sharing

The official IFrame player itself needs no key. This application checks each submitted video's status with the official YouTube Data API before adding it to the queue, including Made-for-Kids and embeddability status. Configure the server key first:

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **YouTube Data API v3**, create an API key, and restrict it to that API. For server-side usage, use suitable server IP restrictions if your deployment has a stable public IP; browser referrer restrictions are unsuitable for this server request.
3. Put `YOUTUBE_DATA_API_KEY=your-key` in `.env`. Never prefix it with `VITE_`, put it in browser code, or commit it.
4. Keep `LOCAL_PROTOTYPE=false` for ngrok/public use. Restart the Node server after editing `.env`.

Missing key, quota exhaustion, unavailable video, and failed status checks show an error and leave the queue unchanged. The key stays on the server. There are no app analytics, third-party fonts, or consumption tracking. See the [official Made-for-Kids guidance](https://developers.google.com/youtube/data/guides/made_for_kids_status) and [developer policies](https://developers.google.com/youtube/terms/developer-policies).

For **local-only prototyping**, explicitly set `LOCAL_PROTOTYPE=true` without a key and restart. The UI labels this mode; the server binds to loopback and rejects forwarded/public-origin traffic. It is not a public-deployment bypass. Do not expose it through a tunnel.

## Production: one port and one ngrok tunnel

PowerShell window 1:

```powershell
cd E:\Test\katttie
npm install
# .env must contain YOUTUBE_DATA_API_KEY and LOCAL_PROTOTYPE=false.
npm run build
$env:NODE_ENV = "production"
npm start
```

The server serves the built SPA, `/api`, and Socket.IO on `PORT=3000`. Deep links such as `/r/room-id` return the SPA. Health check: `http://localhost:3000/api/health`.

Install ngrok from its [official download page](https://ngrok.com/download), connect your account following the dashboard instructions, then in PowerShell window 2:

```powershell
ngrok http 3000
```

Open the **HTTPS** URL printed by ngrok. Create the room at that public URL, then copy the **guest invitation** from inside the room. Both browsers must use that public origin; a localhost invite cannot reach another device. Send the link privately to your partner. Each person joins and taps **Enable listening** on their own device.

No router port forwarding, second tunnel, database, or cloud server is needed. Keep the PC awake, online, and both terminals running. Never store your ngrok authtoken in this repository. Stop with `Ctrl+C`; the in-memory rooms disappear on server restart.

Free ngrok endpoints may display a browser warning/interstitial before entering the application, and quotas can change. Check the [current official limits](https://ngrok.com/docs/pricing-limits/free-plan-limits) and your dashboard. YouTube media traffic does not pass through the tunnel.

## Use

1. Create a room and choose a short name.
2. Copy the guest invitation; the host credential is never included.
3. Your partner follows it, chooses a name, and joins.
4. Paste an individual YouTube link. The first song is selected and paused.
5. Both users enable listening locally, then either can play, pause, seek, select, remove, or skip songs. Volume stays local.
6. Drag a queue handle up or down to reorder songs for both listeners. Touch dragging and arrow keys on a focused handle also work; Home/End move a song to the beginning/end. The current song continues playing. If the room changes during a drag, retry against the updated queue.
7. Use **Notes** at the top right to open shared sticky notes. Add notes, pick a color, and drag their handles anywhere in the window. Pin a note to lock its position and keep it visible when the notes menu is closed. Both participants share text, colors, placement and pinning. Existing notepad text appears as the original note. Notes are limited to 20 cards and 10,000 characters in total; they last until the room ends or the server restarts.

The shared cursor follows text, button and other standard cursor shapes within the application. Over YouTube it stays at the last known entry position, labeled **in YouTube**. The embedded player cannot report its internal mouse movement or cursor shape to this application; its native controls remain available.

Accepted links include YouTube watch, mobile/music watch, youtu.be, shorts, and embed URLs. Playlist imports, search, and media downloading are intentionally absent.

## Privacy and room rules

- Invitations are bearer secrets: share only with the intended guest. Anyone holding one can replace the guest session.
- Host and guest have distinct random credentials. Invitation keys use the URL fragment; the app stores them locally by room ID and removes the fragment from the address bar before creating the player.
- Browser storage contains only the credentials needed to rejoin and your display name. A shared computer/browser profile can access them. Clear site data to forget them.
- There is at most one live connection per role. A new authenticated tab/device replaces the old one, which stops reconnecting and explains why.
- Disconnecting does not pause the other listener. Reconnection rejoins and obtains a full snapshot; offline controls are disabled and are never replayed.
- Queue limit: 50. Empty inactive rooms expire after 12 hours. Room creation, joins and commands have limits; this is a personal two-user service, not a public platform.
- Selecting a song pauses it at zero. Removing the current song selects the next valid item and pauses. Next on the final song pauses that song at its canonical position; it does not loop.
- Server restarts erase all rooms, queues, credentials, and participant state. Create a new room after restart.

## Synchronization and browser limitations

The server owns playback anchors, state revisions, and queue order. Clients estimate server time with three pings (lowest round-trip sample), recalibrate every 30 seconds, and reconcile on reconnect. Drift checks run every 6 seconds; correction needs more than 1.5 seconds drift and observes a 12-second cooldown. Duplicate mutations and simultaneous end events cannot advance twice.

The target is usually within 1–2 seconds on healthy connections, not sample accuracy. **That target still needs measurement on your actual devices/networks.** Ads, region restrictions, slow devices, and different buffering can prevent convergence. The app does not aggressively seek during buffering or errors. Autoplay blocking and local errors never pause the partner's player.

The YouTube player is hidden (only the CD shows), so its native controls are not reachable. **This breaks YouTube's rule that the official player stays visible and at least 200×200 px, and can get API access revoked.** External controls are the most predictable way to send shared intents. Programmatic events are suppressed to prevent feedback loops; clearly observable native changes are coordinated where distinguishable. Some native actions cannot be distinguished reliably from YouTube's own behavior.

The hidden player keeps a 200×200 px size at opacity 0 so browsers do not throttle it. Do not expect background or locked-phone audio. Errors 100, 101/150, and 153 have explicit recovery messages; the app does not bypass video restrictions (region, age, embedding). See the [official IFrame API](https://developers.google.com/youtube/iframe_api_reference).

## Checks

```powershell
npm run typecheck
npm test
npm run build
npm run lint
npm run test:e2e
```

Browser tests use installed **Google Chrome** and **Microsoft Edge** with two isolated participant contexts. Install those browsers first. The real application, server, and Socket.IO run; the external YouTube SDK and video-status request are replaced with deterministic test fixtures. There is no fake-player switch in production. Close a server already using port 3000 before starting the browser tests.

For an existing test deployment, set `E2E_BASE_URL` to use it instead of launching the test server. Tests that add songs still need an actual valid API key on that deployment. Do not point destructive browser tests at a room people are currently using.

The [manual acceptance checklist](docs/MANUAL_QA.md) includes real YouTube playback, mobile/different-network tests, ngrok interstitials, ads and autoplay restrictions that deterministic browser tests cannot establish. Passing automated checks does not mean these manual scenarios passed.

## Project map

- `src/shared/`: Zod contracts, URL validation, server-clock math, playback controller.
- `server/`: room authority, socket/HTTP boundaries, official status lookup.
- `src/hooks/`: socket session recovery and playback synchronization.
- `src/components/`: room interface and the hidden YouTube player behind the CD deck.
- `tests/`: unit and real-socket integration tests.
- `e2e/`: two-browser flow tests and external-service fixtures.
- `docs/OUR_LITTLE_RADIO_IMPLEMENTATION_PLAN.md`: original specification.
- `docs/IMPLEMENTATION_STATUS.md`: executed checks and outstanding live-device verification.
