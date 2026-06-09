# Plan 09: Approval Cards

Status: implemented and merged on 2026-05-27. Cross-repo: backend
([Holzi#39](https://github.com/haexhub/Holzi/pull/39)) + frontend
([holzi-frontend#32](https://github.com/haexhub/holzi-frontend/pull/32)), both
squash-merged. CodeRabbit hit the org review rate limit (out of usage credits),
so per the CR-rate-limit fallback both PRs were self-reviewed before merge — one
genuine issue found and fixed during review (the SSE heartbeat used
`wait_for(queue.get())`, which could drop a concurrently-arriving event;
switched to `asyncio.wait` so the pending getter survives the heartbeat tick).

Verification:

- `uv run pytest tests/test_events.py tests/test_agent.py tests/test_tools_cross_channel.py tests/test_api_chat.py` (backend)
- `uv run pytest` (full backend suite, 416 passed)
- `uv run ruff check src/hermes/events.py src/hermes/agent.py src/hermes/routes/api.py src/hermes/tools/cross_channel.py src/hermes/main.py tests/test_agent.py tests/test_events.py tests/test_api_chat.py tests/test_tools_cross_channel.py`
- `uv run mypy src/hermes`
- `HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_URL=http://127.0.0.1:18082 pnpm run gen:api`
- `pnpm vitest run` (frontend, 95 passed incl. new `tests/components/ApprovalCard.test.ts`)
- `pnpm run typecheck`

Notes on what landed (reuses the Plan 08 SSE envelope — new event type, no
parallel structure):

- Backend: new `approval_required` event in `src/hermes/events.py`; `Tool`
  gains `requires_approval` / `risk_reason`; `run_agent` gains an `on_approval`
  gate that pauses a risky tool, runs it on `allow_once`, or feeds a denied
  `error: ...` tool result back to the LLM on `deny` (gate is skipped when no
  `on_approval` callback is wired, so Signal/MCP are unaffected).
  `cross_channel_send` is the first approval-gated tool (outward-facing Signal
  send). `POST /api/approvals/{approval_id}` resolves an `asyncio.Future` the
  agent task awaits — registry on `app.state.approvals`, same single-worker
  invariant as the cancel registry (Plan 03b). The `/api/chat` SSE generator
  emits a `: ping` heartbeat every 15 s so the connection survives long waits.
- Frontend: `app/components/chat/ApprovalCard.vue` (risk reason, tool name,
  arguments, Erlauben/Ablehnen buttons, decided-state); `useChatStream` gains an
  `onApproval` callback + `resolveApproval()` (POST, treats 404/409 as
  already-resolved); `app/pages/index.vue` tracks `pendingApprovals` and blocks
  on a pending card, disabling buttons after one click (no duplicate submit).

Depends on: [08](./08-tool-call-cards.md) (event taxonomy and card UI pattern).

## Goal

Pause dangerous actions and ask the user for explicit approval from the Web UI.

## Why

As Holzi gains workspace and shell capabilities, safety needs to be built into
the agent loop. Approval cards let the agent remain powerful without silently
performing destructive operations.

## Scope

Backend:

- Define an approval request model.
- Add approval registry or persisted approval table.
- Add endpoint to approve/deny pending actions.
- Teach risky tools to return `approval_required` before execution.
- Resume or fail the agent turn after user decision.

Frontend:

- Add `ApprovalCard.vue`.
- Show requested command/action, risk reason, and arguments.
- Buttons:
  - Allow once
  - Deny
- Stream remains in waiting state while approval is pending.

Tests:

- Backend test for approval-required path.
- Backend test for deny path.
- Frontend test for approval card actions.

## Suggested Endpoint

- `POST /api/approvals/{approval_id}`

Body:

```json
{
  "decision": "allow_once"
}
```

or

```json
{
  "decision": "deny",
  "reason": "Not now"
}
```

## Stream Lifetime And Reconnect

Approvals can take minutes. Idle proxies (Traefik, mobile carriers) close
silent SSE connections quickly, so the stream must actively stay alive and
must be safe to re-attach to:

- Send a comment heartbeat `: ping\n\n` every 15 s while waiting.
- Persist run state via [Plan 03b](./03b-agent-runs-and-observability.md) so a
  reconnect can locate the run by `run_id`.
- Expose `GET /api/runs/{run_id}/stream` to re-attach to an in-flight run; on
  reconnect the server replays the last known status plus pending approval
  events.
- Approval decisions arrive over a separate `POST /api/approvals/{approval_id}`,
  not over the stream. The server resolves an `asyncio.Event`/`Future` which
  the agent runner is awaiting; this works even if the original client has
  reconnected to a different SSE stream.

## Suggested Implementation

1. Start with one approval-aware tool class, ideally shell or destructive file
   operation.
2. Emit SSE event `approval_required` using the envelope from Plan 08.
3. Keep the HTTP stream open with the heartbeat above.
4. Approval endpoint resolves an async event/future in the backend run
   registry; the registry entry is per-process and safe because of the
   single-worker invariant documented in Plan 03b.
5. Agent continues after allow or receives a denied tool result after deny.

## Acceptance Criteria

- Risky action pauses and shows an approval card.
- Allow executes the pending action once.
- Deny returns a denied result to the agent.
- The UI does not allow duplicate approval submissions.
- Expired/unknown approval IDs are handled cleanly.

## Out Of Scope

- Remembered approvals.
- Policy engine.
- Multi-user approval.
- Messenger-based approvals.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/agent.py`
  - `src/hermes/tool_catalog.py`
  - `src/hermes/routes/api.py`
  - `tests/test_api_chat.py`
  - `tests/test_tools_*`
- Frontend:
  - `app/components/chat/ApprovalCard.vue`
  - `app/composables/useChatStream.ts`
  - `app/pages/index.vue`
