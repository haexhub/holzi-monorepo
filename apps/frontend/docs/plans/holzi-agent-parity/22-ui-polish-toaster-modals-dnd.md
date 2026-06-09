# Plan 22: UI-Politur — Toaster, echte Modals, Drag&Drop für Attachments

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-05-30** (frontend-only [holzi-frontend#62](https://github.com/haexhub/holzi-frontend/pull/62)).

Verification (2026-05-30):

- `pnpm vitest run` — 26 files / 213 tests passing (baseline was 22 / 196;
  +4 new files: `useToast`, `useConfirm`, `usePromptDialog`,
  `AppConfirmHost`; +4 DnD cases in `ChatComposer.test.ts`; existing
  `MemoryPage`/`TasksPage`/`WorkspacePanel` tests rewired from
  `window.confirm`/`stubGlobal('prompt')` to `vi.mock('~/composables/useConfirm')`
  and `vi.mock('~/composables/usePromptDialog')`).
- `pnpm typecheck` — clean.
- `pnpm build` — Nuxt + Nitro both green (2.36 MB total, 457 kB gzip).
- `grep -rn "window.confirm\|window.prompt" app/ tests/` — zero hits.
- Live smoke against `make up-local-full` — **not run in this session**;
  the dev-stack on the host is Docker-only and `pnpm build` plus the unit
  tests covered the moving parts. Behavioural surface (toast on cancel
  failure, confirm-dialog gates every destructive action, rename prompt
  opens with the current path pre-filled, DnD overlay appears on
  drag-over and disappears on drop) is asserted via vitest, not Playwright.

Plan drift vs. spec (caught during execution):

- **Plan said** "Replace `window.confirm` in `pages/index.vue` — conversation
  delete." **Actually** that call lives in `components/chat/ConversationList.vue`.
  Refactored there.
- **Plan said** "`NotesPanel.vue` — note delete." **Actually** `NotesPanel.vue`
  has no `window.confirm` call. Skipped.
- **Plan said** "`pages/settings/tasks.vue` — task delete, run-now confirm,
  pause confirm." **Actually** only the delete confirm exists today; the
  run-now and pause buttons fire without confirmation. Only delete was
  refactored.
- **Plan didn't mention** `pages/settings/messenger.vue`, but its
  `window.confirm` on account removal was caught by the "zero hits"
  acceptance criterion and is refactored too.
- **`pages/index.vue` background-error migration**: only `stopStreaming`'s
  cancel-call failure switched to `toast.error`. The stream-error path in
  `runStream` (which retry also goes through) stays as the inline banner
  because the user is staring at the stream when it fails — that's the
  "in-flight error" case the plan explicitly keeps inline.

Frontend-only. No backend changes.

Depends on: [11](./11-attachments.md) (upload endpoint), [13](./13-workspace-write-git.md)
(currently uses `window.confirm`/`window.prompt`), [15](./15-memory-panel.md)
(memory CRUD also uses `window.confirm`).

## Goal

Replace the three remaining "first-week prototype" UI patterns with the
equivalent shadcn-vue primitives:

1. A global **toaster** (success / error / info) so non-blocking notifications
   stop hijacking inline error slots.
2. **Real confirm / prompt modals** (`AlertDialog` + `Dialog`) replacing every
   `window.confirm` / `window.prompt` call site.
3. **Drag&Drop** dropzone on the chat composer with a `#dropHint`-style
   indicator, so attachments work like every other modern chat UI.

## Why

Per [[feedback-ui-polish-over-bundle]] we value the polished feel over a tiny
bundle. Today:

- Workspace rename uses `window.prompt`, which is dead on iOS Safari, ugly on
  Firefox, and unaffected by the dark theme.
- Workspace delete / Note delete / Conversation delete / Task delete all use
  `window.confirm`, which is the same problem.
- Errors and successes are inline per section — there's no globally visible
  feedback when e.g. `gen:api` succeeds in the background, when an attachment
  finishes uploading, or when a long-running tool returns.
- Attachments only work via the paperclip-picker; drag&drop is the universal
  affordance and its absence makes the composer feel cheap.

All three are FE-only, can ship in one session, and lift the perceived quality
of every existing surface for free.

## Non-Goals

- A global undo/redo stack ("snackbar with undo"). Toasts are non-blocking
  notifications, not transactional undo. We surface success/error and move on.
- Replacing all inline error slots. Section-local errors (chat-stream error,
  composer attachment error) stay where they are; toasts are for *background*
  events that the user can't see in their current viewport.
- A new dependency on a toaster library. shadcn-vue ships `Sonner` and
  `useToast` as ports; we use those, no new deps.
- Custom drag preview ghosts or upload progress bars per file. The single
  global `#dropHint` overlay + the existing optimistic chip rendering are
  enough.
- Drag&drop reorder of conversation list or task list. Out of scope.

## Scope

### Frontend

- **Toaster**:
  - Add shadcn-vue's `Sonner` component (`components/ui/sonner/`).
  - Mount once in `app/app.vue` at the root.
  - New `app/composables/useToast.ts` that re-exports the standard
    `toast.success / toast.error / toast.info / toast.loading / toast.promise`
    API with consistent default options (4s duration, top-right on desktop,
    bottom-center on mobile via `breakpoint` check).
  - Replace `error.value = "..."` in `pages/index.vue` for *background* errors
    (cancel-call failures, retry failures) with `toast.error`. Keep inline
    error banners for *in-flight* errors that the user is currently looking
    at.
- **Modals**:
  - Add `components/ui/dialog/` and `components/ui/alert-dialog/`
    (`AlertDialog{,Action,Cancel,Content,Description,Footer,Header,Title,Trigger}`).
  - New `app/composables/useConfirm.ts`:
    ```ts
    type ConfirmOptions = { title: string; description?: string; confirmLabel?: string; destructive?: boolean }
    function useConfirm(): { confirm: (opts: ConfirmOptions) => Promise<boolean> }
    ```
    Backed by a single root-level `<AppConfirmHost />` component (kept in
    `app/components/AppConfirmHost.vue`) that subscribes to a Pinia/`ref`
    queue. Resolves true/false; renders the destructive variant when
    requested.
  - New `app/composables/usePromptDialog.ts` for the rename-style prompts:
    ```ts
    function usePromptDialog(): { prompt: (opts: { title: string; placeholder?: string; defaultValue?: string; confirmLabel?: string }) => Promise<string | null> }
    ```
  - Replace every `window.confirm` / `window.prompt` call site:
    - `app/pages/index.vue` — conversation delete.
    - `app/components/panels/NotesPanel.vue` — note delete.
    - `app/pages/settings/memory.vue` — note delete.
    - `app/pages/settings/tasks.vue` — task delete, run-now confirm,
      pause confirm.
    - `app/components/panels/WorkspacePanel.vue` — file delete, rename
      (prompt).
- **Drag&Drop**:
  - `app/components/chat/ChatComposer.vue` gains a dropzone:
    - Listen to `dragenter` / `dragleave` / `dragover` / `drop` on the
      composer root.
    - Increment a counter on enter, decrement on leave so child elements
      don't flicker the overlay.
    - Render a `<div class="absolute inset-0 …">` overlay with
      `data-testid="composer-dropzone"` and copy "Dateien hier ablegen".
    - On `drop`, route `e.dataTransfer.files` through the existing
      `attachFiles(files)` path that the paperclip picker already uses.
      Same MIME + size rules, same optimistic chips, same rollback.
    - Disable while a stream is active (matches paperclip-disabled state).
  - Full-window drag (drop anywhere in the chat surface) is the v2; v1
    only lights up the composer to avoid surprising drops on the
    workspace panel.

### Backend

None.

## Suggested Implementation

### 1. Toaster + tests

- `app.vue`:
  ```vue
  <NuxtLayout>
    <NuxtPage />
    <Sonner :rich-colors="true" :close-button="true" />
  </NuxtLayout>
  ```
- `tests/composables/useToast.test.ts`: assert the wrapped API forwards
  to `sonner`'s underlying `toast()` with the expected default options.
- Update existing tests in `tests/index.test.ts` (if any reference
  `error.value`) — none should regress because we ADD toast calls, not
  remove the inline banner.

### 2. Confirm / prompt modals

- `tests/composables/useConfirm.test.ts`: queue resolves to `true` on
  primary-action click, `false` on cancel / esc / outside-click;
  destructive flag toggles the red action.
- `tests/components/AppConfirmHost.test.ts`: renders title + description,
  primary button receives focus on open.
- Refactor checks: every `grep -rn "window.confirm\|window.prompt"
  app/` should return zero hits after this slice.

### 3. Drag&Drop

- `tests/components/ChatComposer.test.ts`: simulate `dragenter` →
  overlay appears (`data-testid="composer-dropzone"` visible);
  `drop` with `DataTransfer.files` triggers the existing
  `emit('attach', files)` (or whatever the v-model is). Disabled state
  hides overlay.

### 4. Verification

Per [[verification-before-completion]]:

- `pnpm vitest run` — full suite green; new tests + zero regressions.
- `pnpm typecheck` — green.
- Live (`make up-local-full`):
  - Toast: trigger a cancel failure (cancel a non-existent run via DevTools fetch) → top-right toast appears with red icon.
  - Confirm: delete a conversation → modal appears, destructive-red Action, esc cancels.
  - Prompt: rename a workspace file → modal text input, Enter confirms, defaultValue prefilled with current name.
  - DnD: drag a `.md` file from the desktop onto the composer → overlay appears, drop adds the chip, send works as today.

## Acceptance Criteria

- Zero `window.confirm` / `window.prompt` references remain in `app/`.
- Toaster mounted once, available via `useToast()` from any composable.
- Drag&drop adds files via the same code path as the paperclip picker
  (same validation, same rollback).
- Tests cover toast wrapper, confirm/prompt composables, and the dropzone.
- Mobile breakpoint flips toaster to bottom-center; manual check on
  DevTools narrow viewport is enough.

## Out Of Scope

- A `Toaster` history panel ("recent notifications").
- Drag&drop on the workspace tree (file upload INTO the workspace) — that's
  a Plan 24/25 follow-up.
- Snackbar undo.
- Confirm dialog that takes a custom checkbox ("don't ask again") — orthogonal
  to Plan 21's standing-allow-list and would conflict with it.

## Files Likely Touched

- `app/app.vue`
- `app/components/ui/sonner/Sonner.vue` *(new)*
- `app/components/ui/dialog/*` *(new)*
- `app/components/ui/alert-dialog/*` *(new)*
- `app/components/AppConfirmHost.vue` *(new)*
- `app/composables/useToast.ts` *(new)*
- `app/composables/useConfirm.ts` *(new)*
- `app/composables/usePromptDialog.ts` *(new)*
- `app/components/chat/ChatComposer.vue`
- `app/components/panels/NotesPanel.vue`
- `app/components/panels/WorkspacePanel.vue`
- `app/pages/index.vue`
- `app/pages/settings/memory.vue`
- `app/pages/settings/tasks.vue`
- Tests: `tests/composables/useToast.test.ts`,
  `tests/composables/useConfirm.test.ts`,
  `tests/components/AppConfirmHost.test.ts`,
  `tests/components/ChatComposer.test.ts`

## After Merge

Per [[feedback-session-wrapup-ritual]]:

- Status block on this file.
- README "Completed" row.
- Memory note: shadcn-vue `Sonner` / `Dialog` / `AlertDialog` are the
  canonical primitives going forward — future plans use the composables,
  not `window.*`.
