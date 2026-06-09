# Plan 01: Conversation Lifecycle

Status: implemented and merged on 2026-05-25.

Verification:

- `uv run pytest tests/test_api_conversations.py tests/test_api_chat.py::test_api_chat_creates_new_conversation_when_none_provided`
- `uv run ruff check src/hermes/repository/conversations.py src/hermes/routes/api.py tests/test_api_conversations.py tests/test_api_chat.py`
- `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_URL=http://127.0.0.1:18082 pnpm run gen:api`
- `pnpm test`
- `pnpm typecheck`

## Goal

Make conversations manageable: auto-title new chats, rename existing chats, and
delete conversations safely.

## Why

The current Web UI can create and select conversations, but it cannot organize
them. This is the first foundation for a long-lived personal agent because old
threads must remain usable instead of becoming anonymous `web #N` entries.

## Scope

Backend:

- Add server-side auto-title for new web conversations based on the first user
  message.
- Add `PATCH /api/conversations/{id}` for renaming.
- Add `DELETE /api/conversations/{id}`.
- Ensure delete removes associated messages in a transaction.

Frontend:

- Add rename and delete actions to `ConversationList.vue`.
- Clear active chat when the active conversation is deleted.
- Keep the list in sync after rename/delete.

Tests:

- Backend API tests for auto-title, rename, delete, auth, and missing IDs.
- Frontend composable or component-level tests for rename/delete state if the
  implementation extracts conversation API helpers.

## Suggested Implementation

1. Add backend request schema, for example `ConversationUpdate`.
2. Add repository functions:
   - `update_title(conversation_id, title)`
   - `delete(conversation_id)`
3. In `/api/chat`, when creating a new web conversation, derive a title from the
   first user message:
   - trim whitespace
   - collapse newlines
   - limit to about 60 characters
   - fallback to `New chat`
4. Extend generated OpenAPI types.
5. Add frontend actions:
   - rename via small inline form or simple prompt first
   - delete with confirmation
6. Refresh conversation list after mutations.

## Acceptance Criteria

- A new chat no longer appears as `web #N` when the first user message exists.
- A conversation can be renamed from the sidebar.
- A conversation can be deleted from the sidebar.
- Deleting the active conversation returns the UI to an empty new-chat state.
- Signal/Telegram conversations are not accidentally modified through web-only
  assumptions.

## Out Of Scope

- Search.
- Archive/pin/tag.
- Bulk operations.
- Import/export.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/api.py`
  - `src/hermes/repository/conversations.py`
  - `tests/test_api_conversations.py`
- Frontend:
  - `app/components/chat/ConversationList.vue`
  - `app/pages/index.vue`
  - `app/types/api-generated.ts`
  - `app/types/api.ts`
