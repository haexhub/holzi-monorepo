# Plan 23: Composer-Chips — Modell-, Reasoning- und Workspace-Switcher pro Conversation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Planned.**

Depends on: [10](./10-reasoning-and-subagent-cards.md) (per-default-Toggle für
Reasoning), LLM-Credentials API (existing), [13](./13-workspace-write-git.md)
(workspace context for the chip).

Cross-repo: small backend addition for per-conversation overrides.

## Goal

Bring the hermes-webui-style composer chips (Profile / Workspace / Model /
Reasoning / Toolsets) into Holzi as a focused starting set: **Model**,
**Reasoning-Stufe**, and **Workspace**. The user can override these per
conversation without leaving the composer.

## Why

Today:

- Model is global: the activated `llm_credentials` row decides for every chat.
  Wanting "this answer in Opus, that one in Haiku" means jumping to
  `/settings/llm`.
- Reasoning is binary, frontend-only, and stored in localStorage
  (`holzi.showReasoningByDefault`). It controls *visibility*, not *strength*.
  hermes-webui has five levels (none/low/medium/high/max); the underlying
  Anthropic + OpenAI APIs support that distinction.
- Workspace is invisible in the composer. The right-panel WorkspacePanel
  shows the active root, but a user mid-chat has no fast affordance to say
  "operate against root B" without scrolling the right panel.

Surfacing these as chips next to the send button matches the pattern
established by hermes-webui, Claude.ai, ChatGPT custom GPTs, and Cursor — and
it's the single biggest "this feels pro" visual upgrade we can do this week.

## Non-Goals

- Profile / Personality chip. We don't have a profiles concept yet
  (Plan 18 is "supplanted by workspaces"); the strategic call there is
  separate.
- Toolsets chip. Today only `cross_channel_send` is gated; the toolset
  picker would be a UI for one row. Revisit when Plan 21 lands and the
  approval list grows.
- Context-Ring (Token-Indikator). Worthwhile but separate (Plan 28's
  insights slice has the data).
- Mobile bottom-sheet variant. The chips fit on a phone-narrow row as
  icon-only chips with the same dropdowns; out of scope are larger
  mobile-first treatments.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

- `src/hermes/schema.py` — the `conversations` `Table` grows two nullable
  `Column`s: `model TEXT` (override; falls back to the active credential's
  model) and `reasoning_effort TEXT` (`none|low|medium|high|max`; falls back
  to global default). `schema.sql` stays FTS-only (same pattern as
  [Plan 21](./21-approval-granularity.md)).
- `src/hermes/db.py` — extend `_apply_lightweight_migrations()` with two
  guarded `ALTER TABLE conversations ADD COLUMN …` statements so existing
  databases pick up the new columns on next start.
- `src/hermes/routes/api.py` — `PATCH /api/conversations/{id}` (already exists
  for rename) accepts the two new fields; null clears the override.
- `src/hermes/agent.py` / `src/hermes/upstream.py` — when building the
  request, prefer per-conversation override over the credential's model and
  pass the reasoning hint through provider-specific params:
  - Anthropic: `extra_body={"thinking": {"type": "enabled", "budget_tokens": …}}` mapped from the level.
  - OpenAI o*-models: `reasoning_effort: 'low'|'medium'|'high'` (the API supports the trio).
  - Map our 5-level to provider params: `none → omit the parameter entirely`
    (OpenAI rejects unknown values; Anthropic just doesn't add `thinking`),
    `low/medium/high → matched`, `max → high` (OpenAI) or the largest
    `budget_tokens` (Anthropic).
- No new endpoint for the models list — `GET /api/llm/credentials/{id}/models`
  already exists; we just call it from the chip.

### Frontend

- `app/types/api-generated.ts` — regenerate.
- New `app/components/chat/ComposerChip.vue` — generic chip shell
  (`<button>` with icon + label, opens an attached popover; keyboard nav).
- New `app/components/chat/ComposerChipsRow.vue` — orchestrates the three
  chips, sits between the textarea and the send button.
- **Model chip**: opens a popover with a search-bar + per-credential model
  list (lazy-loaded via existing `GET /credentials/{id}/models`).
  Selecting calls `PATCH /api/conversations/{id} { model }`. The label is
  the model id; if no override, label = "Auto" + active credential's
  display name in muted text.
- **Reasoning chip**: 5 buttons in a flat list (`none / low / medium /
  high / max`); selecting calls `PATCH /api/conversations/{id} { reasoning_effort }`.
  Label is the level + a `Brain` icon coloured by level.
- **Workspace chip**: lists `GET /api/workspace/roots`. Selecting *only*
  scrolls the right-panel WorkspacePanel to that root and persists the
  selection per conversation (localStorage `holzi.conv.{id}.workspace`).
  This chip is *display-only* — it doesn't change agent behaviour today,
  because tools route via `HERMES_WORKSPACE_ROOTS` not via conversation
  state. (Backend-level workspace-per-conversation is Plan 25 territory.)
- Move the existing Reasoning toggle (Brain icon in chat header) into the
  new Reasoning chip. The localStorage default-toggle stays separately for
  `card-visibility-on-page-load`, but the *strength* is now in the chip.

### Tests

- `tests/components/ComposerChipsRow.test.ts`:
  - Renders three chips when a conversation is active.
  - Model chip patches `/api/conversations/{id}` and updates the label.
  - Reasoning chip cycles through the 5 levels.
  - Workspace chip emits the change without touching the API.
  - When `conversationId === null`, chips are disabled (no PATCH target).
- `tests/test_conversations.py` (backend):
  - PATCH with `model: "claude-opus-4-7"` persists.
  - PATCH with `model: null` clears the override.
  - PATCH with `reasoning_effort: "max"` persists.
  - PATCH with invalid level → 422.

## Suggested Implementation

### 1. Backend tests + schema

- Add the two `Column`s to the existing `conversations` `Table` in
  `src/hermes/schema.py` (both nullable, no default required); extend
  `_apply_lightweight_migrations()` in `src/hermes/db.py` with two guarded
  `ALTER TABLE conversations ADD COLUMN …` statements for already-deployed
  databases.
- Test the PATCH and the agent-loop path that picks the override.

### 2. Frontend chips

- Build `ComposerChip.vue` as a primitive (popover via reka-ui's
  `Popover`); `ComposerChipsRow.vue` composes three of them.
- Wire `useApi.patch` for the model + reasoning chips, local state for
  workspace.
- Update `ChatComposer.vue` to render `<ComposerChipsRow :conversation-id="…" />`
  between the textarea and the action row.

### 3. Reasoning unification

- The old chat-header brain icon stays as the "default-on-load"
  preference (a UI-only thing). The new chip's value is the live override.
- When a conversation is *created*, the chip's reasoning level defaults to
  the localStorage preference. After the first PATCH, the persisted level
  wins.

### 4. Verification

- Backend: `pytest tests/test_conversations.py -v` + suite.
- `pnpm run gen:api` per [[reference-gen-api-command]].
- `pnpm vitest run` + `pnpm typecheck`.
- Live (`make up-local-full`):
  - Open a chat, click the model chip, pick a different model, send a
    message → run shows the new model in `/api/runs` (Plan 03b).
  - Cycle reasoning none → max, ask "warum?" — the reasoning card
    visibility/depth changes accordingly.
  - Workspace chip changes the WorkspacePanel root, persists across
    refresh.

## Acceptance Criteria

- Per-conversation model + reasoning override persists in DB.
- Chips read live state, PATCH writes back, both round-trip in <250 ms.
- Empty / new chat → chips show "Auto" labels, no API errors.
- Reasoning chip's 5 levels map cleanly to provider params (verified by
  inspecting upstream request body in a unit test on `upstream.py`).
- Workspace chip is purely visual but persists per conversation.

## Out Of Scope

- Tool / toolset chip.
- Profile chip.
- Per-conversation **workspace agent binding** (Plan 25).
- Streaming-token ring around the send button (Plan 28).
- Auxiliary-model routing per slot (Vision/Compression/Search — Plan 18 or
  later).

## Files Likely Touched

Backend:
- `src/hermes/schema.py`
- `src/hermes/db.py` (`_apply_lightweight_migrations`)
- `src/hermes/repository/conversations.py`
- `src/hermes/routes/api.py`
- `src/hermes/agent.py` / `src/hermes/upstream.py`
- `tests/test_conversations.py`

Frontend:
- `app/types/api-generated.ts` (regenerated)
- `app/components/chat/ComposerChip.vue` *(new)*
- `app/components/chat/ComposerChipsRow.vue` *(new)*
- `app/components/chat/ChatComposer.vue`
- `app/composables/useChatStream.ts` (read overrides into the next send)
- `tests/components/ComposerChipsRow.test.ts`

## After Merge

Per [[feedback-session-wrapup-ritual]]:

- Status block.
- README "Completed".
- Update memory: per-conversation overrides exist for `model` +
  `reasoning_effort`.
