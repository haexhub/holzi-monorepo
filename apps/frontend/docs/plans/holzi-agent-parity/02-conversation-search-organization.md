# Plan 02: Conversation Search And Organization

Status: implemented and merged on 2026-05-26. Search-semantics follow-up filed as
[Holzi#33](https://github.com/haexhub/Holzi/pull/33).

Verification:

- `uv run pytest tests/test_api_conversations.py tests/test_conversations.py`
- `uv run ruff check src/hermes/repository/conversations.py src/hermes/routes/api.py tests/test_api_conversations.py tests/test_conversations.py`
- `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_URL=http://127.0.0.1:18082 pnpm run gen:api`
- `pnpm test`
- `pnpm typecheck`

Follow-ups (post-merge review):

- [Holzi#33](https://github.com/haexhub/Holzi/pull/33) — align FTS5 and
  title-LIKE semantics. The initial implementation OR-joined tokens on
  the title side but AND-joined them on the FTS5 side, so a thread
  mentioning only one query word surfaced via the title but not via its
  messages. The fix moves FTS to `tok*` (prefix) joined with OR on both
  sides, so multi-word queries widen the result set consistently and
  partial words like `dent` find messages mentioning `dentist`.

Depends on: [01](./01-conversation-lifecycle.md).

## Goal

Make old conversations findable and lightly organizable from the sidebar.

## Why

A central agent becomes valuable when past work can be recovered. Search is more
important than visual polish because it lets the user treat Holzi as durable
memory rather than a disposable chat box.

## Scope

Backend:

- Extend `GET /api/conversations` with optional query parameters:
  - `q`
  - `channel`
  - `limit`
- Use title matching plus message FTS where available.
- Return stable conversation summaries without exposing duplicate rows.

Frontend:

- Add a search input to the conversation sidebar.
- Debounce search requests.
- Preserve active conversation selection while searching.
- Show empty state for no results.

Tests:

- Backend tests for title hits, message hits, no hits, auth, limits, and channel
  filtering.
- Frontend tests for debounced search if a composable is extracted.

## Suggested Implementation

1. Add repository search function that returns conversation IDs from:
   - conversation title `LIKE`
   - `messages_fts MATCH`
2. Join IDs back to conversation summaries sorted by `updated_at DESC`.
3. Keep `q` optional; existing list behavior must not change.
4. In the frontend, add `searchQuery` and call `loadConversations` with `{ q }`.
5. Use `useDebounceFn` from VueUse or a small local debounce.

## Acceptance Criteria

- Searching by words from a previous message finds the conversation.
- Searching by title finds the conversation.
- Clearing the search returns the normal list.
- No duplicate conversations appear in mixed title/message hits.
- Existing conversation loading remains compatible.

## Out Of Scope

- Tags.
- Pin/archive.
- Full advanced filters.
- Semantic/vector search.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/api.py`
  - `src/hermes/repository/conversations.py`
  - `tests/test_api_conversations.py`
- Frontend:
  - `app/components/chat/ConversationList.vue`
  - `app/pages/index.vue`
