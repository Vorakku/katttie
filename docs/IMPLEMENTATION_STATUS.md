# Implementation and verification status

Date: 2026-11-17 (Asia/Phnom_Penh)

The MVP code is implemented. Automated checks pass. Public video playback and the physical-phone/different-network acceptance gate still require the owner's YouTube Data API key and devices; this is not a claim that every manual acceptance checkbox has passed.

## Implemented

- React/Vite/TypeScript/Tailwind interface: landing, named host/guest entry, responsive room, visible YouTube player, presence, invitation copy, shared queue and local volume.
- Single-port Express/Socket.IO production server, development proxy, strict shared Zod payloads and typed acknowledgements.
- Independent high-entropy role credentials, invitation fragments removed before embedding, credential restoration and newest-tab takeover.
- Authoritative queue/playback anchors, room/playback revisions, serialized asynchronous mutations, stale-revision rejection, bounded request deduplication and once-only end handling.
- Three-sample clock calibration, 30-second recalibration, 6-second drift checks with 1.5-second tolerance/12-second cooldown, local activation and reconnect restoration without offline replay.
- Server-only official video-status lookup, bounded cache, missing-key/quota/API-error failure handling, loopback-only explicitly labeled prototype mode.
- CSP/referrer headers, payload/resource/rate bounds, queue cap 50 and empty-room expiry 12h.
- PowerShell/ngrok setup and all 22 manual acceptance scenarios.

## Executed evidence

Environment: Windows, Node 24.18.0, npm 11.16.0, installed Google Chrome and Microsoft Edge. Stable dependency releases are pinned by `package-lock.json`.

| Check | Result |
| --- | --- |
| npm dependency installation/audit | Passed; zero reported vulnerabilities after unused dependencies were removed. This is not a security guarantee. |
| `npm run typecheck` | Passed. |
| `npm test` | 69 tests in 7 files passed. Includes URL/clock math, credential isolation, authoritative transitions, real Socket.IO clients, fake player/controller/SDK lifecycle and reconnect behavior. |
| `npm run lint` | Passed. |
| `npm run build` | Passed; compiled client in `dist/`, server in `dist-server/`. |
| `npm start` | Started successfully; `/`, `/api/health`, and `/r/<id>` returned 200 with appropriate content types and referrer policy. |
| `npm run test:e2e` | Four tests passed across Chrome and Edge, using two isolated participant contexts and the 320px layout. Real app/server/sockets; only external YouTube/status services replaced. |
| `npm run dev` | Both services started; health proxy responded. The same four browser checks also passed through Vite at `localhost:5173` in explicitly local prototype mode. |
| Real YouTube local smoke | Actual official SDK/iframe loaded, local activation and playback progressed to 9 seconds with duration 3:33, UI reported playing, zero uncaught client errors. No SDK interception. This was localhost prototype mode without a status key. |
| Owner API key configuration | Saved only in the ignored backend `.env`; `LOCAL_PROTOTYPE=false`. A live lookup through the application's actual video-status service succeeded and returned Made-for-Kids=false for the sample video. Existing server processes need restart to load the new environment. |
| Exploratory real Chrome + Edge playback | Did not establish synchronized media playback: Chrome played but Edge reported YouTube error 2. A later diagnostic attempt was invalidated by a temporary instrumentation-wrapper bug; it changed no production code and supplies no product evidence. The original error 2 remains unresolved. No live drift result is claimed; investigation and owner-device acceptance remain required. |
| Real ngrok transport smoke | Production server reached over actual public HTTPS; homepage/health passed; two distinct authenticated WSS role sessions joined; snapshots did not disclose credentials; missing-key queue submission failed closed. Tunnel stopped afterward. |
| Independent source/spec review | Material delayed-ENDED/async-seek race found, regression reproduced, fixed and rereviewed. No remaining Important/Critical finding from that review. |

## Failures found and resolved

- Mobile grid intrinsic sizing overflowed 320px. Constrained tracks/children; browser checks now retain a >=200×200 player without horizontal overflow.
- An old ENDED event during an asynchronous same-video seek could be stamped with the new playback revision. Position confirmation now correlates the operation; delayed-end regression passes, including after the short suppression window.
- Vite's string proxy shorthand rewrote Host and failed the server's same-origin check on room creation. Explicit object proxies preserve Host; all four development browser checks passed afterward.
- The Windows sandbox prevented Playwright from terminating its own fixture server. The final complete browser run used approved execution outside that restriction and exited successfully. This was a testing-environment issue, not an app change.

## Still to verify

- The owner API key is now configured and a real official status lookup passed. Verify queue addition and real player loading through the actual public origin after restarting the server with the new configuration.
- A physical guest phone on cellular/different network, audible drift over a sustained session, mobile autoplay rules, ads, region restrictions, screen locking and Wi-Fi recovery. No 1–2 second two-device accuracy claim is established by fixtures.
- Actual ngrok browser-interstitial flow. The transport smoke used the documented test bypass header; that does not count as checking the visitor's interstitial UI.
- Complete the checkboxes in `docs/MANUAL_QA.md` and record measured drift/device details before declaring the full product definition of done.

No optional reactions, notes, persistence, accounts, media extraction, database or hosting service were added. No commits were made: the supplied workspace had no Git repository. Test servers/tunnel are stopped at handoff; room data from verification is intentionally ephemeral.
