# Plan 25-A: Diagnostics + Workspace-Browser onto the `workspaces` table

Status: **Merged 2026-05-31.** Cross-repo
[Holzi#59](https://github.com/haexhub/Holzi/pull/59) +
[holzi-frontend#75](https://github.com/haexhub/holzi-frontend/pull/75).
Direct follow-up to [Plan 25](./25-multi-workspace-crud.md), closing
the two env-driven remnants that the parent plan deliberately
deferred.

**Post-merge note (2026-06-04, Plan 30 Wave 0):** the diagnostics
contract referenced below is the pre-Plan-30 shape. Since Plan 30
the `DiagnosticsCheck` model drops `label` + `message` and emits
`{id, status, code, params}` instead — the FE renders the localized
text from `errors.<code>` against the i18n template. The check-IDs
in this plan (`database`/`llm`/`scheduler`/`workspace`/`sandbox`)
are unchanged. See [Plan 30 §Architecture/Backend](./30-i18n-foundation.md).

Backend (`src/hermes/routes/diagnostics.py`): `_check_workspace` is
now async, takes the engine, reads `workspaces_repo.list_active(db)`.
Empty table → warning with `add one in /settings/workspaces` copy
(no more `HERMES_WORKSPACE_ROOTS` ergonomics in the user-facing
message); ok message uses `display_name` through the existing
`_summarise(..., max_len=48)` helper so a runaway name can't dominate
the row. `db is None` mirrors the other DB checks' "cannot check"
pattern.

Backend (`src/hermes/routes/workspace.py`): `_configured_roots()` is
gone; `_active_root_slugs(db)` reads the table.
`_require_known_root(request, root)` is async + reads the request
state; all 8 callers updated mechanically (the Plan-12 tree/file
endpoints, the Plan-13 write/rename/delete endpoints, and the two
Plan-24 git entry points).
`GET /api/workspace/roots` (kept alive for Plan-12 back-compat)
returns the same `list_active` slug list.

Tests: `tests/test_api_diagnostics.py` rewrote the
"workspace roots configured" + "long workspace list truncates" cases
to seed via `workspaces_repo.create` (`display_name` ordering now
makes the first-three preview deterministic).
`tests/test_api_workspace.py` and `tests/test_api_workspace_git.py`
replaced the `configure_roots(monkeypatch)` fixture with an async
`configure_workspaces` fixture that seeds the DB; per-test engine
gives free cleanup. The "comma + whitespace parser" test
(`configure_roots("ws-1, ws-2 ,,")`) became a plain "two slugs are
visible" test — slug validation now happens in
`workspaces_repo.create` at write time, not in a request-time
parser.

Verification: `pytest tests/test_api_diagnostics.py
tests/test_api_workspace.py tests/test_api_workspace_git.py
tests/test_api_workspaces.py` → 144 passed; full suite → 706 passed;
`ruff check src tests` + `mypy src` both clean. Frontend `pnpm
typecheck` clean + `pnpm vitest run` → 260 passed; `app/types/api-generated.ts`
regen produced a 3-line message-text delta only.

Closes the user-visible regression on `/settings/diagnostics`:
`_check_workspace()` still reads `HERMES_WORKSPACE_ROOTS` even though
Plan 25 made the `workspaces` table the source of truth — so a user
who creates a workspace via `/settings/workspaces` still sees a
"no workspace roots configured" warning until they also poke the env.

Depends on: [25](./25-multi-workspace-crud.md) (`workspaces` table,
`workspaces_repo.list_active`, lifespan backfill from env).

## Goal

Make the `workspaces` DB table the actual source of truth across the
backend. The env stays as the boot-time backfill mechanism that
Plan 25 already established, but nothing reads it at request time
anymore. After this slice, creating a workspace via the UI is
sufficient — no env change, no container restart.

## Why

Two env-driven call sites survived Plan 25:

- [`src/hermes/routes/diagnostics.py:152`](../../../Holzi/src/hermes/routes/diagnostics.py#L152) —
  `_check_workspace()` splits `settings.workspace_roots`, so the
  Subsystem row + the `EmptyChatState` banner (Plan 20-C) keep
  warning even when the table has rows.
- [`src/hermes/routes/workspace.py:271`](../../../Holzi/src/hermes/routes/workspace.py#L271) —
  `_configured_roots()` / `_require_known_root()` (used by the
  Plan 12 read-only browser, the Plan 13 write+git endpoints, and
  the Plan 24 extended-git endpoints). A workspace created via
  Plan 25's `POST /api/workspaces` is invisible to the browser
  panel + every git endpoint until the env is also updated.

Plan 25's "Known follow-ups deliberately deferred" called the
second one out. The diagnostics check wasn't even on the radar at
the time — that's the immediate trigger for this slice.

## Non-Goals

- Removing the `HERMES_WORKSPACE_ROOTS` env. It stays as the
  bootstrap mechanism (lifespan backfill in `main.py`). Plan 25's
  `.env.example` follow-up "mark `HERMES_WORKSPACE_ROOTS` as
  bootstrap-only" stays in scope; actually dropping it is a future
  call once nobody depends on the implicit bootstrap.
- Touching the chat-rail `WorkspacePanel.vue`. Plan 25 already
  moved it onto `GET /api/workspaces`; nothing left to do there.
- Hard-delete of archived workspace directories. Still a
  Plan-25 documented non-goal.
- Surfacing archived workspaces in the diagnostics / browser
  paths. `list_active` excludes them, which is the intended
  behaviour — an archived workspace shouldn't make `/diagnostics`
  green or show up in the file browser.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

- `src/hermes/routes/diagnostics.py`
  - Turn `_check_workspace()` into an `async` function that takes
    the engine and reads `workspaces_repo.list_active(db)`.
  - Wire the new signature into the `api_diagnostics` aggregation
    (which is already `async` and already passes `db` to other
    checks). When `db is None`, mirror the existing
    "cannot check — database not initialised" pattern other DB
    checks already use.
  - Update the warning copy: drop the env-name and point at the
    UI surface. Suggested:
    `"no workspaces configured (add one in /settings/workspaces)"`.
    The ok message uses `display_name` for the preview list
    (truncate via the same length-cap pattern the LLM check uses
    so user-controlled values can't dominate the response).
- `src/hermes/routes/workspace.py`
  - Replace `_configured_roots()` with an async helper that calls
    `workspaces_repo.list_active(db)` and returns the slug list.
  - `_require_known_root(root)` becomes async and takes the
    request (for `app.state.db`). Every call site already runs
    inside an `async def` route, so the await is mechanical.
  - `GET /api/workspace/roots` (still alive for back-compat per
    Plan 25) returns the active slugs from the table.
- Tests
  - `tests/test_api_diagnostics.py` — replace the two
    `monkeypatch.setattr(..., "workspace_roots", ...)` tests with
    DB-seeding via `workspaces_repo.create(app.state.db, ...)`.
    The truncation test now seeds 20 workspace rows and asserts
    the same first-three-+-count message shape.
  - `tests/test_api_workspace.py` — the `configure_roots`
    fixture currently monkey-patches `settings.workspace_roots`.
    Replace it with a `configure_workspaces` fixture that seeds
    via `workspaces_repo` and cleans up via
    `workspaces_repo.archive` (or a direct table delete in the
    teardown — archive leaves a tombstone the next test might
    trip over). Every test that calls `configure_roots("foo")`
    gets a one-line `await configure_workspaces(["foo"])`
    rewrite.
  - `tests/test_api_workspace_git.py` — same `configure_roots`
    fixture rewrite.
  - No new test file. Coverage is purely "the existing tests
    pass against the new source of truth"; the CRUD round-trip
    in `test_api_workspaces.py` already covers the table writer
    side.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

No changes. The diagnostics page reads `/api/diagnostics`, the
EmptyChatState banner reads the same, and the chat-rail
`WorkspacePanel.vue` already moved off the env in Plan 25. After
the backend change the warning disappears automatically.

`pnpm run gen:api` is still required if the diagnostics response
copy changes, since the OpenAPI message wording lives in the
schema. The shape itself doesn't change.

## Suggested Implementation

### 1. Backend — diagnostics

In `src/hermes/routes/diagnostics.py`, replace `_check_workspace`:

```python
from hermes.repository import workspaces as workspaces_repo

# ...

async def _check_workspace(db: AsyncEngine | None) -> DiagnosticsCheck:
    if db is None:
        return DiagnosticsCheck(
            id="workspace",
            label="Workspaces",
            status="error",
            message="cannot check — database not initialised",
        )
    rows = await workspaces_repo.list_active(db)
    if not rows:
        return DiagnosticsCheck(
            id="workspace",
            label="Workspaces",
            status="warning",
            message="no workspaces configured (add one in /settings/workspaces)",
        )
    # `display_name` is user-controlled — same length-cap pattern the
    # LLM check uses. First three + count keeps the line short on big
    # installs.
    preview_names = [_short(r.display_name) for r in rows[:3]]
    suffix = "…" if len(rows) > 3 else ""
    preview = ", ".join(preview_names) + suffix
    return DiagnosticsCheck(
        id="workspace",
        label="Workspaces",
        status="ok",
        message=f"{len(rows)} workspace(s) configured: {preview}",
    )
```

`_short` reuses (or duplicates inline — it's two lines) the
single-line + length-cap helper the LLM check already uses for
`display_name`. The 48-char cap is fine here; the test for "20
workspace rows collapse to a count + first three" still asserts
`first names appear, last name does not, …` exactly like the
existing env version.

Then in `api_diagnostics`:

```python
checks.extend(
    [
        _check_scheduler(request),
        await _check_workspace(db),
        _check_sandbox(request),
    ]
)
```

`_check_sandbox` stays sync — it only inspects
`app.state.sandbox_manager`.

### 2. Backend — workspace browser helpers

In `src/hermes/routes/workspace.py`:

```python
async def _active_root_slugs(db: AsyncEngine) -> list[str]:
    rows = await workspaces_repo.list_active(db)
    return [r.id for r in rows]


async def _require_known_root(request: Request, root: str) -> None:
    db: AsyncEngine = request.app.state.db
    if root not in await _active_root_slugs(db):
        raise HTTPException(status_code=404, detail="unknown workspace root")
```

Each call site (12 in `routes/workspace.py` — `api_workspace_roots`,
`api_workspace_tree`, `api_workspace_file`, the write/rename/delete
endpoints, `api_workspace_git*`, the eleven Plan-24 endpoints) is
already inside an `async def`. The diff is mechanical:

```python
# before
_require_known_root(root)
# after
await _require_known_root(request, root)
```

`GET /api/workspace/roots` (the legacy compat endpoint Plan 25 kept
alive) becomes:

```python
@router.get("/roots")
async def api_workspace_roots(request: Request) -> dict[str, Any]:
    db = request.app.state.db
    return {"roots": [{"id": rid} for rid in await _active_root_slugs(db)]}
```

### 3. Tests — diagnostics

Replace the two existing tests in `tests/test_api_diagnostics.py`:

```python
async def test_diagnostics_with_workspaces_configured(
    client: httpx.AsyncClient,
) -> None:
    from hermes.repository import workspaces as workspaces_repo

    await workspaces_repo.create(
        app.state.db, workspace_id="holzi", display_name="Holzi"
    )
    await workspaces_repo.create(
        app.state.db, workspace_id="hermes", display_name="Hermes"
    )
    response = await client.get("/api/diagnostics", headers=AUTH)
    workspace = _check(response.json(), "workspace")
    assert workspace["status"] == "ok"
    # display_name is what the user sees on /settings/workspaces.
    assert "Holzi" in workspace["message"] or "2" in workspace["message"]
```

And the truncation test:

```python
async def test_diagnostics_truncates_long_workspace_list(
    client: httpx.AsyncClient,
) -> None:
    from hermes.repository import workspaces as workspaces_repo

    for i in range(20):
        await workspaces_repo.create(
            app.state.db,
            workspace_id=f"workspace-{i:02d}",
            display_name=f"Workspace {i:02d}",
        )
    response = await client.get("/api/diagnostics", headers=AUTH)
    msg = _check(response.json(), "workspace")["message"]
    assert "20 workspace(s)" in msg
    assert "Workspace 00" in msg
    assert "Workspace 19" not in msg
    assert "…" in msg
```

The test fixtures already give each test a fresh DB engine — no
explicit cleanup needed for the seeded rows.

### 4. Tests — workspace browser fixtures

Replace `configure_roots` in `tests/test_api_workspace.py` and
`tests/test_api_workspace_git.py`:

```python
@pytest.fixture
def configure_workspaces():
    """Seed the `workspaces` table for the Plan-12/13/24 browser tests."""

    async def _set(slugs: list[str]) -> None:
        for slug in slugs:
            await workspaces_repo.create(
                app.state.db, workspace_id=slug, display_name=slug
            )

    return _set
```

Call-site rewrites are mechanical:
`configure_roots("holzi")` → `await configure_workspaces(["holzi"])`.

The test DB is per-test, so no teardown beyond the existing fixture
lifecycle is needed.

### 5. Bridge — gen:api (optional)

If the diagnostics message wording change is the only schema-level
delta, the regenerated `api-generated.ts` will only differ in the
docstring of `DiagnosticsCheck.message`. Regenerate per
[[reference-gen-api-command]] to keep the frontend file in lock-step,
but no frontend code consumes the message text by string-match.

## Verification (per [[verification-before-completion]])

- Backend
  - `cd /home/haex/Projekte/Holzi && uv run pytest tests/test_api_diagnostics.py tests/test_api_workspace.py tests/test_api_workspace_git.py tests/test_api_workspaces.py -v`
  - `cd /home/haex/Projekte/Holzi && uv run pytest` — full suite
    must stay green; the change is invasive across the
    `routes/workspace.py` call sites.
  - `cd /home/haex/Projekte/Holzi && uv run ruff check src tests && uv run mypy src` — `_require_known_root` is now `async`, mypy
    catches any forgotten `await`.
- Frontend
  - `pnpm typecheck` + `pnpm vitest run`.
- Live (the user's local dev stack is Docker-on-Linux per Plan
  20-B; the sandbox warning still appears, that's fine — this
  plan only fixes the **workspace** check):
  - `make up-local-full`
  - Hit `/settings/workspaces`, create one workspace (e.g.
    `playground` / "Playground").
  - Reload `/settings/diagnostics` → the "Workspaces" row flips
    to OK with `1 workspace(s) configured: Playground`.
  - Open a fresh chat → `EmptyChatState` banner no longer counts
    workspace as a warning (sandbox/messenger may still warn
    independently — those checks are unchanged).
  - Open the chat-rail `WorkspacePanel` → the new workspace
    appears in the root selector without a container restart.

## Out Of Scope

- Removing `HERMES_WORKSPACE_ROOTS` from the config schema.
- Hard-delete of archived workspace directories.
- A migration that auto-archives env-only slugs whose env entry
  was removed. The Plan-25 backfill is one-way insert-only by
  design; cleanup stays manual.
- Reworking the diagnostics aggregator into a single
  parallel-await (everything is fast enough that the sequential
  await of `_check_workspace` doesn't matter).

## Acceptance Criteria

- `/api/diagnostics` reports `workspace.status == "ok"` whenever
  at least one non-archived row exists in `workspaces`, even
  when `HERMES_WORKSPACE_ROOTS` is empty.
- `/api/diagnostics` reports `warning` when the `workspaces`
  table is empty, regardless of env.
- `GET /api/workspace/tree?root=<slug>` (Plan 12) and the
  Plan-13/24 write+git endpoints accept exactly the slugs in
  `workspaces.list_active` — workspaces created via
  `POST /api/workspaces` work immediately; archived workspaces
  return 404.
- `GET /api/workspace/roots` (legacy compat) returns the same
  slug list.
- Plan 25's "Known follow-ups deliberately deferred" first
  bullet can be moved to a "Resolved follow-ups" line on
  Plan 25 pointing at this plan.

## Files Likely Touched

- Holzi backend (`/home/haex/Projekte/Holzi`)
  - `src/hermes/routes/diagnostics.py` — `_check_workspace`
    rewritten + aggregator wiring.
  - `src/hermes/routes/workspace.py` — `_configured_roots` →
    `_active_root_slugs`, `_require_known_root` async, all
    twelve call sites.
  - `src/hermes/schema.py` — comment at the `workspaces` Table
    docstring drops the "still works as a bootstrap" hedge in
    favour of a cleaner "env is bootstrap-only" wording.
  - `tests/test_api_diagnostics.py` — two tests rewritten.
  - `tests/test_api_workspace.py` — `configure_roots` fixture
    replaced.
  - `tests/test_api_workspace_git.py` — `configure_roots`
    fixture replaced.
- Frontend (`/home/haex/Projekte/holzi-frontend`)
  - `app/types/api-generated.ts` — regenerated if
    diagnostics message wording changes.

## After Merge

- Fill `Status:` + `Verification:` block at the top of this file
  with actual commands run + cross-repo PR links (squashed SHAs).
- Update [Plan 25](./25-multi-workspace-crud.md):
  - Move "routes/workspace.py (singular) still derives roots
    from HERMES_WORKSPACE_ROOTS" out of "Known follow-ups
    deliberately deferred" and add a "Resolved follow-ups"
    line pointing at this plan.
- Update [README.md](./README.md) status row — add a 25-A line
  under Plan 25, mirroring the 20-A/20-B/20-C entries.
- `.env.example` — update the `HERMES_WORKSPACE_ROOTS` comment
  to "bootstrap-only; source of truth is the `workspaces`
  table (manage via `/settings/workspaces`)".

PR workflow + CodeRabbit per
[[feedback-coderabbit-workflow]];
push/merge via the haexhub token per
[[reference-git-push-account]].
