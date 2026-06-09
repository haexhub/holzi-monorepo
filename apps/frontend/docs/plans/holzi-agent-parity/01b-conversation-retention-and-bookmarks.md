# Plan 01b: Conversation Retention And Bookmarks

Status: implemented and merged on 2026-05-26. Backend [Holzi#32](https://github.com/haexhub/Holzi/pull/32) (merged), frontend [holzi-frontend#21](https://github.com/haexhub/holzi-frontend/pull/21) (merged).

Verification:

- `uv run pytest tests/test_conversations.py tests/test_scheduler.py tests/test_api_conversations.py tests/test_db.py` (340 passing)
- `uv run ruff check src/hermes/ tests/`
- backend boot (run from the Holzi repo root): `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_DB_PATH=$(mktemp --suffix=.db) uv run uvicorn hermes.main:app --host 127.0.0.1 --port 18082 --log-level warning`
- frontend regen: `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_URL=http://127.0.0.1:18082 pnpm run gen:api`
- `pnpm test` (44 passing)
- `pnpm typecheck`

Follow-ups (post-merge review):

- Manual code review on the backend PR caught one MAJOR issue: the migration
  added `expires_at` as nullable without backfilling existing rows, so the
  sweep skipped every pre-migration conversation (NULL filter) and the
  feature was silently inert on already-deployed DBs. Fix in the same PR
  backfills `expires_at = updated_at + ttl_days * 86_400` for non-bookmarked
  legacy rows during the migration, with a regression test in `test_db.py`.

Depends on: [01](./01-conversation-lifecycle.md).

## Goal

Give conversations a finite lifetime by default, but let users pin
conversations they want to keep forever. Establish a deterministic per-
conversation scratch directory that downstream features (attachments, tool
outputs) can rely on.

## Why

A long-running personal agent accumulates conversations indefinitely if nothing
ages out, and manual deletion does not scale. The same cleanup signal is also
needed by [Plan 11 (attachments)](./11-attachments.md) so that uploaded files
do not pile up forever.

## Scope

Backend:

- Add `bookmarked` flag and `expires_at` column to conversations.
- Default TTL: 30 days from `updated_at`, configurable via
  `HERMES_CONVERSATION_TTL_DAYS`.
- Bookmarked conversations have `expires_at = NULL` and never expire.
- Add `POST /api/conversations/{id}/bookmark` (toggle).
- Scheduler job: daily sweep deletes expired conversations.
- Deleting a conversation also deletes its scratch directory.

Frontend:

- Bookmark toggle on each conversation in the sidebar.
- Optional visual hint when a conversation is close to expiring.

Tests:

- TTL sweep removes expired, keeps bookmarked.
- Each new user message extends TTL.
- Toggling bookmark clears/restores `expires_at`.
- Scratch directory is gone after deletion.

## Per-Conversation Scratch Directory

Every conversation owns a scratch directory at
`{HERMES_DATA_DIR}/conversations/{id}/`. It holds:

- attachment uploads (Plan 11)
- temporary tool output files

Anything in there dies with the conversation. Output meant to be permanent must
be moved into the workspace or memory through an explicit action.

## Acceptance Criteria

- New conversations get `expires_at` 30 days in the future.
- Each user message refreshes `updated_at` and recalculates `expires_at`.
- Bookmarked conversations have `expires_at = NULL`.
- Daily sweep deletes expired conversations and their scratch dirs.
- TTL value is configurable per deployment.

## Out Of Scope

- Per-conversation TTL override UI.
- Archival/export before deletion.
- Soft delete / trash.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/repository/conversations.py`
  - `src/hermes/schema.py`
  - `src/hermes/scheduler.py`
  - `src/hermes/routes/api.py`
  - `src/hermes/config.py`
  - `tests/test_api_conversations.py`
- Frontend:
  - `app/components/chat/ConversationList.vue`
  - `app/types/api-generated.ts`
