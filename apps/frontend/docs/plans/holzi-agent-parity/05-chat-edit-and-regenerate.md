# Plan 05: Edit And Regenerate

Status: implemented and merged on 2026-05-27. Backend
[Holzi#37](https://github.com/haexhub/Holzi/pull/37) (merged); frontend
[holzi-frontend#28](https://github.com/haexhub/holzi-frontend/pull/28) (merged).

CodeRabbit: FE#28 flagged one `Major` finding — the generated `api-generated.ts`
typed the edit endpoint with `requestBody?: never` even though it's called with
`{ content }`, losing type safety. Fixed by declaring the request body as a
typed param (`EditMessageRequest`) in the backend so FastAPI documents the
schema; regenerated types now carry `requestBody`. Side effect: empty/missing
content now fails FastAPI validation with 422 instead of our manual 400 (no
frontend impact — both surface as a generic failed request).

Verification:

- In backend repo root (`Holzi/`): `uv run pytest` (393 passing, including 9
  edit-endpoint tests in `tests/test_api_chat.py` + 5 repo-helper tests in
  `tests/test_messages.py`)
- `uv run ruff check src tests`
- backend boot: `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_DB_PATH=$(mktemp --suffix=.db) uv run uvicorn hermes.main:app --host 127.0.0.1 --port 18082 --log-level warning`
- frontend regen, in frontend repo root (`holzi-frontend/`): `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_URL=http://127.0.0.1:18082 pnpm run gen:api`
- `pnpm test` (60 passing, including 4 `editAndRegenerate` tests)
- `pnpm typecheck`

Notes:

- Reuses the plan-04 delete-then-rerun mechanic, keyed on a specific message id
  instead of the last user message: `POST /api/conversations/{id}/messages/{message_id}/edit-and-regenerate`
  rewrites the user message in place (`messages.update_content`, keeping role +
  ts so the turn stays in chronological position), then `delete_after(after_id=message_id)`
  drops the entire tail, and `_stream_web_agent_run` regenerates over the
  surviving context. The FTS index follows the in-place edit via the existing
  `AFTER UPDATE` trigger on `messages`.
- Validation mirrors `/api/chat` + `/retry`: unknown conversation → 404; non-web
  channel → 400; message not found *or belonging to another conversation* → 404
  (the path's `conv_id` is authoritative, so clients can't edit across threads);
  non-`user` role → 400; empty content → 422 (declared-body validation).
- Frontend: `editAndRegenerate(conversationId, messageId, content)` in
  `useChatStream` shares the SSE consumer with `sendChatMessage`/`retryLastResponse`.
  `ChatMessage.vue` shows a "Bearbeiten" control on every persisted user turn
  (disabled while a run is active) that opens an inline textarea warning that
  later messages will be regenerated; `index.vue` optimistically rewrites the
  edited turn and trims the tail, then reloads the canonical conversation.

Depends on: [04](./04-chat-retry-last-response.md) — reuses the
delete-then-rerun mechanic on a specific message instead of the last one.

## Goal

Allow editing a previous user message and regenerating the conversation from
that point.

## Why

Editing is essential for productive agent work. Users often need to correct one
instruction instead of starting a new chat or manually reconstructing context.

## Scope

Backend:

- Add endpoint for editing a user message and regenerating from it.
- Ensure later assistant/tool messages are removed or superseded.
- Keep conversation integrity: no orphaned tool results.

Frontend:

- Add Edit action to user messages.
- Provide inline edit mode or a compact modal.
- Warn that later messages will be regenerated.
- Stream the replacement answer.

Tests:

- Editing the last user message.
- Editing an earlier user message.
- Reject editing assistant/tool messages.
- Reject editing messages outside the selected conversation.

## Suggested Endpoint

`POST /api/conversations/{conversation_id}/messages/{message_id}/edit-and-regenerate`

Body:

```json
{
  "content": "new user text"
}
```

## Suggested Implementation

1. Add backend validation:
   - conversation exists
   - message exists
   - message role is `user`
   - message belongs to conversation
2. Update the user message content and timestamp or create a replacement message.
3. Delete/supersede all later messages in that conversation.
4. Start a new agent run using the edited transcript.
5. Frontend reloads canonical conversation after stream completion.

## Acceptance Criteria

- User messages have an Edit action.
- Editing a message clearly communicates that later turns will be regenerated.
- After completion, the transcript contains the edited user text and a new
  assistant answer.
- Tool messages from the previous branch are gone or marked superseded.

## Out Of Scope

- Branch/fork UI.
- Version history of edited messages.
- Collaborative editing.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/api.py`
  - `src/hermes/repository/messages.py`
  - `tests/test_api_chat.py`
- Frontend:
  - `app/components/chat/ChatMessage.vue`
  - `app/pages/index.vue`
  - `app/composables/useChatStream.ts`
