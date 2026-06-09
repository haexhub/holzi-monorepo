# Plan 03b: Agent Runs And Observability

Status: implemented and merged on 2026-05-26. Backend [Holzi#35](https://github.com/haexhub/Holzi/pull/35) (merged); frontend regenerated types + these docs in [holzi-frontend#25](https://github.com/haexhub/holzi-frontend/pull/25) (merged).

Verification:

- `uv run pytest` in `/home/haex/Projekte/Holzi` (368 passing, including 18 in `tests/test_api_runs.py` + 1 streaming-usage test)
- `uv run ruff check`
- backend boot: `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_DB_PATH=$(mktemp --suffix=.db) uv run uvicorn hermes.main:app --host 127.0.0.1 --port 18082 --log-level warning`
- frontend regen: `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_URL=http://127.0.0.1:18082 pnpm run gen:api`
- `pnpm test` (52 passing)
- `pnpm typecheck`

Notes:

- `agent_runs` is the persistent source of truth for chat history; the in-memory cancel registry on `app.state.chat_runs` is now a thin index over rows whose status is still `running`.
- The web, signal, and telegram run paths all flow through `hermes.run_tracker.track_run`, which inserts the row, binds `run_id` / `conversation_id` / `channel` into structlog contextvars for the duration of the run, and finalises status + token counts in `finally`.
- Token usage is best-effort: it is captured from the upstream `usage` block when present (OpenAI emits it only with `stream_options.include_usage`); the columns stay NULL otherwise.
- Conversation FK uses `ON DELETE CASCADE`, so deleting a conversation also removes its run records. Bookmarked conversations preserve theirs.
- `agent_run_events` (full SSE replay) intentionally stayed out of scope, as noted below.
- Two CodeRabbit findings were fixed before merge: (1) the streaming request now sets `stream_options.include_usage=true` when usage metrics are requested, so OpenAI-compatible providers actually emit the terminal usage chunk; (2) `runs.finalize` guards on `status='running'` so a duplicate/concurrent finalize can't clobber a terminal row.
- The "Recent failures" UI panel itself is still deferred to [Plan 20](./20-onboarding-diagnostics-docs.md); this plan only exposes the data and the API.

Depends on: [03](./03-chat-cancel-and-run-state.md).

## Goal

Persist every agent run with status, timing, and failure context so errors are
debuggable after the fact and structured logs correlate across components.

## Why

A 24/7 agent fails. Without persisted run records, debugging means scrolling
container logs. With them, a "Recent failures" panel is one query away and every
log line is correlated by `run_id`. This is also the natural place to make the
single-worker container invariant explicit.

## Scope

Backend:

- Add `agent_runs` table: `id` (run_id), `conversation_id`, `channel`, `model`,
  `started_at`, `finished_at`, `status`, `error_code`, `error_message`,
  `error_trace`, `input_tokens`, `output_tokens`.
- `status` enum: `running`, `success`, `cancelled`, `error`.
- The in-memory cancel registry from [Plan 03](./03-chat-cancel-and-run-state.md)
  becomes a thin index over this table; the table is the source of truth for
  history and the registry is a per-process accelerator for active runs.
- Structured stdout logs (JSON) with `run_id`, `conversation_id`, `channel`,
  `event`, `elapsed_ms`.
- `GET /api/runs?conversation_id=...&status=...&limit=...` for diagnostics.
- Optional behind a flag: `agent_run_events` table for full SSE replay/debug.

Frontend:

- The "Recent failures" panel itself lives in
  [Plan 20](./20-onboarding-diagnostics-docs.md); 03b only exposes the API.

Tests:

- Run row persists with correct status on success/cancel/error.
- Error rows include code, message, and trace.
- Listing endpoint filters by status and conversation and paginates.
- Cancel correctly transitions in-flight runs to `cancelled`.

## Single-Worker Invariant

Each agent runs in a dedicated container with a single worker. The in-memory
cancel event from Plan 03 is safe because there is exactly one process per
agent. Document this assumption in `src/hermes/agent.py` and gate any future
multi-worker mode behind a check that refuses to start.

## Acceptance Criteria

- Every chat run produces exactly one `agent_runs` row, regardless of channel.
- Error runs carry enough context to reproduce locally (model, prompt hash,
  trace).
- Logs are JSON and grep-friendly by `run_id`.
- Listing endpoint paginates and is auth-protected.

## Out Of Scope

- OpenTelemetry integration.
- Per-run trace view inside the chat UI.
- Prometheus metrics export.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/schema.py`
  - `src/hermes/repository/runs.py`
  - `src/hermes/agent.py`
  - `src/hermes/routes/api.py`
  - `src/hermes/logging.py`
  - `tests/test_api_runs.py`
