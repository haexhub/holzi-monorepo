Status: Stufe 1 done (sticky session + web UI visibility)

## Cline Configuration

In VS Code, open Cline settings and configure a custom OpenAI-compatible provider:

| Setting | Value |
|---------|-------|
| Base URL | `https://<your-holzi-host>/v1` |
| API Key | your Holzi Bearer token (from `.env` → `AUTH_TOKEN`) |
| Model | any model ID Holzi is configured to use |

Optional headers (set in Cline's "Custom Headers" if supported):

| Header | Value | Effect |
|--------|-------|--------|
| `X-Holzi-Workspace` | project name, e.g. `holzi-frontend` | Isolates the sticky session per project |

Without `X-Holzi-Workspace`, all Cline requests share a single `"default"` session.

---

# Plan 17: Cline/Roo First-Class Channel

Depends on: nothing strictly, but the channel/space mapping it introduces is
referenced by [Plan 18](./18-profiles-spaces-model-routing.md).

## Goal

Make VS Code clients such as Cline/Roo talk to the same Holzi agent core,
memory, and tool system as the Web UI and messengers.

## Why

The original goal is one central agent reachable from everywhere. If
`/v1/chat/completions` is only a proxy, VS Code is bypassing Holzi's memory and
tools. This plan makes coding clients first-class Holzi clients.

## Scope

Backend:

- Route OpenAI-compatible chat requests through the Holzi agent loop.
- Add channel identity such as `cline` or `openai_compat`.
- Map client/workspace/API key to a conversation.
- Preserve compatibility with OpenAI-compatible clients.
- Avoid recursion when Holzi itself calls upstream LLMs.

Frontend:

- Optional: show Cline conversations in conversation list with channel badge.

Tests:

- OpenAI-compatible request creates/continues Holzi conversation.
- Memory/tool path works from `/v1/chat/completions`.
- Recursion guard prevents Holzi from calling itself accidentally.

## Recursion Guard

Holzi itself calls an upstream OpenAI-compatible API. If that upstream is ever
(accidentally or deliberately) Holzi again, the agent loop would call itself
forever. Guard against this on two layers:

- **Path separation**: split the public OpenAI-compatible surface from the
  internal upstream client into distinct modules (`routes/openai_compat.py`
  vs. `upstream/openai.py`). The internal client never goes through the public
  route, even within the same process.
- **Loop-detection header**: outgoing upstream requests carry
  `X-Holzi-Internal: 1`. The public OpenAI-compatible route rejects any inbound
  request that already has this header with `400 Loop Detected`.
- Test the guard explicitly: configure Holzi's upstream to point at its own
  `/v1/chat/completions` and assert the first call returns 400, not a hang.

## Channel And Space Mapping

External OpenAI-compatible clients identify themselves via headers; the server
turns that into a conversation in the right context:

- `X-Holzi-Client`: `cline`, `roo`, `openai_compat`, etc.
- `X-Holzi-Workspace`: free-form workspace key (e.g. project name).
- Optional `X-Holzi-Space`: targets a specific Space if Plan 18 lands.

Mapping rules:

- One conversation per `(client, workspace)` pair by default.
- Without `X-Holzi-Space`, the conversation lands in the default space.
- Cline/Roo conversations must not land in messenger channels (Signal/Telegram)
  by accident — channel is set explicitly from `X-Holzi-Client`, never inferred.

## Suggested Implementation

1. Inspect current `/v1/chat/completions` route.
2. Add explicit internal upstream client path that bypasses public agent route
   (see Recursion Guard above).
3. For external client requests:
   - parse OpenAI messages
   - derive user message
   - map metadata to channel/conversation per the mapping rules above
   - call agent runner
   - stream OpenAI-compatible chunks back
4. Add headers for client identity:
   - `X-Holzi-Client`
   - `X-Holzi-Workspace`
   - `X-Holzi-Space` (optional)
   - `X-Holzi-Internal` (outgoing only, never trusted on inbound)
5. Keep a config flag to temporarily fall back to raw proxy behavior if needed.

## Acceptance Criteria

- Cline can point at Holzi's `/v1/chat/completions`.
- The resulting conversation appears in Holzi history.
- Holzi memory/tools are available to the Cline request.
- Upstream model calls do not recurse into Holzi.
- Existing Web UI chat still works.

## Out Of Scope

- Full Cline UI integration.
- Workspace file sync from VS Code.
- Per-project profiles unless required by mapping.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/chat.py`
  - `src/hermes/agent.py`
  - `src/hermes/upstream.py`
  - `src/hermes/routes/api.py`
  - `tests/test_chat.py`
  - `tests/test_api_chat.py`
- Frontend:
  - `app/components/chat/ConversationList.vue`
