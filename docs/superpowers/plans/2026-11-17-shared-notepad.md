# Shared notepad implementation plan

Use Superpowers executing-plans for inline implementation.

## Approved design

One shared plain-text pad below the player, styled to match the room. Both participants edit live. Concurrent edits merge through Yjs over the existing authenticated Socket.IO connection. Pending edits remain in the open tab during brief disconnects and merge on reconnect. Show loading, syncing, synced, disconnected, and error states. Extend the existing shared mouse cursors to the pad.

The user chose the current room lifetime. Notes live in server memory and expire with the room or when the server restarts. Refresh restores server-confirmed content. Yjs is the single added direct dependency.

## Constraints and implementation choices

- Follow the user's verification rule. Ask before writing tests or running analysis, tests, builds, or apps.
- Work in the supplied directory, which has no Git repository.
- Keep note events independent of queue/playback revisions and rate limits.
- Limit plain text to 10,000 UTF-16 code units and encoded document state to 256 KiB. Validate binary envelopes and candidate document state before changing the authoritative document.
- Preserve textarea selections across remote edits, handle IME composition, and scope undo/redo to local edits.

## Tasks

- [x] Define binary note payloads and typed events. Add a Yjs document to each room, validate updates atomically, reclaim documents on room expiry, and add authenticated note handlers with a separate rate limit.
- [x] Add a client note connection using the room socket. Batch updates, acknowledge saves, merge full state on reconnect, retain unsent edits, handle retries and cleanup, and expose note state through the room hook.
- [x] Add the plain-text editor below the player. Bind incremental text changes, preserve selections and composition, show sync status, and add a notepad cursor anchor and responsive styles.
- [ ] Ask whether the user wants verification. After authorization, start with TypeScript and targeted socket/merge coverage. Browser checks require a further run only if requested or needed.

## Review focus

Unauthorized and cross-room events, malformed updates, note size limits, simultaneous inserts/deletes, uncertain acknowledgements, reconnect with pending edits, seat replacement, refresh, emoji boundaries, IME composition, selection stability, and local undo.
