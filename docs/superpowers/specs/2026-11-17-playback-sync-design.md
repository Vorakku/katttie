# Joining and shared seeking

## Intent

Host and guest listen to one shared session. Joining mid-song starts at the current room position once the joining device enables listening. Either participant can seek to a position such as 2:50 and both players follow, preserving whether the room is playing or paused.

## Existing behavior and source findings

- The server already owns the selected song, playing/paused state, timestamp anchor and playback revision. Both authenticated roles can send playback controls; joins return the current snapshot without resetting playback.
- The client already calculates a live position on activation and exposes a shared seek slider.
- Clock offset starts at zero until three calibration pings complete. Use the join response and its round-trip timing for an initial estimate, then retain the existing calibration.
- Native YouTube seek detection rejects samples older than 2.5 seconds. A seek followed by longer buffering can lose its comparison point and never become a shared SEEK command.

## Approach

Extend the existing synchronization path. A second host-owned clock or a replacement player would duplicate working server authority and introduce unnecessary coordination.

1. Estimate server clock offset from the successful join response before marking the connection online, using the request/response midpoint. Keep the existing lowest-round-trip calibration and reconnect behavior.
2. Preserve a valid pre-buffer position reference for native seek detection. Account for playback time before buffering and distinguish an actual position jump from normal buffering recovery. Programmatic changes, old-video events, offline events and inactive players must not become new shared seeks.
3. Keep the application's seek slider connected to the same existing server control path for both roles. Preserve paused/playing state, validation, revision checks and feedback-loop protection.
4. Joining or enabling sound must never send a seek that resets the other listener's session. The room clock remains authoritative.

## Scope and limits

Expected source changes are confined to the socket client and player controller, with playback hook or slider changes only if required by the traced behavior. No new dependencies, protocol or server authority changes are planned.

Each browser may require an Enable listening gesture. Ads, buffering and device/network differences prevent a promise of exact simultaneous audio. Do not bypass YouTube controls or autoplay restrictions.

## Verification boundary

No tests will be written and no analysis, tests, builds or applications will run before the user authorizes verification. After implementation, ask the required verification question. Suggested authorized coverage: join/reconnect timing, seeks in both directions while playing and paused, seek buffering longer than 2.5 seconds, buffering without seeking, and absence of programmatic feedback loops. Real-device audible synchronization remains a separate manual check.
