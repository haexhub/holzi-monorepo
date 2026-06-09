# Plan 13: Workspace Write Operations And Git Status

Status: implemented and merged on 2026-05-29. Cross-repo: backend
[Holzi#46](https://github.com/haexhub/Holzi/pull/46) and frontend
[holzi-frontend#44](https://github.com/haexhub/holzi-frontend/pull/44)
both merged; CodeRabbit findings on the backend (env-replacement of
`git commit` env vars → switched to `git -c user.name/email=...` flags;
`_git_commit` wraps `_drain_exec` so a sandbox crash mid-commit can't
500 after a successful write; `_stat_entry` normalises missing/`not a
directory` parents into 404/400 instead of raw `SandboxError` →
HTTP 500; `committed` comment on delete clarified) and the in-session
frontend review (save-reload race with root switch; lost conversation
mid-edit; saveNotice vs saveError styling; create flyout on root change;
loadGit `errorDetail`; `commitConvId()` helper; treeError clear on file
click) were addressed before merge. Backend adds `POST/PUT/DELETE
/api/workspace/file`, `POST /api/workspace/rename`,
and `GET /api/workspace/git`; the existing `GET /api/workspace/file` now also
returns `sha256` of the on-disk bytes for the writer's `base_sha`. Every
mutating call routes through the workspace sandbox (`mgr.write_file`,
`exec(["mv"...])`, `exec(["rm"...])`) and is followed by `git add -A` +
`git commit -m "user[conv-N]: <action> <path>"` when the root is a git repo;
non-repo roots succeed with `committed: false` and no commit. base_sha
mismatch returns 409 from the start (the Conflict Card UI itself is deferred
to bind-mount mode per the plan). Binary content (NUL bytes in the request)
is refused 400. Frontend: `WorkspacePanel.vue` gains an edit mode (textarea +
Save/Cancel), a `New file` button with an inline create form, rename + delete
actions on the selected file (delete behind `window.confirm`), a branch +
dirty/clean badge under the root selector, and a "Wähle eine Konversation"
hint when `conversationId` is null (writes are gated by an active chat so
every commit message has an honest author tag). Defaults: directory delete is
out of scope; the Conflict Card UI ships only once bind-mount mode does.

Verification:

- `pytest tests/test_api_workspace.py` — 59 tests green (24 new for Plan 13)
- `pytest` full backend suite — 545 passed
- `pnpm vitest run tests/components/WorkspacePanel.test.ts` — 22 tests green
  (11 new for Plan 13: git badge, edit/save success + 409 conflict, create,
  delete confirm + cancel, conversation-id gating)
- `pnpm vitest run` full frontend suite — 142 passed
- `pnpm typecheck` — green
- `pnpm run gen:api` against the in-session backend regenerated
  `app/types/api-generated.ts`

Depends on: [12](./12-workspace-browser-readonly.md) and
[11b](./11b-sandbox-runtime.md) — writes happen inside the workspace sandbox,
not in the agent container.

## Goal

Extend the workspace panel with safe write operations and Git awareness.

## Why

Once the read-only browser is stable, Holzi can become a real coding/workspace
agent surface. Git status is the safety signal that tells the user what changed.

## Scope

Backend:

- Add file update/create/rename/delete endpoints.
- Add Git status endpoint for configured roots.
- Add branch and dirty-state metadata.
- Require confirmations for destructive operations.

Frontend:

- Add edit mode for text files.
- Add save action.
- Add create/rename/delete actions.
- Show branch and dirty badge.
- Make right panel resizable if feasible in this session.

Tests:

- Backend path traversal and overwrite tests.
- Git status tests using temp repo.
- Frontend save/error state tests if extracted.

## What "Save" Means Here

Conversations never have an explicit save — that is handled by the
server-as-source-of-truth + push-to-clients model. "Save" in this plan refers
to **a workspace file write**, triggered either by the user via the workspace
panel editor or by the agent via a `write_file`-style tool.

## Conflict Detection (Default: Not Needed)

In the default deployment the workspace volume lives inside the workspace
sandbox container (see [Plan 11b](./11b-sandbox-runtime.md)). The agent is the
only writer and writes are single-worker-serialised, so concurrent edits do
not happen and conflict detection is unnecessary.

Concurrent writes are only possible when the user **opts in** to bind-mounting
the workspace volume to a host directory that another tool (e.g. a local IDE)
also writes to. Only then is the following needed:

- Read endpoint returns `content` plus a `sha256` of the on-disk bytes.
- Write endpoint requires the client to pass the `base_sha` it last saw.
- On mismatch the server returns `409 Conflict`.
- The UI surfaces a Conflict Card (same component shape as the approval card
  from Plan 09): Overwrite / Discard my changes / Show diff.

Implement the `base_sha` plumbing from the start — it is cheap. Skip the
Conflict Card UI until bind-mount mode is actually supported.

## Git Commits

Every workspace write produces a git commit on the current branch with a
message in the form:

```text
agent[conv-42]: edit src/foo.py
user[conv-42]: rename README.md
```

No per-conversation branch is created. "Undo all changes from conversation 42"
is a `git revert` over the commits tagged `[conv-42]`. This keeps the git
history flat and avoids worktree gymnastics.

## Suggested Implementation

1. All write operations route through the workspace sandbox container (Plan
   11b). The agent container never writes directly.
2. Keep all write operations inside configured roots.
3. Use atomic write for file updates where possible.
4. Compute and return `sha256` on every read. Accept and verify `base_sha` on
   every write; return 409 on mismatch even in default mode (Conflict Card UI
   only ships once bind-mount mode is supported).
5. For delete, start with files only; directories can come later.
6. Git status:
   - use `git status --porcelain=v1`
   - run with explicit cwd
   - time out quickly
7. Every write produces a commit `agent[conv-<id>]: ...` /
   `user[conv-<id>]: ...` on the current branch.
8. UI should show unsaved changes before allowing file switch.

## Acceptance Criteria

- User can edit and save a text file (write executed in the workspace
  sandbox).
- User can create, rename, and delete files inside allowed roots.
- Saving with a stale `base_sha` returns 409. The Conflict Card UI is required
  only when bind-mount mode is enabled.
- Each save produces a commit tagged with the conversation id.
- Git branch and dirty state are visible.
- Unsafe paths are rejected by backend tests.
- Binary files cannot be edited as text accidentally.

## Out Of Scope

- Git commit/push UI.
- Directory delete.
- Conflict resolution.
- Multi-file batch edits.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/routes/workspace.py`
  - `tests/test_api_workspace.py`
- Frontend:
  - `app/components/panels/WorkspacePanel.vue`
  - `app/pages/index.vue`
