# Plan 20-A: Persistent Sandbox-Crash Log Table

Status: **Implemented and merged on 2026-05-30.** Cross-repo: backend
[Holzi#51](https://github.com/haexhub/Holzi/pull/51) (squashed as
`85d1792`), frontend
[holzi-frontend#56](https://github.com/haexhub/holzi-frontend/pull/56)
(squashed as `f852643`).

Closes the [Plan 11b-b](./11b-sandbox-runtime.md) "Known limit": a
workspace sandbox dead-transition now persists in `sandbox_crashes` so
crashes that happen with no chat stream connected survive both the lack
of a live consumer and an agent-container restart. `GET
/api/sandbox/crashes` returns them newest-first with `(crashed_at DESC,
id DESC)` ordering (sub-second collisions still come back in insertion
order); `/settings/diagnostics` renders them as a third section
"Sandbox-Abstürze" between Subsysteme and "Letzte Fehlläufe". The
section renders even when the live sandbox subsystem-check is green —
past crashes still matter.

`state` is intentionally typed as `Literal["crashed", "oom", "removed"]`
on the response model so the regenerated frontend types stay exhaustive
(`CRASH_STATE_LABEL satisfies Record<SandboxCrashState, string>`). The
canonical writer is `_DEAD_STATES` in `sandbox/manager.py`; adding a
state is a five-step cross-system change (manager + route Literal +
gen:api + frontend label map + German display string). The
500-on-schema-drift is the deliberate failure mode — loud, rather than
silently rendering "unknown" in the UI.

Cross-repo flow per [[feedback-cross-repo-workflow]]:

- Backend tests first (`tests/test_sandbox_crashes_repo.py` 6,
  `tests/test_api_sandbox_crashes.py` 8,
  `tests/test_sandbox_crash_persistence.py` 5 including the
  handler-isolation case added during self-review) — green.
- `src/hermes/schema.py` (new `sandbox_crashes` table + index),
  `src/hermes/repository/sandbox_crashes.py`,
  `src/hermes/routes/sandbox.py`, `src/hermes/main.py` (registers
  `persist_crash` **before** `start_health_watcher`).
- `pnpm run gen:api` regenerated `app/types/api-generated.ts` against
  the new endpoint.
- Frontend: `app/types/api.ts` (`SandboxCrash` + `SandboxCrashState`),
  `app/composables/useDiagnostics.ts` (third triplet + extended
  `loadAll`), `app/pages/settings/diagnostics.vue` (new section with
  exhaustive `CRASH_STATE_LABEL`), `tests/components/DiagnosticsPage.test.ts`
  (12 tests total, 5 new for the section).

Self-review note: CodeRabbit was credits-exhausted on both PRs (per
[[feedback-coderabbit-workflow]] credit-exhaustion fallback). Two
parallel general-purpose agents (one per repo) reviewed instead. The
backend review surfaced four worth-addressing non-blockers, all
addressed in `1642021` on the same branch before merge (db-None guard,
`crashed_at` description, cross-system invariant docstring,
handler-isolation test). The frontend review came back "ship it".

Verification (2026-05-30):

- `cd /home/haex/Projekte/Holzi && uv run pytest tests/test_sandbox_crashes_repo.py tests/test_api_sandbox_crashes.py tests/test_sandbox_crash_persistence.py`
  → 19 passed.
- `cd /home/haex/Projekte/Holzi && uv run pytest` → 590 passed, 3
  deselected (no regression).
- `pnpm typecheck` → no errors.
- `pnpm vitest run` → 190 passed (21 files), including the 5 new
  diagnostics-crashes cases.
- **Live verification deferred.** `make up-local-full` blocked on a
  dev-stack bug independent of this slice: the user's host has Docker
  (no Podman locally), but the Makefile defaults to `podman compose`,
  and the `podman-compose 1.5.0` fallback hangs in `epoll_wait`. The
  manager-level test in `test_sandbox_crash_persistence.py` drives the
  real `SandboxManager` against the `FakeSandboxBackend` (incl. OOM,
  restart-refires, handler-isolation) and covers the persistence
  contract end-to-end. Live Podman → DB → API → page coverage is the
  job of a follow-up "Plan 20-B: dev-stack docker-agnostisch" session.

Two of Plan 20's deferred follow-ups remain open: onboarding empty
state in `EmptyChatState.vue` and README/troubleshooting/provider docs.

First of the three follow-up slices left open by [Plan 20](./20-onboarding-diagnostics-docs.md).
Closes the "Known limit" of [Plan 11b-b](./11b-sandbox-runtime.md): a workspace
sandbox crash currently surfaces only through the live `sandbox_crashed` SSE
event on an open chat stream, so a crash that happens while no chat is
connected is silently lost. After this slice, every dead-transition the
health watcher sees is persisted and shows up as a third section
("Sandbox-Abstürze") on `/settings/diagnostics`, between the subsystem list
and "Letzte Fehlläufe".

Depends on:

- [11b-a](./11b-a-sandbox-spine.md) + [11b-b](./11b-sandbox-runtime.md) —
  `SandboxManager` health watcher and `WorkspaceCrash` value type.
- [20](./20-onboarding-diagnostics-docs.md) — `/settings/diagnostics` page and
  the `useDiagnostics` composable layout.

## Goal

Make sandbox crashes survive container restart and discoverability without
an active chat stream, by recording every dead-transition the health watcher
fires into a new `sandbox_crashes` table and surfacing the newest rows on
the Diagnostics page.

## Why

Plan 11b-b deliberately left the health watcher "surface-only" — it emits a
single SSE event on the first dead-transition, never auto-restarts, and
never replays. That is the right shape for *live* signalling, but it means
the failure mode "user is asleep, sandbox dies, Podman host is restarted"
leaves no trace at all. The Diagnostics page now lists failed agent runs;
it should list dead workspaces with the same affordance so an operator can
spot a crash loop that never reached an SSE consumer.

## Non-Goals

- Auto-restart. The watcher stays surface-only — the user still decides
  whether to call `POST /api/workspaces/{id}/restart`. This plan only
  records.
- A dedicated detail page. The crash row is small enough (state, exit code,
  optional last message) that the existing inline expand pattern on
  Diagnostics is sufficient.
- Cross-process replay. Persistence is the durability fix; replay-into-SSE
  is out of scope (live consumers still see the same `sandbox_crashed`
  event in their stream).
- A pruning/TTL policy. Volume is too low to justify it now; revisit if
  the table grows past a few thousand rows in practice.

## Scope

Backend:

- New `sandbox_crashes` table holding one row per (workspace, sandbox)
  dead-transition.
- New `sandbox_crashes` repository (`insert` + `list_recent`) following the
  shape of `repository/runs.py`.
- A persistence crash-handler subscribed in the lifespan boot (alongside
  `start_health_watcher`) so every `WorkspaceCrash` the manager fires lands
  in the DB even when no chat stream is connected. The existing SSE
  handler in `routes/api.py` stays — we add a *second* handler, not
  replace.
- New `GET /api/sandbox/crashes` (auth-gated, newest first, `limit` query
  param defaulting to 20, capped at 100) returning a list of crash rows.

Frontend:

- Composable `useSandboxCrashes` (or a new field on `useDiagnostics`)
  pulling `/api/sandbox/crashes` next to the existing two endpoints.
- Third section on `pages/settings/diagnostics.vue` between
  "Subsysteme" and "Letzte Fehlläufe", titled "Sandbox-Abstürze", reusing
  `formatTimestamp` + the existing row-expand UI for `last_message`.
- The section renders even when the sandbox subsystem-check itself is
  green — past crashes are still worth surfacing.

Tests:

- Backend: migration is idempotent and survives `init_db` re-run;
  repository insert + list round-trip; the persistence handler writes
  through a manager-driven `simulate_crash`; `GET /api/sandbox/crashes`
  smoke (auth, shape, ordering, limit clamp).
- Frontend: component test that mounts `/settings/diagnostics`, verifies
  the new section renders rows, empty state, and that a `/api/sandbox/crashes`
  load error stays scoped to its own section.

Cross-repo workflow per [[feedback-cross-repo-workflow]]: backend tests →
endpoint → gen:api → frontend → frontend tests.

## Suggested Implementation

### 1. Backend — schema

Add a `sandbox_crashes` Table to `src/hermes/schema.py`:

```python
sandbox_crashes = Table(
    "sandbox_crashes",
    metadata,
    Column("id", Integer, primary_key=True),
    # Workspace identifier as seen by the SandboxManager — same value the
    # health watcher and SSE event carry. Not an FK because workspaces
    # are configured via env (HERMES_WORKSPACE_ROOTS), not a DB table.
    Column("workspace_id", Text, nullable=False),
    # Container id of the dead sandbox. Useful for cross-referencing the
    # Podman log on the host; carried through to the API response.
    Column("sandbox_id", Text, nullable=False),
    # Unix epoch seconds when the watcher fired the handler.
    Column("crashed_at", Integer, nullable=False),
    # SandboxState value — 'crashed' | 'oom' | 'removed'. Stored as text so
    # the watcher's enum can evolve without an awkward column rebuild.
    Column("state", Text, nullable=False),
    # Container exit code if Podman exposed one; NULL for OOM / removed
    # transitions where there is no clean exit value.
    Column("exit_code", Integer),
    # Optional short message — Plan 20-A reserves this for a future
    # follow-up that pipes structured context (e.g. last exec failure)
    # through the crash handler. Always NULL for now.
    Column("last_message", Text),
)

Index(
    "sandbox_crashes_crashed_at",
    sandbox_crashes.c.crashed_at.desc(),
)
```

Lightweight migration step in `db.py::_apply_lightweight_migrations` is
*not* needed — the table is brand new and `metadata.create_all()` picks
it up with `CREATE TABLE IF NOT EXISTS`. Re-running `init_db` against an
existing DB stays idempotent.

### 2. Backend — repository

New file `src/hermes/repository/sandbox_crashes.py`, modelled on
`repository/runs.py` (same module-level docstring shape, same `_row_to_*`
private helper, same `engine: AsyncEngine` argument convention):

```python
from dataclasses import dataclass

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncEngine

from hermes.schema import sandbox_crashes as t_sandbox_crashes


@dataclass(frozen=True, slots=True)
class SandboxCrashRecord:
    id: int
    workspace_id: str
    sandbox_id: str
    crashed_at: int
    state: str
    exit_code: int | None
    last_message: str | None


def _row_to_record(row) -> SandboxCrashRecord:
    return SandboxCrashRecord(
        id=row.id,
        workspace_id=row.workspace_id,
        sandbox_id=row.sandbox_id,
        crashed_at=row.crashed_at,
        state=row.state,
        exit_code=row.exit_code,
        last_message=row.last_message,
    )


async def insert(
    engine: AsyncEngine,
    *,
    workspace_id: str,
    sandbox_id: str,
    crashed_at: int,
    state: str,
    exit_code: int | None,
    last_message: str | None = None,
) -> int:
    async with engine.begin() as conn:
        result = await conn.execute(
            t_sandbox_crashes.insert()
            .values(
                workspace_id=workspace_id,
                sandbox_id=sandbox_id,
                crashed_at=crashed_at,
                state=state,
                exit_code=exit_code,
                last_message=last_message,
            )
            .returning(t_sandbox_crashes.c.id)
        )
        row = result.first()
    if row is None:
        raise RuntimeError("INSERT into sandbox_crashes did not yield a rowid")
    return row.id


async def list_recent(
    engine: AsyncEngine, *, limit: int = 20
) -> list[SandboxCrashRecord]:
    """Newest-first listing for the Diagnostics page."""
    if limit <= 0:
        return []
    async with engine.connect() as conn:
        result = await conn.execute(
            select(t_sandbox_crashes)
            .order_by(desc(t_sandbox_crashes.c.crashed_at))
            .limit(limit)
        )
        rows = result.all()
    return [_row_to_record(r) for r in rows]
```

Export the public surface from `repository/__init__.py` the same way
`runs` is exported.

### 3. Backend — persistence handler in lifespan

`src/hermes/main.py`, in the same block that calls
`start_health_watcher()`:

```python
if built is not None:
    app.state.sandbox_manager, app.state.sandbox_backend = built

    async def persist_crash(crash: WorkspaceCrash) -> None:
        """Plan 20-A: record every workspace dead-transition into
        `sandbox_crashes` so a crash that happens with no chat
        connected still surfaces on /settings/diagnostics."""
        try:
            await sandbox_crashes_repo.insert(
                app.state.db,
                workspace_id=crash.workspace_id,
                sandbox_id=crash.sandbox_id,
                crashed_at=int(time.time()),
                state=crash.state.value,
                exit_code=crash.exit_code,
            )
        except Exception as exc:  # noqa: BLE001 — handler isolation
            logger.warning(
                "sandbox_crash_persist_failed",
                workspace_id=crash.workspace_id,
                error=str(exc),
            )

    app.state.sandbox_manager.add_crash_handler(persist_crash)
    await app.state.sandbox_manager.start_health_watcher()
```

Order matters: registering the handler *before* `start_health_watcher`
guarantees the very first watcher tick has the persistence handler
already subscribed. The handler must not raise — the manager's handler
loop logs and continues, but exceptions still pollute the structured
logs.

Don't try to make the per-chat SSE handler in `routes/api.py` go away.
Both handlers stay: the SSE one is for live UI, the persistence one is
for durability. The manager already dedupes per `(workspace_id,
sandbox_id)`, so both handlers fire exactly once per crash.

### 4. Backend — endpoint

New module `src/hermes/routes/sandbox.py` (or extend the existing sandbox
route file if one shows up — check before creating). Pattern modelled on
`routes/diagnostics.py`:

```python
"""GET /api/sandbox/crashes — newest-first sandbox-crash history.

Plan 20-A surface for the persistent `sandbox_crashes` table. Read-only;
the only writer is the lifespan-registered crash handler in main.py.
"""
from typing import Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncEngine

from hermes.repository import sandbox_crashes as repo

router = APIRouter(prefix="/api/sandbox", tags=["sandbox"])


class SandboxCrashResponse(BaseModel):
    id: int
    workspace_id: str
    sandbox_id: str
    crashed_at: int
    state: Literal["crashed", "oom", "removed"]
    exit_code: int | None
    last_message: str | None


@router.get("/crashes", response_model=list[SandboxCrashResponse])
async def api_sandbox_crashes(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
) -> list[SandboxCrashResponse]:
    db: AsyncEngine = request.app.state.db
    rows = await repo.list_recent(db, limit=limit)
    return [
        SandboxCrashResponse(
            id=r.id,
            workspace_id=r.workspace_id,
            sandbox_id=r.sandbox_id,
            crashed_at=r.crashed_at,
            state=r.state,  # type: ignore[arg-type] — DB text constrained at write
            exit_code=r.exit_code,
            last_message=r.last_message,
        )
        for r in rows
    ]
```

Wire it in `main.py` next to the other `app.include_router(...)` calls.

### 5. Backend — tests

New file `tests/test_api_sandbox_crashes.py`:

- `test_sandbox_crashes_requires_auth` — bare GET returns 401.
- `test_sandbox_crashes_empty` — fresh DB returns `[]`.
- `test_sandbox_crashes_orders_newest_first` — insert three rows with
  ascending `crashed_at`, assert the response is in descending order.
- `test_sandbox_crashes_limit_clamped` — `?limit=500` returns at most 100
  rows (or fewer if not enough data); `?limit=0` returns 422 via
  `Query(ge=1)`.
- `test_sandbox_crashes_shape` — each row has the documented keys, no
  extras.

New repository test `tests/test_sandbox_crashes_repo.py` (mirrors
`tests/test_agent_tasks_repo.py` shape) covering `insert` + `list_recent`
round-trip directly against the engine fixture.

Extend `tests/test_sandbox.py` (or create `tests/test_sandbox_crash_persistence.py`
if it grows): drive the manager through `simulate_crash`, run
`check_health_once`, and assert one new `sandbox_crashes` row exists.
Use the existing `conn` engine fixture plus a small adapter that wires
the persistence handler against a `FakeSandboxBackend` — the goal is to
prove the handler/manager edge, not to re-test the watcher itself.

### 6. Bridge — regenerate OpenAPI types

Per [[reference-gen-api-command]]:

```bash
# Terminal 1 — backend on isolated port:
cd /home/haex/Projekte/Holzi && \
  HERMES_AUTH_TOKEN=test-token-for-openapi \
  HERMES_DB_PATH=$(mktemp --suffix=.db) \
  uv run uvicorn hermes.main:app --host 127.0.0.1 --port 18082 --log-level warning

# Terminal 2 — regenerate:
cd /home/haex/Projekte/holzi-frontend && \
  HERMES_AUTH_TOKEN=test-token-for-openapi \
  HERMES_URL=http://127.0.0.1:18082 pnpm run gen:api
```

The generated file lands at `app/types/api-generated.ts`; expect a new
`SandboxCrashResponse` schema entry.

### 7. Frontend — public type alias

In `app/types/api.ts`, add under a new section:

```ts
// --- Sandbox crashes (Plan 20-A) ----------------------------------------
export type SandboxCrash = components['schemas']['SandboxCrashResponse']
```

### 8. Frontend — composable

Extend `app/composables/useDiagnostics.ts` rather than introducing a
parallel composable — the section lives on the same page and reuses the
same loading lifecycle. Add:

```ts
const crashes = ref<SandboxCrash[]>([])
const crashesLoading = ref(false)
const crashesError = ref<string | null>(null)

async function loadCrashes(limit = 20): Promise<void> {
  crashesLoading.value = true
  crashesError.value = null
  try {
    crashes.value = await api.get<SandboxCrash[]>('/api/sandbox/crashes', {
      limit,
    })
  } catch (err: unknown) {
    crashesError.value =
      err instanceof Error ? err.message : 'Fehler beim Laden.'
  } finally {
    crashesLoading.value = false
  }
}

async function loadAll(): Promise<void> {
  await Promise.all([loadDiagnostics(), loadFailures(), loadCrashes()])
}
```

…and surface `crashes / crashesLoading / crashesError / loadCrashes` in
the return value. Keep the per-endpoint `loading`/`error` refs separate
so one failing endpoint doesn't collapse the others — matches the
existing pattern.

### 9. Frontend — page

`app/pages/settings/diagnostics.vue`: insert a new `<section>` between
"Subsysteme" and "Letzte Fehlläufe". Layout mirrors "Letzte Fehlläufe":

- Section header with title + short description.
- Loading / error / empty states wired off the new refs.
- One `<li>` per crash row: workspace_id + state badge (reuse
  `STATUS_BADGE_CLASS` with `state` mapped to ok/warning/error?
  No — crashes are always "error"; render a static destructive badge or
  inline color).
- Show `formatTimestamp(crashed_at)`, `exit_code` (fallback "–"), and
  `last_message` when present.
- No expand-on-click — the row is already small enough.

Add `data-testid` on the section root and per-row IDs (`diagnostics-crash-{id}`)
for the component test, same convention as the failure rows.

Refresh button (`diagnostics-refresh`) keeps calling `loadAll`, which now
also retriggers `loadCrashes` for free.

### 10. Frontend — component test

Extend `tests/components/DiagnosticsPage.test.ts` (or a new
`DiagnosticsCrashes.test.ts` if the existing file grows past comfort).
Add cases:

- Renders an empty state when `/api/sandbox/crashes` returns `[]`.
- Renders one row per crash, in the order the API returned them.
- A `/api/sandbox/crashes` load error stays scoped to its own section
  (subsystem list and failures list still render).
- Refresh button retriggers `/api/sandbox/crashes`.

`setupGet` already handles `/api/diagnostics` and `/api/runs`; extend it
to accept a third bucket for `/api/sandbox/crashes` per
[[reference-component-testing]] — `flushPromises()` is fine here; this
view has no shiki / async-init paths.

## Verification (per [[verification-before-completion]])

Run from the right working directory each time:

- Backend
  - `cd /home/haex/Projekte/Holzi && uv run pytest tests/test_api_sandbox_crashes.py tests/test_sandbox_crashes_repo.py tests/test_sandbox.py -v`
  - `cd /home/haex/Projekte/Holzi && uv run pytest` — full suite, no
    regression.
- Frontend
  - `pnpm typecheck`
  - `pnpm vitest run tests/components/DiagnosticsPage.test.ts`
  - `pnpm vitest run` — full vitest suite.
- Live (per [[reference-docker-local-devstack]])
  - `make up-local-full` — bring up the dev stack with Podman.
  - Trigger a workspace sandbox start (e.g. open the workspace browser
    against a configured root so the manager creates a sandbox).
  - Force a crash (`podman --connection=hermes-rootless kill <id>` or
    similar, depending on how the dev stack exposes the socket).
  - Navigate to `/settings/diagnostics` → the new "Sandbox-Abstürze"
    section shows one entry.
  - `make down-local-full && make up-local-full` (or restart only the
    backend container) → the entry is still there (persistence proven).

## Out Of Scope

- Auto-restart logic, retry policies, or escalation (e.g. alert via
  messenger).
- Cross-process replay of crash events into already-disconnected SSE
  consumers.
- Detail page or per-crash drilldown.
- TTL / pruning policy.
- Test-coverage of the *real* `PodmanSandboxBackend` crash path — the
  manager-level test using `FakeSandboxBackend` is sufficient for this
  slice; the live `make up-local-full` step covers the real backend.

## Acceptance Criteria

- A workspace sandbox dead-transition is recorded in `sandbox_crashes`
  exactly once per `(workspace_id, sandbox_id)` (manager's existing
  dedupe holds).
- `GET /api/sandbox/crashes` returns newest-first JSON with the
  documented shape; auth-gated; `limit` clamped to `[1, 100]`.
- `/settings/diagnostics` shows a "Sandbox-Abstürze" section between the
  subsystem list and "Letzte Fehlläufe"; empty state when the table is
  empty; one row per record otherwise.
- The section renders even when the live sandbox subsystem-check is
  green (past crashes still matter).
- A stack restart (`make down-local-full && make up-local-full`) does
  not wipe the entries.
- Plan 11b-b's "Known limit" can be removed; Plan 20's "deferred"
  bullet for the crash log can be moved to a "Status" line on this
  plan file.

## Files Likely Touched

- Holzi backend (`/home/haex/Projekte/Holzi`)
  - `src/hermes/schema.py` — new `sandbox_crashes` Table + index.
  - `src/hermes/repository/sandbox_crashes.py` — new repository module.
  - `src/hermes/repository/__init__.py` — export.
  - `src/hermes/routes/sandbox.py` — new route module (or extend an
    existing sandbox route file if present).
  - `src/hermes/main.py` — register `persist_crash` handler before
    `start_health_watcher`; wire the new router.
  - `tests/test_api_sandbox_crashes.py` — new.
  - `tests/test_sandbox_crashes_repo.py` — new.
  - `tests/test_sandbox.py` (or `tests/test_sandbox_crash_persistence.py`)
    — manager-level persistence handler test.
- Frontend (`/home/haex/Projekte/holzi-frontend`)
  - `app/types/api-generated.ts` — regenerated via `pnpm run gen:api`.
  - `app/types/api.ts` — new `SandboxCrash` alias.
  - `app/composables/useDiagnostics.ts` — `crashes` triplet +
    `loadCrashes` + extended `loadAll`.
  - `app/pages/settings/diagnostics.vue` — third section.
  - `tests/components/DiagnosticsPage.test.ts` — extended cases.

## After Merge

Per [[feedback-session-wrapup-ritual]]:

- Fill the `Status:` + `Verification:` block at the top of this file
  with the actual commands run and the cross-repo PR links (squashed
  SHAs).
- Update Plan 11b-b: turn the "Known limit (deferred to Plan 20)"
  paragraph into a pointer at this plan as the resolution.
- Update Plan 20: move the "Persistent sandbox-crash log table"
  bullet out of "Deferred to follow-up slices" and add this plan to a
  "Resolved follow-ups" line.
- Update memories:
  - `project_holzi_sandbox_split.md` — drop "Known limit" wording.
  - `project_holzi_diagnostics_panel.md` — note the new section + that
    one of the three open follow-ups is closed.
- Update the roadmap README: drop this plan from "next up", add it to
  the Completed list with PR links.

PR workflow + CodeRabbit per [[feedback-coderabbit-workflow]];
push/merge via the haexhub token per [[reference-git-push-account]].
Per [[feedback-session-scoping]] this is the only slice in the session.
