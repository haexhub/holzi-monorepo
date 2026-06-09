# Plan 04: Retry Last Response

Status: implemented and merged on 2026-05-27. Backend [Holzi#36](https://github.com/haexhub/Holzi/pull/36) (merged); frontend [holzi-frontend#27](https://github.com/haexhub/holzi-frontend/pull/27) (merged).

Verification:

- In backend repo root (`Holzi/`): `uv run pytest` (379 passing, including 6 retry-endpoint tests in `tests/test_api_chat.py` + 5 repo-helper tests in `tests/test_messages.py`)
- `uv run ruff check src tests`
- backend boot: `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_DB_PATH=$(mktemp --suffix=.db) uv run uvicorn hermes.main:app --host 127.0.0.1 --port 18082 --log-level warning`
- frontend regen, in frontend repo root (`holzi-frontend/`): `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_URL=http://127.0.0.1:18082 pnpm run gen:api`
- `pnpm test` (56 passing, including 4 `retryLastResponse` tests)
- `pnpm typecheck`

Notes:

- Persistence strategy is the "simplest" option from the plan: `POST /api/conversations/{id}/retry` finds the last user message (`messages.last_user_message`) and hard-deletes the assistant/tool tail after it (`messages.delete_after`, keyed on monotonic autoincrement ids), then re-runs the web agent over the surviving context. No `superseded_at` bookkeeping. The `messages` FTS index stays consistent via the existing `AFTER DELETE` trigger.
- The endpoint reuses the `/api/chat` streaming path: the SSE generator was extracted into `_stream_web_agent_run(request, convo)`, so retry and send share one code path (run_id registration, `track_run`, cancel handling, error classification) — retry runs are persisted in `agent_runs` exactly like normal sends.
- Channel guard mirrors `/api/chat`: retry is rejected (400) on non-web conversations, and (400) when the conversation has no user message to retry; unknown conversation → 404.
- Frontend: `retryLastResponse(conversationId)` in `useChatStream` shares the SSE consumer with `sendChatMessage` (extracted `postChatStream`). `index.vue` shows a "Neu generieren" control on the latest assistant message only (`lastAssistantId`), disabled while a run is active; the page optimistically trims the assistant/tool tail so regeneration renders in place, then reloads the canonical conversation.

Depends on: [03](./03-chat-cancel-and-run-state.md).

## Goal

Let users regenerate the latest assistant response in a conversation.

## Why

Retry is one of the highest-value chat controls. It helps with provider flakiness,
weak answers, tool failures, and model nondeterminism without forcing the user to
copy/paste the previous prompt.

## Scope

Backend:

- Add `POST /api/conversations/{id}/retry`.
- Find the last user message in the conversation.
- Remove or supersede assistant/tool turns after that user message.
- Re-run the agent using the remaining conversation context.
- Stream the new response with the same SSE semantics as `/api/chat`.

Frontend:

- Add Retry button to the latest assistant message.
- Reuse stream rendering and loading state.
- Disable retry while another run is active.

Tests:

- Retry simple conversation.
- Retry conversation with tool turns after last user message.
- Reject retry when no user message exists.
- Ensure retry cannot target non-web conversation unless explicitly allowed.

## Suggested Implementation

1. Add repository helper to fetch the last user message.
2. Decide the persistence strategy:
   - simplest: delete all messages after the last user message
   - later: keep old messages with `superseded_at`
3. Reuse the existing agent runner path so retry is not a separate code path.
4. In the frontend, expose `retryLastResponse(conversationId)`.
5. Use the same streaming state as normal send.

## Acceptance Criteria

- A Retry action appears on the last assistant response.
- Clicking Retry replaces the previous assistant/tool tail with a new run.
- Conversation list updates after retry.
- Retry failures show the same friendly error handling as normal chat.

## Out Of Scope

- Retry arbitrary older messages.
- Forked conversations.
- Edit-and-regenerate.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/api.py`
  - `src/hermes/repository/messages.py`
  - `tests/test_api_chat.py`
  - `tests/test_api_conversations.py`
- Frontend:
  - `app/pages/index.vue`
  - `app/components/chat/ChatMessage.vue`
  - `app/composables/useChatStream.ts`
