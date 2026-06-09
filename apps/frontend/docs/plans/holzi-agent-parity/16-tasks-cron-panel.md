# Plan 16: Tasks And Cron Panel

Status: implemented and merged on 2026-05-29. Cross-repo: backend
[Holzi#49](https://github.com/haexhub/Holzi/pull/49) (squashed as
`2d5b8e7`), frontend
[holzi-frontend#51](https://github.com/haexhub/holzi-frontend/pull/51)
(squashed as `ddb4654`).

**Scope deviation from the original plan.** The plan said "Keep existing
reminders intact" and listed "Existing reminders still work" as an
acceptance criterion. Both were dropped. Investigation showed `reminders`
and `todos` had no user-facing UI left after Plan 15 trimmed the chat
right-rail — they only existed as agent tools (`reminder_set`,
`todo_add`, …). Maintaining a parallel scratch-space concept next to the
new `agent_tasks` would have been pure churn. The reminders + todos
tables, repos, routes (`/api/reminders`, `/api/todos`), and the matching
`Reminder`/`Todo` agent tools were deleted in this plan; the tools were
replaced by `task_create` / `task_list` / `task_delete` operating on the
new `agent_tasks` table. Existing rows in the legacy tables are dropped
on upgrade (bot-internal scratch state, no user data).

Depends on: [14](./14-control-center-shell.md). Scheduled tasks that execute
code must route through the sandbox runtime defined in
[11b](./11b-sandbox-runtime.md) — the scheduler thread lives in the agent
container and must not be killable by a misbehaving task.

## Verification

Backend (cwd `/home/haex/Projekte/Holzi`, branch `plan-16-tasks-cron-panel`):

- `uv pip install croniter` (new dep added to `pyproject.toml`).
- `.venv/bin/python -m pytest --ignore=tests/test_sandbox_podman_integration.py`
  → 554 passed. New tests cover: `agent_tasks` repo (one-shot + cron +
  switch between them + reject invalid cron), `AgentTaskScheduler` (fires
  one-shots and disables them; advances cron `due_at`; records failures
  per-row without blocking sibling rows; `run_now` does not advance cron),
  `/api/tasks` CRUD + `/run`, `task_*` agent tools.
- `.venv/bin/python -m ruff check src/ tests/` → clean.

Frontend (cwd `/home/haex/Projekte/holzi-frontend`, branch
`plan-16-tasks-cron-panel`):

- `pnpm run gen:api` regenerated `app/types/api-generated.ts`
  (TaskCreate/Update/Response/RunResponse added; Todo/Reminder shapes
  gone).
- `pnpm typecheck` → clean.
- `pnpm test` → 174 passed (8 new tests for `settings/tasks.vue`).

## Goal

Manage scheduled and recurring agent tasks from the Web UI.

## Why

An always-on server agent should be able to do work later or repeatedly:
reminders, summaries, checks, syncs, and maintenance tasks. Users need to see
and control those tasks.

## Scope

Backend:

- Add task model if current reminders are too narrow.
- Add CRUD endpoints for scheduled tasks.
- Add pause/resume.
- Add run-now endpoint.
- Store minimal run history.

Frontend:

- Add `/settings/tasks`.
- List tasks.
- Create/edit/pause/delete tasks.
- Run task now.
- Show last run status.

Tests:

- Backend CRUD tests.
- Scheduler tests for due task execution.
- Frontend composable tests if extracted.

## Suggested Model

Fields:

- `id`
- `title`
- `prompt`
- `schedule` or `due_at`
- `timezone`
- `channel`
- `enabled`
- `last_run_at`
- `last_status`
- `created_at`
- `updated_at`

## Suggested Implementation

1. Keep existing reminders intact.
2. Introduce tasks as a separate concept if recurring work is needed.
3. Start with one-shot plus simple cron expression, or one-shot only if the
   session needs to stay smaller.
4. Add run history table only with minimal fields.
5. UI should make pause/resume obvious.

## Acceptance Criteria

- User can create a scheduled task.
- User can pause/resume/delete it.
- User can run it manually.
- Last run status is visible.
- Existing reminders still work.

## Out Of Scope

- Complex calendar UI.
- Multi-step workflows.
- Approval policies for scheduled tasks.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/scheduler.py`
  - `src/hermes/schema.py`
  - `src/hermes/routes/tasks.py`
  - `tests/test_scheduler.py`
  - `tests/test_api_tasks.py`
- Frontend:
  - `app/pages/settings/tasks.vue`
  - `app/composables/useTasks.ts`
