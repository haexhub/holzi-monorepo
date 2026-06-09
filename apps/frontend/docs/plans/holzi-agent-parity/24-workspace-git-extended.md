# Plan 24: Workspace-Git Extended — Diff, Stage, Commit-Compose, Branch, Push/Pull

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-05-31** (cross-repo [Holzi#56](https://github.com/haexhub/Holzi/pull/56) + [holzi-frontend#70](https://github.com/haexhub/holzi-frontend/pull/70)).

## Verification

- Backend: 11 new endpoints under `/api/workspace/git/*`
  (`diff`, `branches`, `log`, `checkout`, `stage`, `unstage`, `discard`,
  `commit`, `fetch`, `pull`, `push`), all routed through the workspace
  sandbox via `_drain_exec(["git", …])`. Diff returns `kind: text|binary|none`
  + `summary` from a separate `--numstat` pass and truncates the patch body
  at 256 KiB. Pull conflicts surface as `ok=false` + a file list at HTTP 200
  (not a 4xx). Push/fetch surface remote failures as `ok=false` so the UI
  doesn't have to parse 4xx bodies.
- New `HERMES_WORKSPACE_GIT_DESTRUCTIVE` config gates `/discard` and
  `/checkout` with `force=true`; otherwise 403. Tests cover the gated path
  with and without the flag.
- Backend tests: `tests/test_api_workspace_git.py` adds 34 cases against
  `FakeSandboxBackend` (scripted git stdout + `recorded_execs` assertions
  on the exact argv). Full suite: 676 passed, 3 deselected.
- `ruff` + `mypy` clean.
- Frontend: `pnpm run gen:api` regenerated `app/types/api-generated.ts`
  with the new schemas; `app/types/api.ts` re-exports them under clean
  names (matches Plan 12/13/25 pattern).
- New `app/components/panels/WorkspaceGitTab.vue`:
  - Branch chip = `<select>` of local + remote branches (remote disabled,
    `origin/HEAD` filtered server-side); a special `+ Neuen Branch erstellen…`
    option triggers `usePromptDialog` and POSTs `checkout` with `create:true`.
  - Status section groups porcelain entries into Unstaged / Staged
    (`MM` files appear in both, intentionally) with stage/unstage/discard
    per row.
  - Diff viewer wraps the patch in a ` ```diff ` fence so the existing
    `RenderedMarkdown` + shiki pipeline does the highlighting (Plan 07
    already preloaded the `diff` grammar in `app/utils/markdown.ts`).
  - Commit row: textarea + button that only enables when message + staged
    entries are both present.
  - Remote row: Fetch / Pull / Push / Push --set-upstream, with a stderr
    banner + an inline conflict list when pull reports `ok=false`.
  - Dirty-checkout 409 surfaces as a toast pointing at commit/discard/stash.
  - Destructive 403 surfaces as a toast naming
    `HERMES_WORKSPACE_GIT_DESTRUCTIVE`.
- `WorkspacePanel.vue` got a `Dateien | Git` tab strip; the dirty badge in
  the Files-tab header is now a clickable button that switches to the
  Git tab.
- Frontend tests: `tests/components/WorkspaceGitTab.test.ts` covers the
  happy paths (stage / unstage / select-file / diff render / commit /
  create-branch / pull-conflict) and the 409 + 403 error paths. Vitest
  234 passed, typecheck clean.

### Deferred to follow-ups

- `POST /git/commit-message` (LLM-generated suggestion).
- "Origin ahead N, behind M" indicator — needs an extra `rev-list` call
  and was kept out for simplicity; the Plan-13 dirty/clean badge plus
  the explicit branch chip already cover the "do I need to push?" signal.
- `GET /git/log` is wired on the backend and ships as a Plan-24 endpoint,
  but the Git tab does not yet surface the log list (the plan called it
  out as a separate "Auto-Commit-Verlauf zeigen" affordance — leaving the
  endpoint there means a follow-up plan can add the UI without another
  backend change).
- Live push/pull against a real `git daemon` — backend tests script
  scripted-stderr behaviour through `FakeSandboxBackend` rather than spin
  up a bare remote, on the same grounds as Plans 12/13.

Depends on: [13](./13-workspace-write-git.md) (current Git surface is
auto-commit-on-write + status badge).

Cross-repo. Backend exposes diff + staging + branch + push/pull; frontend
adds a Git tab to the WorkspacePanel.

## Goal

Lift Holzi's workspace from "agent auto-commits, you see the dirty flag" to
a usable dev-flow: see the diff, choose what to stage, write the commit
message (with optional agent-generated suggestion), branch, push, pull.

## Why

Today every file write commits with `user[conv-N]: <action> <path>` and
nothing else is exposed. That works for the agent-edits-flow but breaks
two real cases:

1. **The user inspects what the agent did before pushing.** No diff API
   means the only way is `make exec` into the sandbox or open the file in
   VS Code.
2. **The user wants to branch off, edit, and PR.** Without
   branch-checkout and push, the workflow ends at "files are on disk".

Both have shipped equivalents in hermes-webui (`/api/git/diff`,
`/api/git/branches`, `/api/git/commit-message`,
`/api/git/push|pull|fetch|stage|unstage|discard`) and the sandbox can run
the corresponding `git` commands trivially (Plan 13 already shells out
via `exec(["git", …])`).

## Non-Goals

- Inline merge-conflict resolution UI. If `pull` reports conflicts we
  surface the file list and stop — resolving is a manual editor task.
- Submodule operations.
- LFS, sparse checkouts, worktrees (worktrees are their own future plan
  if we ever want them).
- Tag management.
- Rebase / cherry-pick / interactive history rewriting. Out of scope.
- Credential management for push (the workspace volume already brings
  whatever `~/.ssh` or `.git-credentials` is mounted; we don't add a UI
  for it here).

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

New endpoints, all routing through the workspace sandbox via
`exec(["git", …])` (same path as Plan 13):

- `GET /api/workspace/git/diff?root=&path=&staged=false` →
  `{ kind: "text"|"binary"|"none", patch?: string, summary: { files: int, insertions: int, deletions: int } }`.
  `path` omitted = repo-wide diff. `staged=true` runs `git diff --staged`.
  Binary diffs return `{ kind: "binary", summary }` (no patch body).
- `GET /api/workspace/git/branches?root=` →
  `{ current: string, all: [{ name, is_remote, last_commit_at }] }`.
- `POST /api/workspace/git/checkout` body `{ root, branch, create?: bool }`.
  Refuses if working tree dirty unless `force=true` (returns 409).
- `POST /api/workspace/git/stage` body `{ root, paths: [string] }`.
  Empty list = `git add -A`.
- `POST /api/workspace/git/unstage` body `{ root, paths: [string] }`.
- `POST /api/workspace/git/discard` body `{ root, paths: [string], conversation_id }`.
  **Destructive — gated by an env flag** `HERMES_WORKSPACE_GIT_DESTRUCTIVE=1`
  per hermes-webui's pattern. Without the flag, returns 403.
- `POST /api/workspace/git/commit` body `{ root, message, conversation_id, all?: bool }`.
  Replaces the implicit user-write commits when the user wants to type their own message;
  the auto-commit from Plan 13 still fires for agent-driven writes.
- `POST /api/workspace/git/fetch` body `{ root }`.
- `POST /api/workspace/git/pull` body `{ root }`. Returns
  `{ ok, conflicts: [string] }` on conflict (HTTP 200, ok=false).
- `POST /api/workspace/git/push` body `{ root, set_upstream?: bool }`.
- `GET /api/workspace/git/log?root=&path?&limit=20` →
  `[{ sha, short_sha, author, subject, committed_at }]`.

Optional follow-up (separate plan if it sprawls):
`POST /api/workspace/git/commit-message` → agent-generated commit-message
suggestion. Skipped from this plan because it needs an LLM call and the
auto-commit path already encodes the agent's edit description.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `app/components/panels/WorkspacePanel.vue` — split into tabs at the top:
  `Dateien` (existing tree+preview) and **`Git`** (new).
- New `app/components/panels/WorkspaceGitTab.vue`:
  - Branch chip at the top: clicking opens a dropdown listing branches +
    "Neuen Branch erstellen…" → calls checkout with `create:true`.
  - Status section: list of changed files grouped into Unstaged / Staged
    with stage/unstage/discard buttons per row.
  - Diff viewer: clicking a file shows the patch with a basic syntax
    highlight (re-use shiki from Plan 07 with the `diff` grammar).
  - Commit row: textarea for the message + "Commit" button (uses
    `staged` mode) + "Auto-Commit-Verlauf zeigen" link to `git log`.
  - Footer row: Fetch / Pull / Push buttons. Push shows the upstream
    state ("Origin ahead 2, behind 0").
- Status badge in the file tab (already there) gets a click target →
  switches to the Git tab.

### Tests

- Backend (`tests/test_workspace_git.py` extension):
  - Diff (file-level, repo-level, staged-vs-working).
  - Branches listing + checkout (clean + dirty rejection).
  - Stage/unstage/discard (with and without `HERMES_WORKSPACE_GIT_DESTRUCTIVE`).
  - Commit with explicit message.
  - Fetch/pull/push with a `git daemon` fixture or a bare local repo as
    the remote.
- Frontend:
  - `tests/components/WorkspaceGitTab.test.ts` — covers happy paths and
    the dirty-checkout 409 path.

## Suggested Implementation

### 1. Backend tests first

- Bring up a temp git repo + a bare remote in `tests/fixtures/` so push
  and pull are testable hermetically.
- Test every new endpoint shape end-to-end through the sandbox path.

### 2. Endpoints

- Reuse `exec_text` wrapper from Plan 13's git-commit helper.
- Diff: stream `git diff --no-color --src-prefix=a/ --dst-prefix=b/`,
  cap output at 256 KiB → return `{ truncated: true }` if hit.
- Push/pull: surface stderr verbatim in error.message — the user needs to
  see "permission denied" or "no upstream".

### 3. Frontend

- Tab shell at the top of WorkspacePanel.
- Diff viewer uses `markdown-it`'s code-fence pipeline with the `diff`
  grammar from shiki (already preloaded per Plan 07).
- Commit textarea uses the new ConfirmHost from Plan 22's primitives if
  the message is empty.
- Pull conflict surfaces the file list inline + a one-line "Konflikte
  manuell auflösen" text.

### 4. Verification

- Backend: `pytest tests/test_workspace_git.py -v`.
- `pnpm run gen:api`.
- `pnpm vitest run` + `pnpm typecheck`.
- Live:
  - Edit a file via the agent, see it in Unstaged.
  - Stage it, write a custom message, commit.
  - Switch branches (create new), repeat.
  - Push to a local bare remote (run `git init --bare` in a sibling
    dir, configure as remote, push).

## Acceptance Criteria

- Diff endpoint covers per-file, repo, staged.
- Branch list + checkout + create work; dirty checkout returns 409 with a
  clear message.
- Stage / unstage / discard work; discard is 403 without the destructive
  env flag.
- Custom-message commit path works alongside the existing auto-commit.
- Push / pull / fetch all surface useful error text on failure.
- Pull conflict returns the conflict list and does NOT 500.
- All operations route through the workspace sandbox; the agent host
  never touches the working tree directly.

## Out Of Scope

- Agent-suggested commit messages (LLM call).
- Inline conflict resolution.
- PR creation UI (gh-cli wrapper).
- Submodules, LFS, worktrees, sparse, tags.
- Rebase / cherry-pick.

## Files Likely Touched

Backend:
- `src/hermes/routes/workspace.py`
- `src/hermes/sandbox/manager.py` (if a thin `git_exec` helper is worth extracting)
- `tests/test_workspace_git.py` *(extended)*
- `src/hermes/config.py` (`HERMES_WORKSPACE_GIT_DESTRUCTIVE`)

Frontend:
- `app/types/api-generated.ts` (regenerated)
- `app/components/panels/WorkspacePanel.vue` (tab shell)
- `app/components/panels/WorkspaceGitTab.vue` *(new)*
- `tests/components/WorkspaceGitTab.test.ts`

## After Merge

- Status block + README row.
- Document the `HERMES_WORKSPACE_GIT_DESTRUCTIVE` flag in `.env.example`
  with a one-line warning.
- Update [[project-holzi-workspace-browser]] memory: Plan 24 adds the
  Git tab; Plan 13 supplies the foundation.
