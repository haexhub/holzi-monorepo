# Plan 27: Insights + Logs-Viewer — Usage-Charts und Live-Tail im Control Center

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-05-31.** Cross-repo
[Holzi#57](https://github.com/haexhub/Holzi/pull/57) +
[holzi-frontend#72](https://github.com/haexhub/holzi-frontend/pull/72).

Backend: `GET /api/insights?period=24h|7d|30d` aggregates `agent_runs`
(totals + daily UTC buckets zero-filled + per-model + per-status) via
new `runs.aggregate_*` helpers; `GET /api/logs?tail=&min_level=` tails
the rotating structlog file `HERMES_LOG_FILE` (503 when unset) with a
defensive secret-key redaction pass (same regex applied at write- and
read-time). Logging gained a `_redaction_processor` + `RotatingFileHandler`
sibling to the existing stdout stream. 7d/30d SQL cutoff is anchored
to the same UTC midnight as the rendered series labels — a row on the
oldest partial UTC day would otherwise count in totals/by_model/by_status
while being absent from the rendered chart; 24h stays a rolling window
straddling two UTC days. `_raw` text-fallback lines run through a
companion `redact_secrets_in_text()` regex so a stdlib record like
`Bearer sk-xxx` (uvicorn / httpx / MCP startup) can't leak through the
JSON-key matcher. `tests/test_api_insights.py` (9 cases) +
`tests/test_api_logs.py` (12 cases) cover empty windows, period
validation, tail/level caps, redaction (incl. nested + inline), and
the malformed-line `_raw` fallback.

Frontend: new `/settings/insights` and `/settings/logs` pages plus
`settingsNav` entries and `app/lib/pricing.ts` (static per-model rate
table, verified against provider pricing pages 2026-05-31 — Claude 4.x
Opus at $5/$25 not $15/$75, GPT-4o at $2.50/$10 not $5/$15, Gemini 1.5
Pro at the ≤128k $1.25/$5 tier). Model-id lookup falls back through a
`normalisedModelId()` helper that strips trailing `-YYYYMMDD` snapshot
suffixes so a versioned id still matches the short-alias entry. The
Insights page renders KPI tiles + a Tailwind-only bar chart + sortable
per-model table — sort `<th>`s are now real `<button>`s inside the
cells with `aria-sort`, keyboard-accessible — plus status counts;
auto-refresh every 60 s while visible. The Logs page tails with
severity / tail-size / substring filters, copy-all, wrap toggle, and
auto-refresh every 5 s; malformed `_raw` rows render their content
exactly once (`rowDetails()` drops `_raw` from the destructure).
`role="group"` + `aria-label` on the toggle button strips and
`aria-label` on the search input close the a11y gaps. New tests in
`tests/components/InsightsPage.test.ts` (10 cases) and
`tests/components/LogsPage.test.ts` (12 cases): auto-refresh tick
(60s/5s) advanced via `vi.advanceTimersByTimeAsync`, max=0 bar chart
renders without NaN/Infinity, copy-all-after-search writes only the
filtered rows, `_raw`-no-duplication regression guard.

Verification: backend `pytest` → 705 passed; frontend `pnpm vitest
run` → 260 passed; `pnpm typecheck` clean. Live smoke against a real
backend (port 18083, `HERMES_LOG_FILE` set) confirmed insights returns
honest zero-filled buckets, logs surfaced real `hermes_starting` /
`agent_task_scheduler_started` rows plus a `_raw`-wrapped non-JSON MCP
log line, and 400 / 401 / 503 paths all fire as specified.

Review trail: CodeRabbit initially rate-limited on both PRs. A backend
self-review agent (`general-purpose`) overstepped its mandate and
pushed two follow-up fix commits — rotation-knob `Field(gt=0)`,
`h.close()` before `removeHandler()`, the 7d/30d SQL-anchoring,
inline `_raw` text scrub — kept as valid improvements; lesson
recorded in the `reference-code-review-subagent` memory: **use
`Explore` (read-only) for review agents, not `general-purpose`**, so
an agent literally cannot edit or commit. A later CodeRabbit pass on
the frontend web-fact-checked three stale pricing rates (Opus 4.x
moved from $15/$75 → $5/$25, GPT-4o → $2.50/$10, Gemini 1.5 Pro →
$1.25/$5); two nitpicks about German error fallbacks were declined —
`'Fehler beim Laden.'` is the existing convention in 4 other
composables (`useDiagnostics`, `useTasks`).

Cross-repo. Backend adds two read-only endpoints; frontend adds two pages.

Depends on: [03b](./03b-agent-runs-and-observability.md) (agent_runs table
already carries `input_tokens`, `output_tokens`, `model`, `status`,
`error_code`), [14](./14-control-center-shell.md) (Control Center shell +
nav).

## Goal

Surface two operational signals that the user can read at a glance:

1. **Insights** — daily token usage, cost estimate, per-model split, error
   rate. One page, read-only, no provider-specific calls.
2. **Logs** — tailing the agent's structlog output, with a severity filter
   and a copy-all button. One page, read-only, no shell into the container
   needed.

Both replace nothing today (no placeholder) but slot naturally into the
Control Center after Plan 14 / 20.

## Why

- The `agent_runs` table has carried token usage since Plan 03b but
  nothing surfaces it. A user running Holzi for a week has no idea what
  they spent.
- Diagnosing a misbehaving tool today means running `make logs` or
  `journalctl` from a shell. That's fine for an operator but breaks the
  "personal agent hub" angle for non-CLI usage.
- Both are pure read paths — risk is low, ROI is high.

## Non-Goals

- Stripping the existing `/api/diagnostics` of its "letzte Fehlläufe"
  section. That stays — it's the focused recent-failures surface; this
  plan adds aggregates, not a replacement.
- Cost-tracking with live provider pricing. We approximate with
  per-model rate constants in a `app/lib/pricing.ts` table; users can
  override via env. Pulling live prices is out of scope (no provider
  has a stable price API and our values stale slowly).
- A query language for logs. The viewer is a tail with severity filter
  + substring search.
- A persistent log store (Loki / OpenObserve / etc). We tail what
  structlog wrote to disk; rotation is the operator's concern.
- Per-conversation token charts (Plan 28b if we want it; the data is
  there).
- Streaming live updates (push). Both endpoints are polled.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

**Insights endpoint:**

- `GET /api/insights?period=24h|7d|30d&group_by=day|model` →
  ```json
  {
    "period": "7d",
    "totals": { "input_tokens": 123, "output_tokens": 456, "runs": 12, "errors": 1 },
    "series": [
      { "bucket": "2026-05-24", "input_tokens": …, "output_tokens": …, "runs": … },
      …
    ],
    "by_model": [
      { "model": "claude-opus-4-7", "runs": 8, "input_tokens": …, "output_tokens": …, "errors": 0 },
      …
    ],
    "by_status": { "success": 11, "error": 1, "cancelled": 0, "running": 0 }
  }
  ```
- Pure SQL over `agent_runs`: `GROUP BY date(started_at)` and `GROUP BY
  model`. Period buckets to UTC days; the FE renders user-tz.
- Auth-gated (Bearer), same as everything else.

**Logs endpoint:**

- `GET /api/logs?tail=200&min_level=info|warning|error` → newest-last list
  of structlog rows.
- Reads from a known log file path. Today `src/hermes/logging.py` only
  configures structlog's `JSONRenderer` on stdout via `PrintLoggerFactory`
  (no file, no env toggle), so this plan **adds**:
  - `HERMES_LOG_FILE` config field (default `None`; when set, a rotating
    file handler is attached). Default in docker-compose.yml:
    `/var/log/hermes/agent.log`.
  - A `RotatingFileHandler` (or `TimedRotatingFileHandler`) wired into
    `configure_logging()` next to the existing stdout handler — stdout
    stays so `podman logs` still works.
  - Rows are already JSON (structlog `JSONRenderer` is the last
    processor), so no extra format toggle is needed.
- If `HERMES_LOG_FILE` is unset, the endpoint returns 503 with a hint.
- Cap `tail` at 1000.
- Endpoint parses safely and returns one decoded object per line
  (malformed lines pass through as `{ "_raw": "…" }`).
- Auth-gated; **never** returns environment dumps or secret values. Today
  structlog has **no** key-redaction processor, so this plan adds:
  - A redaction processor in `configure_logging()` that scrubs values for
    keys matching `^(api[_-]?key|token|password|secret|authorization)$`
    (case-insensitive), applied before `JSONRenderer`.
  - A second defensive redaction layer on the `/api/logs` response
    (same regex) so even pre-existing log rows are scrubbed on read.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- New nav entries in `app/lib/settingsNav.ts`: `insights` and `logs`.
  Drop the `upcoming` flag on both so they show as real (none today —
  they're new entries).
- New `app/pages/settings/insights.vue`:
  - Period selector (24h / 7d / 30d).
  - Top: 4 KPI tiles (total runs, total tokens, total errors, cost
    estimate).
  - Middle: simple bar chart for daily tokens (no chart library — pure
    Tailwind `<div>` heights).
  - Bottom: per-model table with sortable columns.
  - Auto-refresh every 60s.
- New `app/pages/settings/logs.vue`:
  - Severity filter (info / warning / error).
  - Substring search.
  - Tail count selector (100 / 500 / 1000).
  - Auto-refresh every 5s when the page is visible (use
    `useIntersectionObserver` or `document.visibilityState`).
  - Copy-all button (`navigator.clipboard.writeText(json.stringify(rows))`).
  - Line-wrap toggle.
- `app/lib/pricing.ts` *(new)* — static `model → { input_per_1m, output_per_1m }`
  table for the few providers we use. Cost = `tokens × rate / 1e6`.

### Tests

Backend:

- `tests/test_insights.py` — period bucketing, group-by-day, group-by-model,
  status counts, empty windows.
- `tests/test_logs.py` — reads a fixture file, applies min_level filter,
  caps tail, redacts a secret-looking key, gracefully handles missing file.

Frontend:

- `tests/pages/insights.test.ts` — renders KPI tiles, period swap calls
  the API with the new query, sorted by-model table.
- `tests/pages/logs.test.ts` — filter changes refetch, copy-all writes to
  the clipboard mock, missing-log-file 503 shows a friendly empty state.

## Suggested Implementation

### 1. Backend insights

- Add a small helper `_bucket(start, end, group_by)` that builds the
  list of buckets (we always return zero-rows for empty buckets so the
  chart looks honest).
- `pytest tests/test_insights.py -v` first.

### 2. Backend logs

- Define a `LogRow` Pydantic-ish dict shape.
- Tail using a bounded `deque` reader (read last N lines from the file
  without slurping the whole file — `os.SEEK_END` walk back).
- Redaction layer: after JSON parse, walk the dict and replace any
  matching key's value with `"<redacted>"`.

### 3. Frontend — keep it small

- No chart library. Bar chart is a `<div class="flex items-end">` of
  `<div :style="{ height: pct + '%' }">` siblings; tooltip is a `title`
  attribute. Spending the bundle budget on a chart lib for one page is
  not worth it ([[feedback-ui-polish-over-bundle]] notwithstanding —
  *polish* here is restraint).
- Pricing table lives in a TS file, not env; users can override by
  editing it. Add a comment with the source URL (Anthropic/OpenAI
  pricing pages) and a `// last verified: YYYY-MM-DD` line.

### 4. Verification

- Backend: `pytest tests/test_insights.py tests/test_logs.py -v` + suite.
- `pnpm run gen:api`.
- `pnpm vitest run` + `pnpm typecheck`.
- Live (`make up-local-full`):
  - Open `/settings/insights`. Switch periods; tiles + chart update.
  - Run a handful of messages with different models if multiple credentials
    are configured; per-model table populates.
  - Open `/settings/logs`. Trigger a 401 (call `/api/ping` with a bad
    token) and watch the entry appear. Toggle severity, search for a
    keyword, copy-all.

## Acceptance Criteria

- `GET /api/insights` returns honest aggregates over `agent_runs`.
- `GET /api/logs` returns redacted, JSON-parsed structlog rows with a
  bounded tail.
- `/settings/insights` and `/settings/logs` render the data with simple,
  no-library UI.
- Auto-refresh exists but pauses when the page is not visible.
- Empty / missing-file states are friendly, not blank.

## Out Of Scope

- Live push streaming for logs.
- A query language.
- Per-conversation insights.
- Cost-by-day-of-week / forecasting.
- Provider-side cost APIs (Anthropic / OpenAI).
- Log retention / rotation UI.

## Files Likely Touched

Backend:
- `src/hermes/routes/insights.py` *(new)*
- `src/hermes/routes/logs.py` *(new)*
- `src/hermes/main.py` (router registration)
- `src/hermes/repository/runs.py` (aggregate queries)
- `src/hermes/config.py` (`HERMES_LOG_FILE`)
- `src/hermes/logging.py` (file handler + redaction processor)
- `tests/test_insights.py` *(new)*
- `tests/test_logs.py` *(new)*

Frontend:
- `app/types/api-generated.ts` (regenerated)
- `app/lib/settingsNav.ts`
- `app/pages/settings/insights.vue` *(new)*
- `app/pages/settings/logs.vue` *(new)*
- `app/lib/pricing.ts` *(new)*
- `tests/pages/insights.test.ts`
- `tests/pages/logs.test.ts`

## After Merge

- Status block + README row.
- Update [[project-holzi-control-center]] memory: insights + logs panels
  exist; remaining placeholders are Skills (Plan 28) + Preferences.
- Document `HERMES_LOG_FILE` in `.env.example` with a note that without
  it the logs panel returns 503.
