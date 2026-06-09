# Plan 08: Tool Call Cards + Event Taxonomy

Status: implemented and merged on 2026-05-27. Cross-repo: backend
([Holzi#38](https://github.com/haexhub/Holzi/pull/38)) + frontend
([holzi-frontend#31](https://github.com/haexhub/holzi-frontend/pull/31)), both
squash-merged. The shared SSE envelope lives in `src/hermes/events.py`
(Pydantic) and is the single source of truth; the SSE `event:` line mirrors the
envelope's `event` field and the `data:` line carries the full
`{event, version, data}` body (wire format confirmed with the user). All
pre-existing events (`session`/`run`/`text`/`done`/`cancelled`/`error`) were
migrated onto the envelope alongside the new `tool_call`/`tool_result` events.
CodeRabbit: backend PR reviewed (two valid "guard malformed JSON" findings fixed
in b408ac4 — reject non-object tool arguments, normalise non-dict `meta_json`);
frontend PR hit the org review rate limit, so per the CR-rate-limit fallback the
changes were self-reviewed before merge (no mirror fix needed — JS
`Object.keys`/`JSON.stringify` don't throw on non-objects and the backend now
guarantees `arguments` is an object).

Depends on: [07](./07-chat-rendering-polish.md) (rendering surface). Establishes
the shared SSE event envelope used by Plans 09 and 10.

Verification:

- Backend (`Holzi/`): `pytest` 403 passing (incl. new `tests/test_events.py`
  and tool-callback / envelope / `tool_call`-metadata tests in
  `test_agent_streaming.py` + `test_api_chat.py`); `ruff` + `mypy` clean.
- Frontend (`holzi-frontend/`): `pnpm test` 91 passing (new
  `tests/components/ToolCallCard.test.ts`, extended `ChatMessage` +
  `useChatStream` suites); `nuxt typecheck` clean. `app/types/api-generated.ts`
  regenerated against the backend — picks up `ChatStreamEnvelope`, the event
  subtypes, and `MessageResponse.tool_call` (`ToolCallView`).

Forward-compat rules (enforced): clients ignore unknown `event` values; adding
optional `data` fields does not bump `version`; removing/changing semantics
does. Backward compatibility with pre-Plan-08 `role:"tool"` rows is preserved —
`meta_json` without `arguments`/`status` defaults to `status:"success"`,
`arguments:{}`.

## Goal

Render tool calls as structured cards instead of plain `tool` text bubbles.

## Why

Tool use is where the agent becomes more than a chatbot. Users need to see what
Holzi did, with which arguments, whether it succeeded, and what result came
back.

## Scope

Backend:

- Add structured tool call metadata to persisted messages or stream events.
- Distinguish at least:
  - tool name
  - call ID
  - arguments
  - status
  - result
  - error
- Keep backward compatibility with existing `role: "tool"` messages.

Frontend:

- Add `ToolCallCard.vue`.
- Render collapsed summary by default.
- Expand to show args/result/error.
- Use status styling: running/success/error.

Tests:

- Backend test for persisted tool call metadata.
- Frontend rendering tests for success and error cards.

## Event Taxonomy

All SSE events share one envelope and live in a single source of truth at
`src/hermes/events.py` (Pydantic). OpenAPI generates the matching TS types.

Envelope:

```json
{
  "event": "tool_call",
  "version": 1,
  "data": { "...": "..." }
}
```

Rules:

- Unknown `event` values are ignored by clients (forward compatibility).
- Adding new optional fields to `data` does **not** bump `version`.
- Removing fields or changing semantics bumps `version`.
- The Pydantic models are the only place that defines event shapes; do not
  hand-write parallel structures in route handlers or frontend code.

Initial event types introduced here:

```json
{
  "event": "tool_call",
  "version": 1,
  "data": {
    "call_id": "call_123",
    "name": "notes.find",
    "arguments": { "query": "project status" },
    "status": "running"
  }
}
```

```json
{
  "event": "tool_result",
  "version": 1,
  "data": {
    "call_id": "call_123",
    "status": "success",
    "result": "..."
  }
}
```

Tests for the taxonomy:

- Parser ignores an unknown event without breaking the chat.
- A persisted conversation can be reconstructed by replaying its event stream.

## Suggested Implementation

1. Inspect how Holzi currently stores tool turns.
2. Add a JSON metadata column only if existing schema cannot represent tool
   calls safely.
3. Emit tool call start/result events during streaming.
4. Frontend stores active tool cards while streaming.
5. After stream completion, reload canonical conversation and render persisted
   cards.

## Acceptance Criteria

- Tool calls are visible as cards during streaming.
- Completed conversations show the same tool cards after reload.
- Long outputs are collapsed and do not break the layout.
- Tool errors are clearly visible.

## Out Of Scope

- Approval flow.
- Shell-specific safety classification.
- Subagent cards.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/agent.py`
  - `src/hermes/routes/api.py`
  - `src/hermes/schema.py`
  - `src/hermes/repository/messages.py`
  - `tests/test_agent_streaming.py`
  - `tests/test_api_chat.py`
- Frontend:
  - `app/components/chat/ChatMessage.vue`
  - `app/components/chat/ToolCallCard.vue`
  - `app/composables/useChatStream.ts`
