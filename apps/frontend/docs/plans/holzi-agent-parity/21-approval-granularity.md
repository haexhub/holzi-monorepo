# Plan 21: Approval-Granularität — once / session / always / deny + reason

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-05-30** (cross-repo [Holzi#53](https://github.com/haexhub/Holzi/pull/53) + [holzi-frontend#63](https://github.com/haexhub/holzi-frontend/pull/63)).

Cross-repo branches `plan-21-approval-granularity` (Holzi + holzi-frontend).

Implementation deltas from the plan text:

- The new `tool_approvals` table lives in `src/hermes/schema.py` (SQLAlchemy
  metadata), **not** `src/hermes/schema.sql`. That file is FTS-only;
  regular tables are SQLAlchemy `Table` objects in `schema.py`.
- The four-decision union is centralised as `ApprovalDecisionLiteral` in
  `src/hermes/events.py`; `agent.py` and `routes/api.py` both import it.
- The standing-approval pre-check (`is_always_allowed` + per-conversation
  session set) lives in the `on_approval` wrapper inside `routes/api.py`,
  **not** in `agent.py`. That keeps `agent.py` channel-agnostic so the
  Signal / Telegram workers (no `on_approval` wired) don't accidentally
  read web-side standing state. Agent loop behaviour is unchanged: it
  only branches on `decision.decision == "deny"`.
- The frontend `ApprovalCard.vue` emit changed from `decide: [decision]`
  to `decide: [{decision, reason?}]`. Page handler + tests follow.

## Verification

- Backend: `uv run pytest` — 612 passed (added 22 new tests in
  `tests/test_approvals.py` covering the repository, the 4-decision POST
  body, GET/DELETE standing, and 5 integration paths against `/api/chat`).
  `uv run mypy src` clean. `uv run ruff check src tests/test_approvals.py`
  clean.
- Frontend: `pnpm vitest run` — 199 passed (was 196; 3 new
  `ApprovalCard.test.ts` cases). `pnpm typecheck` clean. `pnpm run gen:api`
  refreshed `app/types/api-generated.ts`.
- Live endpoint shape verified against a worktree uvicorn on
  `127.0.0.1:18083`:
  - `GET /api/approvals/standing` → `{"always":[],"session":[]}`; same
    endpoint without auth → 401.
  - `POST /api/approvals/{id}` with unknown id → 404; unknown
    `decision` literal → 422; `reason` length 501 → 422.
  - `DELETE /api/approvals/standing/foo?scope=always` (missing row) →
    404; `?scope=forever` → 422.
- Full end-to-end "click `Immer erlauben` in a real chat, restart the
  container, watch the second tool call skip the gate" still needs a
  configured `cross_channel_send` target (Signal linked). The behaviour
  is exercised by the integration tests in
  `tests/test_approvals.py::test_chat_skips_approval_when_always_allowed`
  and `::test_chat_allow_always_persists_to_db`.

Depends on: [09](./09-approval-cards.md) (existing approval contract), [11b-b](./11b-sandbox-runtime.md) (only `cross_channel_send` currently sets `requires_approval=True`; sandbox-routed tools may join later).

## Goal

Replace today's two-decision approval flow (`allow_once`, `deny`) with the four
canonical decisions hermes-webui surfaces (`once`, `session`, `always`,
`deny`) plus a free-text `reason`, and add a "skip pending in this run" path so
a noisy batch of approvals doesn't block the user.

## Why

Today the approval card only offers two buttons and the agent has to re-ask on
every tool call. For tools that genuinely do need consent each time
(`cross_channel_send`) this is correct, but the moment we add more
`requires_approval=True` tools (file delete from outside the workspace, network
calls, shell exec) the user will be hammered with the same decision. The four
decisions are well-understood in the agent-tool ecosystem and let the user opt
into incrementally more trust without giving up the binary "ask me always"
default.

`reason` matters because today's `deny` is silent — the agent has no way to
learn *why* a user said no. Even a one-line note ("this would touch prod") in
the tool error helps the model self-correct.

## Non-Goals

- Per-argument approval rules ("allow `read_file` only under `/workspace/foo`").
  Argument-shape policies are a different beast (Plan 27 territory if we ever
  want it); this plan stays at tool-name granularity.
- A separate UI for managing the standing allow-list. The list lives in
  `app.state` (session-scoped) and `agent_settings` (always-scoped); editing
  goes through the approval card itself ("revoke" link on the next ask). A
  dedicated `/settings/approvals` page is a follow-up if the list grows.
- Server-side enforcement of `always` decisions across container restarts of
  *other* tool names. `always` survives restart for the *named* tool only.
- Multi-user shared trust state — same single-user invariant as the rest of
  Holzi.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

- `src/hermes/agent.py` — `ApprovalDecision.decision` is now typed by the
  shared `ApprovalDecisionLiteral` (four values). The agent loop itself does
  **not** read the standing allow-lists; it only branches on
  `decision.decision == "deny"`. Pre-empting on a standing grant happens
  one layer up in the `on_approval` wrapper (see `routes/api.py` below), so
  Signal/Telegram workers — which never wire an `on_approval` — stay
  unchanged.
- `src/hermes/events.py` — adds `ApprovalDecisionLiteral`
  (`Literal["allow_once", "allow_session", "allow_always", "deny"]`) as the
  shared contract for the agent, the HTTP body, and the generated frontend
  types.
- `src/hermes/schema.py` — new `tool_approvals` table
  `{tool_name PRIMARY KEY, granted_at, last_used_at}`. Sessions-scope stays
  purely in-memory on
  `app.state.session_approvals: dict[conversation_id, set[tool_name]]`.
- `src/hermes/repository/approvals.py` *(new)* — `is_always_allowed(name)`,
  `grant_always(name)`, `revoke_always(name)`, `list_always()`.
- `src/hermes/routes/api.py` — the per-`/api/chat` `on_approval` wrapper
  checks the always-list (DB) and the session-list (`app.state`) *before*
  enqueueing an approval future, and writes back the new scope after
  resolution. `POST /api/approvals/{id}` body grows `decision ∈
  {allow_once, allow_session, allow_always, deny}` and a free-text
  `reason?: str` (cap 500 chars, stripped). `deny` with reason persists the
  reason in the tool result error message so the agent sees it.
- New: `GET /api/approvals/standing` → `{always: [{tool, granted_at}], session: [{conversation_id, tool}]}` for a future settings page.
- New: `DELETE /api/approvals/standing/{tool}?scope=always|session` to revoke.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `app/types/api-generated.ts` — regenerate via `pnpm run gen:api` after the
  backend change.
- `app/components/chat/ApprovalCard.vue` — four primary buttons (`Einmal
  erlauben`, `In dieser Session`, `Immer erlauben`, `Ablehnen`), an optional
  `<textarea>` for reason (collapsed by default, expanded by a `Mit Begründung`
  link), submit state per button, error banner. Mobile collapses to a
  `<select>` + reason.
- `app/composables/useChatStream.ts` — `resolveApproval()` signature grows
  `decision` + `reason?`; existing 404/409 no-op handling stays.
- Empty state of the approval card unchanged.

## Suggested Implementation

### 1. Backend tests first (per [[feedback-cross-repo-workflow]])

- `tests/test_approvals.py`:
  - `allow_session` makes the next call to the same tool in the same conversation skip the approval queue.
  - `allow_always` survives a fresh `app.state` (simulate by clearing the dict, re-running).
  - `deny` with `reason` puts the reason into the tool error message the agent receives.
  - Switching conversations does NOT carry session-scope.
  - `DELETE /api/approvals/standing/{tool}?scope=always` removes the row and the next ask re-prompts.
  - Reason cap: 500-char limit, longer payload returns 422.

### 2. Endpoint + schema

- The new `tool_approvals` table is a SQLAlchemy `Table` in
  `src/hermes/schema.py` (Holzi has no Alembic, see
  [[project-holzi-deployment]]); `schema.sql` stays FTS-only. `init_db()`
  picks up the new table automatically via `metadata.create_all()`.
- The standing-approval pre-check lives in the `on_approval` wrapper inside
  `src/hermes/routes/api.py`, **not** in `agent.py`. That keeps
  `agent.py` channel-agnostic — `Signal`/`Telegram` workers don't wire an
  `on_approval` callback, so they bypass the gate as before and never read
  web-side standing state. `agent.py` continues to only branch on
  `decision.decision == "deny"`; the wrapper either returns
  `ApprovalDecision(decision="allow_once")` for a pre-granted tool or, on
  user resolution, promotes `allow_session`/`allow_always` into the right
  store before returning the raw decision. Effectively:

  ```python
  # src/hermes/routes/api.py — inside the per-request on_approval wrapper
  if await approvals_repo.is_always_allowed(db, name):
      return ApprovalDecision(decision="allow_once")
  if name in session_approvals.get(convo.id, set()):
      return ApprovalDecision(decision="allow_once")
  # else: enqueue future + await as today, then on resolve:
  #   allow_session → session_approvals[convo.id].add(name)
  #   allow_always  → approvals_repo.grant_always(db, name)
  ```

- The four-decision union lives in `events.py` next to the SSE envelope so
  frontend and backend share it.

### 3. Frontend

- New tests in `tests/components/ApprovalCard.test.ts`: each of the four
  buttons emits the right decision; reason-textarea round-trips into the
  POST body; submit-state disables all four buttons simultaneously.
- `useChatStream.resolveApproval(approvalId, { decision, reason? })`.
- Visual: four buttons in a `flex-wrap`, primary tint on `allow_*`, destructive
  tint on `deny`. `Immer erlauben` gets an `AlertOctagon` icon to signal
  weight. No new icons beyond lucide-vue-next.

### 4. Verification

Per [[verification-before-completion]]:

- Backend: `pytest tests/test_approvals.py -v` + `pytest` full suite.
- `pnpm run gen:api` per [[reference-gen-api-command]] in the frontend cwd.
- `pnpm vitest run` (no regression in 196-strong suite).
- `pnpm typecheck`.
- Live: `make up-local-full`, configure the OAuth credential, send a message
  that triggers `cross_channel_send`. Verify each of the four buttons behaves
  as advertised:
  - `allow_once` → the next same-tool call re-asks.
  - `allow_session` → the next same-tool call in the same chat does NOT
    re-ask, but switching to a new chat does.
  - `allow_always` → the next same-tool call after restart does NOT re-ask.
  - `deny` with reason → the agent's followup message references the
    reason text.

## Acceptance Criteria

- `POST /api/approvals/{id}` accepts the four decisions + optional reason,
  rejects anything else with 422.
- Session-scope is conversation-scoped (verified by switching chats).
- Always-scope survives restart (verified by `make down-local && make up-local-full`).
- `GET /api/approvals/standing` returns the live state for a future settings page.
- `DELETE /api/approvals/standing/{tool}?scope=…` removes a row and re-prompts.
- Deny reason flows into the tool error so the agent can self-correct.
- Frontend renders four buttons + reason textarea + no `window.confirm`.
- All existing approval tests still pass; new tests cover the four paths.

## Files Likely Touched

Backend:
- `src/hermes/agent.py`
- `src/hermes/events.py`
- `src/hermes/routes/api.py`
- `src/hermes/repository/approvals.py` *(new)*
- `src/hermes/schema.sql`
- `tests/test_approvals.py`

Frontend:
- `app/types/api-generated.ts` (regenerated)
- `app/components/chat/ApprovalCard.vue`
- `app/composables/useChatStream.ts`
- `tests/components/ApprovalCard.test.ts`

## After Merge

Per [[feedback-session-wrapup-ritual]]:

- Status block on this file with squashed SHA.
- Update Plan 09 with a "Granularity extended in Plan 21" note.
- Update [[reference-sse-event-envelope]] memory with the four-decision union.
- Update README "Completed" + drop from "next up".
