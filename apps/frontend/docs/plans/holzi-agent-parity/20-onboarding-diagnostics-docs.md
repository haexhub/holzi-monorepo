# Plan 20: Onboarding, Diagnostics, And Docs

Status: **Diagnostics slice implemented and merged on 2026-05-30.** Cross-repo:
backend [Holzi#50](https://github.com/haexhub/Holzi/pull/50) (squashed as
`8e01959`), frontend
[holzi-frontend#54](https://github.com/haexhub/holzi-frontend/pull/54)
(squashed as `4dab3f1`).

**Docs slice merged 2026-06-04** — backend [Holzi#70](https://github.com/haexhub/Holzi/pull/70):
README quickstart rewritten against current Makefile targets +
`*.localhost` routing + bearer-token paste-into-UI flow,
`docs/providers.md` (per-provider setup for the five `ProviderLiteral`
values), `docs/troubleshooting.md` (11 diagnoses keyed off the
diagnostics endpoint).

`GET /api/diagnostics` returns a redacted snapshot of six subsystem checks
(database, LLM credential, messenger, scheduler, workspace roots, sandbox
runtime) — never echoes the auth token, API key plaintext/ciphertext, master
key, or messenger phone numbers. `/settings/diagnostics` replaces the
placeholder stub with a flat status list + a "Letzte Fehlläufe" panel backed
by `GET /api/runs?status=error`; each failed run can be expanded to reveal
the persisted trace. The `upcoming` hint was dropped from the diagnostics
entry in `app/lib/settingsNav.ts`.

**Resolved follow-ups:**

- ✓ Persistent sandbox-crash log table → [Plan 20-A](./20a-sandbox-crash-log.md) (merged 2026-05-30).
- ✓ Dev-stack docker-agnostic (unblocks 20-A live verify) → [Plan 20-B](./20b-devstack-docker-agnostic.md) (merged 2026-05-30).
- ✓ First-run / onboarding empty state in `EmptyChatState.vue` → [Plan 20-C](./20c-onboarding-empty-state.md) (merged 2026-05-30).

Explicitly **deferred** to follow-up slices (still open):

- **Docs**: README quickstart, troubleshooting doc, model/provider setup
  doc. "Match actual commands" requires cross-checking current Make
  targets + `.env` variables against what shipped after Plans 11b/12/13/
  14/15/16/20/20-A/20-B/20-C — a separate, doc-only slice.
- **Bootstrap/check CLI command** (optional in the plan): skipped since the
  endpoint covers the same observability need.
- **`/api/health`** belongs to [Plan 19](./19-production-hardening.md), not
  here.

Cross-repo (cf. [[feedback-cross-repo-workflow]]):

- Backend tests first (`tests/test_api_diagnostics.py`, 7 cases including
  redaction + degraded paths) — green.
- `src/hermes/routes/diagnostics.py` + router-wire in `src/hermes/main.py`.
- `pnpm run gen:api` regenerated `app/types/api-generated.ts` against the
  new endpoint.
- Frontend: `app/pages/settings/diagnostics.vue` (page), new
  `app/composables/useDiagnostics.ts`, type aliases in `app/types/api.ts`,
  `app/lib/settingsNav.ts` (upcoming hint dropped),
  `tests/components/DiagnosticsPage.test.ts` (5 cases),
  `tests/components/SettingsPlaceholder.test.ts` (shipped-list extended).

Verification (2026-05-30):

- `cd /home/haex/Projekte/Holzi && uv run pytest tests/test_api_diagnostics.py`
  → 7 passed.
- `cd /home/haex/Projekte/Holzi && uv run pytest` → 568 passed, 3 deselected
  (no regression).
- `pnpm typecheck` → no errors.
- `pnpm vitest run` → 183 passed (21 files), including the new diagnostics
  smoke tests.
- Live browser smoke not run in this session — the vitest suite mounts the
  page against the real component tree (lucide icons, Button), so the
  failure modes left uncovered are CSS-only.

Depends on: [03b](./03b-agent-runs-and-observability.md) (run history powers the
Recent Failures panel) and [19](./19-production-hardening.md).

## Goal

Make Holzi easier to set up, troubleshoot, and operate after deployment.

## Why

Hermes WebUI's maturity is not only features; it is also onboarding and
operational clarity. Holzi should provide the same confidence in a smaller,
project-specific way.

## Scope

Backend:

- Add diagnostics endpoint with redacted status:
  - database reachable
  - active LLM credential present
  - active messenger accounts
  - scheduler running
  - workspace roots valid
- Add bootstrap/check command if useful.

Frontend:

- Add first-run/onboarding empty state.
- Add Diagnostics page in Control Center.
- Add a "Recent Failures" panel on Diagnostics backed by
  `GET /api/runs?status=error` from Plan 03b. Each row links to a per-run
  detail view with the persisted error and trace.
- Add copyable environment hints without exposing secrets.

Docs:

- Update README quickstart.
- Add troubleshooting doc.
- Add model/provider setup doc.

Tests:

- Diagnostics endpoint redacts secrets.
- Frontend diagnostics rendering smoke test if feasible.

## Suggested Implementation

1. Backend endpoint: `GET /api/diagnostics`.
2. Return status objects with `ok`, `warning`, `error`, and short messages.
3. Frontend diagnostics page groups checks by area:
   - Auth
   - LLM
   - Messenger
   - Scheduler
   - Workspace
   - Deployment
4. On first run, guide user to:
   - add LLM credential
   - start chat
   - link messenger
5. Write docs from the exact current commands, not aspirational commands.

## Acceptance Criteria

- A new user can see what is missing before first chat.
- Diagnostics page helps identify broken LLM/messenger/setup state.
- No secrets are returned or rendered.
- README and troubleshooting docs match actual commands.

## Out Of Scope

- Full guided setup wizard.
- Automatic secret generation in UI.
- Remote telemetry.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/diagnostics.py`
  - `tests/test_api_diagnostics.py`
  - `README.md`
  - `docs/`
- Frontend:
  - `app/pages/settings/diagnostics.vue`
  - `app/components/chat/EmptyChatState.vue`
  - `README.md`
