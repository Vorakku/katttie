# Shared cursors implementation plan

Use Superpowers executing-plans for inline implementation.

## Approved design

Both room participants see the other person's Mac-style black arrow with a colored outline and their name below it. Host uses lilac and guest uses pink. Positions follow room sections and queue items across responsive layouts. Movement is sent around 20 times per second and interpolated visually. Hide presence on page exit, tab hiding, disconnect, seat replacement, and entry into the cross-origin YouTube frame.

## Architecture and constraints

Reuse React, Socket.IO, Zod, authenticated room identities, and participant names. Cursor messages are ephemeral, room-scoped, validated, rate-limited, and sent outside queue/playback mutations. Use normalized coordinates and stable content anchors. No dependencies are needed.

The user requires permission before writing tests or running analysis, tests, builds, or apps. All such checks remain pending. This directory has no Git repository, so implementation happens in place.

## Tasks

- [x] Add cursor payload validation and typed client/server events in `src/shared/protocol.ts`. Relay authorized cursor messages in `server/socket-handlers.ts`, with a separate rate limit and lifecycle cleanup.
- [x] Extend `src/hooks/useRoomSocket.ts` with throttled, unbuffered cursor sends, receive state, heartbeat expiration, and disconnect cleanup. Preserve existing command and snapshot behavior.
- [x] Add `src/components/RoomCursors.tsx`, anchor the room sections and queue rows in `src/App.tsx`, and style the cursor in `src/styles/globals.css`. Map scroll and resize changes, ignore touch input, preserve clicks, and honor reduced motion.
- [ ] Ask the user whether to verify. Suggested checks after authorization are TypeScript checking, focused socket tests, then a two-browser visual check if desired.

## Review focus

- Invalid coordinates and unauthenticated or cross-room cursor traffic.
- Seat replacement, reconnect, tab hiding, and lost hide packets.
- Different viewport sizes, document scrolling, queue scrolling, and removed queue items.
- Final pointer position after a short movement and throttled cleanup messages.
- Cross-origin iframe boundaries, long names, viewport edges, and reduced motion.
