# Plan 25: Multi-Workspace-CRUD — Workspaces als DB-Row + `/settings/workspaces`

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-05-30.** Cross-repo:
[Holzi#55](https://github.com/haexhub/Holzi/pull/55) +
[holzi-frontend#68](https://github.com/haexhub/holzi-frontend/pull/68).

Verification:

- Backend: new `tests/test_api_workspaces.py` (29 tests, all green);
  full backend suite 642 passed, no regression. Ruff clean.
- Frontend: new `tests/components/SettingsWorkspaces.test.ts` (9
  tests); full vitest suite 224 passed, typecheck green.
- Live curl roundtrip against local uvicorn with
  `HERMES_WORKSPACE_ROOTS="from-env-1,from-env-2,Bad Slug"`:
  env backfill inserted 2/3 (bad slug skipped), POST 201 + duplicate
  409 + bad-slug 400, PATCH rename 200 / 404 for unknown, DELETE
  archive 204 + list excludes archived, `/disk` 404 for unknown,
  `/sandbox/restart` 503 on a sandbox-less host.
- Full UI driving through `make up-local-full` on a Podman host
  still deferred to the haex.cloud box — the disk/git aggregate
  probes against a real workspace sandbox haven't been exercised
  outside the FakeSandboxBackend tests.

Resolved follow-ups:

- `routes/workspace.py` (singular) is now on the table too — closed by
  [Plan 25-A](./25a-workspace-source-of-truth-followups.md).
- The same plan also fixed `routes/diagnostics.py`'s `_check_workspace`,
  which still read the env, so `/settings/diagnostics` no longer warns
  about "no workspace roots" after a UI-create.

Known follow-ups deliberately deferred:

- Hard-delete (rmtree) of archived workspaces is the documented non-goal.

Depends on: [11b-a](./11b-a-sandbox-spine.md), [11b-b](./11b-sandbox-runtime.md)
(sandbox-per-workspace lifecycle), [12](./12-workspace-browser-readonly.md),
[13](./13-workspace-write-git.md), [14](./14-control-center-shell.md)
(`/settings/workspaces` is a Placeholder today).

Cross-repo. This plan replaces today's static `HERMES_WORKSPACE_ROOTS` env
with a DB-driven workspace registry.

## Goal

Make workspaces a first-class managed object: add / rename / remove via UI,
see disk quota + sandbox state per workspace, restart a workspace's sandbox
from one place. Closes the `/settings/workspaces` placeholder.

## Why

- `/settings/workspaces` is one of three Plan 14 placeholders still showing
  the "noch nicht implementiert" stub. Closing it is the most visible "the
  Control Center actually works" win.
- `HERMES_WORKSPACE_ROOTS` is a comma-separated env. Adding a workspace
  today means editing the docker-compose env and restarting the container.
  That's hostile to "personal agent hub" usage where the user wants to
  point Holzi at a new project folder.
- Sandbox state per workspace is hidden behind the in-chat crash card and
  the global diagnostics. A per-workspace row with "Sandbox läuft / down /
  letzter Crash vor X" is what an operator actually wants.

## Non-Goals

- Mounting arbitrary host paths into the sandbox. The sandbox volume model
  from Plan 11b-b stays — workspaces are subdirectories under the configured
  sandbox volume, not arbitrary host bind-mounts. Adding host-side bind
  mounts is a security call and a separate plan.
- Per-workspace agent settings (different model, different toolset, …).
  That overlaps Plan 23's per-conversation overrides. Workspace-level
  agent binding can come later as Plan 25b.
- Sharing workspaces across users. Single-user invariant unchanged.
- Per-workspace git remote configuration UI (push credentials etc.).
- Workspace-templated bootstrap ("clone repo, install deps"). That's a
  task-runner feature (Plan 16 territory if extended).

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

- `src/hermes/schema.py` — new `workspaces` `Table`:
  ```
  id            TEXT PRIMARY KEY  -- stable slug (kebab-case)
  display_name  TEXT NOT NULL
  created_at    INTEGER NOT NULL
  archived_at   INTEGER           -- nullable; soft-delete
  ```
  Path is derived: `${sandbox_volume_root}/${id}` — never user-controlled
  outside the slug. `schema.sql` stays FTS-only; `metadata.create_all()`
  in `init_db()` picks the new table up automatically (same pattern as
  [Plan 21](./21-approval-granularity.md)).
- `src/hermes/repository/workspaces.py` *(new)*: CRUD + list (excluding
  archived by default).
- `src/hermes/routes/workspace.py`:
  - `GET /api/workspaces` → `[{ id, display_name, created_at, sandbox: { state, exit_code? }, disk: { used_mb, quota_mb? }, git: { is_repo, branch?, dirty? } }]`
    The sandbox/disk/git lookups parallel today's `/api/workspace/git`,
    `/api/workspaces/{id}/sandbox`, plus a new disk-usage probe.
  - `POST /api/workspaces` body `{ id, display_name }` →
    creates the sub-directory in the sandbox volume, runs `git init`
    optionally on first edit (lazy — same as today).
  - `PATCH /api/workspaces/{id}` body `{ display_name }` — rename
    display-only; the slug/id never changes.
  - `DELETE /api/workspaces/{id}` — soft-delete (sets `archived_at`).
    Hard-delete (rmtree) is a follow-up; today we tombstone and let the
    user remove the dir manually.
  - `GET /api/workspaces/{id}/disk` → `{ used_mb, quota_mb? }` via
    sandbox `exec(["du", "-sb", "/workspace"])` capped at 1s.
- `src/hermes/routes/api.py` — `GET /api/workspace/roots` (existing,
  read-only) deprecated but kept; new `GET /api/workspaces` replaces it.
- Migration path: existing `HERMES_WORKSPACE_ROOTS` env is read **once**
  at startup; any slug not in the `workspaces` table is auto-inserted as
  `display_name = id`. Env stays as a bootstrap mechanism but the table
  is the source of truth.
- Hot-reload: changing workspaces does not require a restart. The
  `SandboxManager` already lazily creates a sandbox per workspace_id on
  demand.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `app/pages/settings/workspaces.vue` — replace
  `PlaceholderSection` with a real two-pane Control Center page modelled
  on `/settings/memory` and `/settings/tasks`:
  - Left: list of workspaces with status dot (sandbox running / down /
    crashed via Plan 20-A integration), disk usage, dirty-git badge.
  - Right: detail with rename, sandbox restart, archive, disk usage chart
    (simple horizontal bar — no library), open-in-WorkspacePanel link
    (sets the panel root + scrolls to the chat).
  - Top button "Workspace anlegen" opens the Plan 22 prompt-dialog.
- `app/components/panels/WorkspacePanel.vue` — root selector consumes
  `GET /api/workspaces` instead of `GET /api/workspace/roots` (additive —
  the old endpoint stays for compat until removed in a follow-up).

### Tests

Backend (`tests/test_workspaces.py` new):

- CRUD round-trip.
- Slug validation (`^[a-z0-9][a-z0-9-]{1,63}$`, no leading dash, etc.).
- Disk usage probe returns sensible numbers.
- Soft-delete hides from `GET /api/workspaces` but the dir stays.
- Backfill from `HERMES_WORKSPACE_ROOTS` env happens once and is idempotent.

Frontend:

- `tests/components/SettingsWorkspaces.test.ts` — list renders, create
  flow goes through the prompt-dialog, rename + archive call the right
  endpoints, sandbox-restart button hits Plan 11b-b's existing endpoint.

## Suggested Implementation

### 1. Schema + repository + CRUD endpoints

- Define the `workspaces` `Table` in `src/hermes/schema.py`;
  `metadata.create_all()` materialises it on next start. Add a startup-time
  backfill from `HERMES_WORKSPACE_ROOTS` (in `src/hermes/main.py` lifespan).
- Repository is async, sqlalchemy-style same as the rest.

### 2. Status aggregation endpoint

- `GET /api/workspaces` joins:
  - Sandbox state from `SandboxManager.get_status(workspace_id)` (already
    exists, returns absent/running/exited/crashed).
  - Git state via the existing `_is_git_repo` / `GET /api/workspace/git`
    plumbing from Plan 13 (`src/hermes/routes/workspace.py`).
  - Disk usage via a fresh `du -sb` exec (cap 1s, fall back to None).
- Aggregate cap: 16 workspaces is the practical ceiling (we should warn
  in docs); above that consider parallelising. Not in this plan.

### 3. Frontend page

- Reuse the two-pane layout shell from `/settings/memory`.
- Disk-usage bar: pure CSS, `width: clamp(0%, used/quota*100%, 100%)`.
- Sandbox restart button → `POST /api/workspaces/{id}/sandbox/restart`
  (already there from Plan 11b-b).

### 4. Verification

- Backend: `pytest tests/test_workspaces.py -v` + suite.
- `pnpm run gen:api`.
- `pnpm vitest run` + `pnpm typecheck`.
- Live:
  - `make up-local-full`, go to `/settings/workspaces`.
  - Create a workspace "test-a", verify the sub-directory exists in the
    sandbox volume.
  - Rename → display name updates everywhere (including WorkspacePanel).
  - Switch into the new workspace via the WorkspacePanel, write a file
    via the chat, see it back in the workspace list with dirty=true.
  - Restart sandbox → state cycles through stopping/running.
  - Archive → disappears from the list, sandbox manager forgets the handle.

## Acceptance Criteria

- `/settings/workspaces` is no longer a placeholder.
- Workspaces are creatable / renameable / archivable via UI without env
  changes and without container restart.
- Per-workspace sandbox + disk + git status all visible from one page.
- Backfill from `HERMES_WORKSPACE_ROOTS` is idempotent — restarting Holzi
  doesn't duplicate rows.
- WorkspacePanel respects the new endpoint.
- Sandbox crash log (Plan 20-A) cross-links from the workspace's row.

## Out Of Scope

- Hard-delete with rmtree.
- Host-path bind mounts.
- Per-workspace agent profile / model binding.
- Per-workspace git remotes UI.
- Workspace templates / scaffolding.
- Shared workspaces.

## Files Likely Touched

Backend:
- `src/hermes/schema.py`
- `src/hermes/repository/workspaces.py` *(new)*
- `src/hermes/routes/workspace.py`
- `src/hermes/main.py` (startup backfill from env)
- `src/hermes/sandbox/manager.py` (no change expected; verify)
- `tests/test_workspaces.py` *(new)*

Frontend:
- `app/types/api-generated.ts` (regenerated)
- `app/pages/settings/workspaces.vue`
- `app/lib/settingsNav.ts` (drop `upcoming` hint)
- `app/components/panels/WorkspacePanel.vue` (root list source)
- `tests/components/SettingsWorkspaces.test.ts`

## After Merge

- Status block + README row.
- Update [[project-holzi-control-center]] memory: workspaces panel is
  real, Skills + Preferences remain placeholders.
- Update [[project-holzi-workspace-browser]] memory: workspaces are
  CRUD-able via `/settings/workspaces`.
- `.env.example` — mark `HERMES_WORKSPACE_ROOTS` as "bootstrap-only,
  source of truth is the workspaces table".
