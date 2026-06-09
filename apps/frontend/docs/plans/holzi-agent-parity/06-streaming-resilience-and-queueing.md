# Plan 06: Streaming Resilience And Queueing

Status: implemented and merged on 2026-05-27. Frontend-only
([holzi-frontend#29](https://github.com/haexhub/holzi-frontend/pull/29),
merged); no backend changes this session. The full SSE resume protocol
(`reconnecting` state) stays deferred — see Notes.

CodeRabbit: unavailable for this PR — the org ran out of usage credits, so
the automatic review never completed and a re-trigger only re-acked. Per the
CR-rate-limit fallback the changes were self-reviewed on the PR; that review
caught one real gap (a user-cancelled turn stranded queued follow-ups with no
send path), fixed in 69a3788 before merge.

Verification (frontend repo root, `holzi-frontend/`):

- `pnpm test` (67 passing, incl. 5 `useChatQueue` FIFO-order tests and the new
  `useChatStream` reader-failure + terminal-`error` tests)
- `pnpm typecheck`

Notes:

- Stream lifecycle now tracked as an explicit `StreamState`
  (`idle`/`streaming`/`failed`/`cancelled`) in `useChatStream.ts`, replacing
  the bare `streaming` boolean in `index.vue`. Only `streaming` gates sending.
- `reconnecting` is defined in the union but intentionally unreachable: a real
  resume needs server-side event buffering + `Last-Event-ID`, which is out of
  scope here (the plan's own "no full resume protocol"). Kept in the type so
  the state set is stable when a future resume plan lands.
- Follow-ups typed during a turn go into a visible local FIFO queue
  (`useChatQueue`), render as dimmed pending user bubbles, and flush one-by-one
  only after a clean `done`. A dropped (`failed`) or user-cancelled
  (`cancelled`) turn keeps them visible and unsent, with an explicit
  "Warteschlange jetzt senden" retry path (`queueStalled`).
- The SSE `error` event is now terminal in the consumer, mirroring `cancelled`
  — post-error deltas are ignored rather than rendered as a successful turn.

Depends on: [03](./03-chat-cancel-and-run-state.md) (stream state machine).

## Goal

Make chat feel robust during slow/mobile networks and allow users to queue the
next message while a turn is still streaming.

## Why

Holzi is intended to be used from everywhere. Mobile and remote connections will
drop. Users also naturally type follow-ups while the agent is still answering.

## Scope

Frontend-first session:

- Track stream state as:
  - `idle`
  - `streaming`
  - `reconnecting`
  - `failed`
  - `cancelled`
- Keep composer usable while streaming.
- If user submits while streaming, place the message in a visible local queue.
- Automatically send the queued message after `done`.
- Show explicit failure state if the stream drops.

Backend:

- No full resume protocol in this session.
- Ensure SSE errors are terminal and clear.

Tests:

- `useChatStream` test for reader failure.
- UI/composable test for queued send order if queue logic is extracted.

## Suggested Implementation

1. Refactor `app/pages/index.vue` chat state into clearer state variables or a
   small composable.
2. Change composer disabling:
   - Stop button remains active for current stream.
   - Send can enqueue instead of being disabled.
3. Represent queued messages in the transcript as pending user messages.
4. On stream `done`, shift one queued message and send it.
5. On stream failure, keep queued messages unsent and visible.

## Acceptance Criteria

- The user can type and submit while Holzi is responding.
- Queued message is visible before it is sent.
- Queued message sends automatically after the current response finishes.
- A dropped stream does not silently clear queued messages.
- Failure state gives the user an obvious retry path.

## Out Of Scope

- True server-side queue.
- Resuming a partial SSE stream from event ID.
- Queueing for Signal/Telegram.

## Files Likely Touched

- Frontend:
  - `app/pages/index.vue`
  - `app/components/chat/ChatComposer.vue`
  - `app/composables/useChatStream.ts`
  - `tests/composables/useChatStream.test.ts`
