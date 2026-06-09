# Plan 11: Attachments

Status: implemented and merged on 2026-05-27. Backend
[Holzi#42](https://github.com/haexhub/Holzi/pull/42), frontend
[holzi-frontend#36](https://github.com/haexhub/holzi-frontend/pull/36).
Does **not** depend on Plan 11b (sandbox): attachments only read bytes into
the agent context, they don't execute code.

Verification:

- backend: `uv run pytest` (443 passing; new `tests/test_api_attachments.py`)
  + `uv run ruff check src/hermes/ tests/`
- regen: `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_URL=http://127.0.0.1:18082 pnpm run gen:api`
- frontend: `pnpm test` (114 passing) + `pnpm typecheck`

Implementation notes (where they diverged from the sketch below):

- Text/code/markdown/log files are inlined into the agent context at
  request-build time in `run_agent` (kept out of the stored message
  `content` so the UI bubble stays clean); images + PDF are stored and
  surfaced as chips + metadata only — no provider image inputs yet.
- Limits: 25 MB/file; allowlist = `text/*` + a few textual `application/*`
  + png/jpeg/gif/webp + pdf. On-disk name is an opaque token, so the
  uploaded filename can never influence the path (no traversal).
- Added `POST /api/conversations` (create empty web thread) so the web UI
  can attach to the very first message — uploads are tied to a conversation
  id at upload time.

Depends on: [01b](./01b-conversation-retention-and-bookmarks.md) — uses the
per-conversation scratch directory and the lifecycle/cleanup signal defined
there.

## Goal

Allow users to attach files to web chat messages so Holzi can read and reason
over them.

## Why

Attachments are essential for a useful agent: screenshots, logs, PDFs, small
code snippets, config files, and notes should enter the same central agent
context.

## Scope

Backend:

- Add attachment storage.
- Add upload endpoint.
- Associate attachments with messages or draft chat requests.
- Enforce MIME and size limits.
- Expose attachment metadata in conversation detail.

Frontend:

- Add attachment button to composer.
- Show selected attachments before sending.
- Render attachment chips on messages.
- Support remove-before-send.

Tests:

- Upload auth.
- File size limit.
- MIME/type handling.
- Conversation detail includes attachment metadata.

## Suggested Backend Model

Fields:

- `id`
- `conversation_id`
- `message_id` nullable during staging, or attach only at send time
- `filename`
- `content_type`
- `size`
- `storage_path` or blob reference
- `created_at`

## Storage And Cleanup

Attachments live inside the per-conversation scratch directory introduced in
Plan 01b: `{HERMES_DATA_DIR}/conversations/{conversation_id}/attachments/`.
This makes the cleanup story trivial:

- Deleting a conversation deletes its scratch directory and every attachment in
  it; no orphan-sweeper is needed.
- Conversation TTL expiry transitively removes attachments.
- Anything meant to be permanent must be moved to workspace or memory by an
  explicit action; the chat scratch dir is never the canonical home.

Uploads must therefore be tied to a conversation at the moment of upload (the
caller passes `conversation_id`), not staged into a global pool.

## Suggested Implementation

1. Storage path is the scratch directory above; do not introduce a separate
   global attachment root.
2. Add `POST /api/conversations/{id}/attachments`.
3. Let `/api/chat` accept `attachment_ids`; reject IDs that do not belong to
   the same conversation.
4. Agent runner loads attachment content where safe:
   - text files inline
   - images as provider-supported image inputs later
   - unsupported binary files as metadata only
5. Frontend upload happens before send, then sends IDs with the chat payload.

## Acceptance Criteria

- User can attach at least text/log/markdown files.
- Attachment appears on the sent user message after reload.
- Oversized or unsupported files show a clear error.
- Path traversal and unsafe filenames are not possible.

## Out Of Scope

- IndexedDB staging.
- Large file chunking.
- OCR.
- PDF extraction unless already available in backend dependencies.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/api.py`
  - `src/hermes/schema.py`
  - `src/hermes/repository/attachments.py`
  - `tests/test_api_attachments.py`
- Frontend:
  - `app/components/chat/ChatComposer.vue`
  - `app/components/chat/AttachmentChip.vue`
  - `app/pages/index.vue`
