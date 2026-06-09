# Plan 15: Memory Panel

Status: implemented on 2026-05-29; merged cross-repo [Holzi#48](https://github.com/haexhub/Holzi/pull/48) + [holzi-frontend#48](https://github.com/haexhub/holzi-frontend/pull/48).

Verification:

- Backend: `uv run pytest tests/test_api_notes.py tests/test_notes.py -q` — 21 passing (incl. 5 new search tests against `/api/notes?q=`). Full suite: `uv run pytest -q` — 552 passing.
- Frontend: `pnpm exec vitest run` — 19 files / 166 tests passing (incl. new `tests/components/MemoryPage.test.ts` with 14 cases covering load, debounced search, create, edit, URL-encoded delete + cancel, two stale-selection corner cases, key field disabled, and error display; existing `SettingsPlaceholder.test.ts` updated to treat `memory` as shipped).
- Frontend: `pnpm exec nuxi typecheck` — clean.
- API types regenerated via `pnpm run gen:api` against the local backend.
- Live smoke against `make up-local-full` via Playwright: empty-state, create with markdown content + tags, read-mode renders headings/lists/code-block + tag chips, edit-mode (key disabled, content + tags pre-filled), cancel returns to read without saving, FTS search hit (`plan`) and no-match (`xyznomatch`) both behave correctly, delete clears the selection. Screenshots not committed.
- Pre-merge review: CodeRabbit (rate-limited on frontend) flagged whitespace-only `?q=` returning `[]` instead of falling through to `list_all`; two parallel general-purpose review agents covered the rest. Resulting fixes shipped in the same PR: `if q and q.strip():` on the route, `cancelEdit` empty-fallback when the active note was filtered out mid-edit, `isCreating` reset in `selectNote`, stale `useApi.ts` doc-comment cleanup.

Notes:

- **Backend**: added optional `q` query parameter to `GET /api/notes`. When set, the route calls `notes.find` (existing FTS5 helper) instead of `list_all`. User input is sanitised by a small `_fts5_query` helper that splits on whitespace, drops non-alphanumeric characters per token, and quotes each surviving token as a phrase — that gives multi-term AND matching without ever exposing FTS5 operator syntax (`"`, `:`, `*`, `(`, `)`, `-`, …) to the UI. An empty query (after sanitisation) returns `[]`. No schema or repository changes — `notes.find` and `notes.upsert` already had everything the panel needs.
- **Frontend**: `app/pages/settings/memory.vue` rebuilt in the **Hermes WebUI memory-panel layout** — a left "Personal memory" sidebar with `+` button + search field + list of notes (key, first-line markdown preview, tag chips, selected-row highlight) and a right main-view that flips between **empty / read / edit** modes. Header buttons mirror Hermes WebUI exactly: Edit/Trash in read mode, Cancel/Save (X / check) in edit mode. Read mode renders the note's content through the existing `RenderedMarkdown` component (shiki code-blocks + KaTeX + mermaid), with tag chips below a divider. Edit mode shows the key as a disabled input (immutable identifier), a tall content textarea, and a comma-tags input. Search debounces 200 ms.
- **Stale-selection guard**: after every reload, if the active `selectedKey` isn't in the new result set (search no-match, deleted-elsewhere, …) the detail pane drops back to the empty-state — caught during Playwright verification, fixed in code + test before merging.
- **`app/lib/settingsNav.ts`** drops the `upcoming` hint from the `memory` entry — exactly the shape Plan 14 documented for future plans.
- **Right-side rail cleanup** (per user request "die todos, reminder bar kann gerne weg"): the conversation page's right aside drops the Todos and Reminders tabs — only Notes + Workspace remain. `TodosPanel.vue` and `RemindersPanel.vue` are deleted, along with their unused `Todo`/`Reminder`/`TodoCreate`/`TodoUpdate`/`ReminderCreate` type aliases in `app/types/api.ts`. Backend `/api/todos` and `/api/reminders` are untouched (still usable as agent tools).
- The `SettingsPlaceholder.test.ts` "shipped" list now includes `/settings/memory`; the placeholder smoke case re-points at `/settings/tasks` (still a placeholder) so the regression remains covered.

Depends on: [14](./14-control-center-shell.md).

## Goal

Make Holzi's memory visible and editable.

## Why

A personal agent that "knows things" must also let the user inspect and correct
that knowledge. This keeps trust high and prevents stale memory from becoming a
hidden liability.

## Scope

Backend:

- Improve notes/memory search API if needed.
- Add update support to the frontend-facing memory path.
- Optionally distinguish memory types:
  - notes
  - user facts
  - project facts

Frontend:

- Add `/settings/memory`.
- Search memory.
- Create/edit/delete memory entries.
- Show tags and timestamps.

Tests:

- Backend memory CRUD/search tests if APIs change.
- Frontend tests for memory composable if extracted.

## Suggested Implementation

1. Start with existing Notes as the first memory surface.
2. Add search query to notes endpoint if not already exposed.
3. Create `useMemory` or `useNotes` composable.
4. Build Memory page with:
   - search
   - list
   - edit drawer/modal or inline editor
   - delete confirmation
5. Keep the right-side Notes panel simple; advanced management lives in Control
   Center.

## Acceptance Criteria

- User can search memory.
- User can edit an existing note/memory entry.
- User can delete stale memory.
- User can create new memory from Control Center.
- Agent-facing notes remain compatible.

## Out Of Scope

- Vector memory.
- Automatic memory extraction UI.
- Memory approval workflow.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/api.py`
  - `src/hermes/repository/notes.py`
  - `tests/test_api_notes.py`
- Frontend:
  - `app/pages/settings/memory.vue`
  - `app/composables/useMemory.ts`
  - `app/components/panels/NotesPanel.vue`
