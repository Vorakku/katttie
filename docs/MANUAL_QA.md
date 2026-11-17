# Manual acceptance checklist

Run these against a production build with a real server-only YouTube Data API key. Use host desktop Chrome/Edge and a guest phone on a different network (for example cellular). Both should use the same ngrok HTTPS origin. Automated fixture tests do not count as real YouTube or physical-device evidence.

Record: date, app version/files, OS/browser versions, phone model, network conditions, ngrok origin (without invitation fragment), actual measured drift and any failures. Never put credentials or full guest links in screenshots or reports.

## Environment

- [ ] `npm run typecheck`, `npm test`, `npm run build` pass.
- [ ] Production server and `ngrok http 3000` are running; PC sleep disabled.
- [ ] `LOCAL_PROTOTYPE=false`; server has a working `YOUTUBE_DATA_API_KEY`.
- [ ] Open HTTPS URL on both networks, complete ngrok interstitial if shown.
- [ ] No mixed-content/CSP/player errors; network requests show app/sockets at same origin, media directly at YouTube/Google.

## Required scenarios

- [ ] **A01** Create room. Guest invite is unique, contains only guest key in fragment, never the host credential.
- [ ] **A02** Guest joins another browser. Both participants appear online.
- [ ] **A03** Invalid credential/third party is rejected without queue or participant disclosure.
- [ ] **A04** Both add different supported YouTube links. Queue order and selected item match.
- [ ] **A05** Host presses Play after each device enables listening. Both attempt playback and converge; record measured drift after 10/30/60 seconds.
- [ ] **A06** Guest presses Pause. Both stop near equal positions; no restart at zero.
- [ ] **A07** Either seeks to 60 seconds. Both converge near 60 seconds and preserve paused/playing state.
- [ ] **A08** Either presses Next. Exactly one song advances; final-song Next pauses without looping.
- [ ] **A09** Both players reach end. Exactly one advance, including delayed end from old video.
- [ ] **A10** Guest joins mid-song. After local activation, starts near the current canonical position, without resetting host.
- [ ] **A11** Guest refreshes. Credential/name rejoin and current queue/playback are restored.
- [ ] **A12** Briefly disconnect Wi-Fi. Banner warns, partner continues, reconnect restores canonical state.
- [ ] **A13** Browser blocks autoplay. Local tap CTA appears; partner is not paused. Tap resumes locally without a global new Play.
- [ ] **A14** Deleted/private/non-embeddable video. Friendly error or status-check rejection; room remains usable. Error 153 mentions origin/referrer.
- [ ] **A15** Invalid URL, disguised host, malformed video ID. Clear rejection; queue unchanged.
- [ ] **A16** Rapid Play/Pause from both browsers. Last accepted intent wins, no event/seek feedback loop.
- [ ] **A17** Open same role in another tab. New tab replaces old; old explains takeover and does not reconnect-fight.
- [ ] **A18** Restart server. Old room fails clearly and offers creating a new one; no invented recovery state.
- [ ] **A19** 320px viewport. Visible iframe at least 200×200, no overlapping decoration, readable forms and >=44px tap targets, keyboard focus accessible.
- [ ] **A20** Two actual devices/networks through ngrok HTTPS. Socket remains connected, both receive media directly from YouTube. Record session length and tunnel errors.
- [ ] **A21** Throttle one device until buffering. Partner keeps playing; buffering device reports waiting and reconciles after recovery.
- [ ] **A22** Disconnect then attempt old command. Disabled offline controls and reconnect prevent stale intent overwriting fresh state.

## Additional edge checks

- [ ] Current playing queue item removed: next valid item selected, paused; removing last leaves no selection.
- [ ] Select queue item: pause at zero on both browsers.
- [ ] Duplicate/rapid add or command retries never apply twice.
- [ ] Native YouTube play/pause/seek remain accessible and no recursive broadcasts occur.
- [ ] API key missing, invalid, quota-limited, or Google timeout: add fails safely with retry guidance; key never appears in browser/network payloads.
- [ ] Made-for-Kids content is checked; no app consumption tracking exists.
- [ ] Mobile app switching/screen lock returns to honest state and reconciles on foreground; background playback is not promised.
- [ ] Reduced motion, keyboard-only navigation, clipboard permission failure, storage unavailable, SDK load failure and retry are usable.
- [ ] After room expiry or cleared browser data, invalid invitation/rejoin has a create-new-room path.

## Results

Real two-device YouTube playback and different-network/mobile acceptance remain **unchecked** until an operator completes them. Automated and tunnel transport results are recorded separately in `IMPLEMENTATION_STATUS.md`; do not mark all boxes based on mock-player success.
