# Playback synchronization implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved design inline. The user explicitly requested implementation; do not reopen execution-method approval.

**Goal:** Join the current listening session and share host/guest seeking through buffering.

**Architecture:** Retain server-owned playback anchors and existing SEEK commands. Estimate the clock at join time and retain the expected pre-buffer position in the existing player sample.

**Tech Stack:** React, TypeScript, Socket.IO, YouTube IFrame API.

**Spec:** `docs/superpowers/specs/2026-11-17-playback-sync-design.md`

## Global constraints

- No tests will be written and no analysis, tests, builds or applications will run before the user authorizes verification.
- No dependencies, server protocol changes or second playback authority.
- This directory has no Git repository; implement in place and do not stage or commit.
- User approval of the design and instruction to implement authorizes inline execution. Verification and independent review remain pending under the user's ask-first rule.

## Review focus

- Join and reconnect must use the live room timeline without resetting the host.
- Native forward/backward seeks must survive more than 2.5 seconds of buffering.
- Buffering without a seek must not publish a false control.
- Asynchronous programmatic changes and inactive/offline players must not publish native seeks.
- Both roles preserve playing/paused state and existing revision validation.

## Task 1: Initial room clock

- [x] Modify `src/hooks/useRoomSocket.ts`: record client send/receive times around the join request and set `offsetMs` from the successful snapshot's `serverNowMs` before the connection becomes online.
- [x] Keep the existing three-sample calibration, stale-snapshot filtering and reconnection behavior.
- [ ] After authorization: extend `tests/playback-socket.test.ts` to establish a nonzero clock estimate before calibration responds, including a reconnect.

## Task 2: Native seeks through buffering

- [x] Modify `src/shared/player-controller.ts`: on a valid buffering transition, freeze the existing position sample at its expected position on entering buffering and mark its sample state as buffering.
- [x] Permit that sample to survive the normal age cutoff; do not count buffering time as playback progress. Refresh it on the next stable sample/state as today.
- [x] Require activation and confirmed programmatic positioning before detecting native seeks; preserve suppression, room/video checks and existing feedback-loop handling.
- [ ] After authorization: extend `tests/playback-controller.test.ts` for forward/backward buffered seeks, paused seeking, ordinary buffering, inactive/offline events and unconfirmed asynchronous seeks.
- [ ] After authorization: run `npm run typecheck`, then focused playback tests. Broaden checks only for new failures or unresolved concerns. Real two-device audio verification remains separate.

## Execution record

- Approved design received; implementation requested explicitly.
- Ruling: defer TDD and automated verification because the user's AGENTS.md explicitly prohibits writing tests or running checks before asking after implementation.
- Ruling: implement inline in the existing non-Git workspace; do not create a repository or dispatch agents solely to review unverified work before the user chooses verification.
- Source changes implemented. Tests have not been written; typechecking, automated checks, independent review and real playback verification remain pending user authorization.
