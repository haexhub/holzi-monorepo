# Plan 11b: Sandbox Runtime

Status: implemented and merged on 2026-05-28. Cross-repo: backend
[Holzi#44](https://github.com/haexhub/Holzi/pull/44) (read_file/write_file in
`SandboxBackend` + Podman + Fake, WorkspaceCrash + health watcher in
`SandboxManager`, `sandbox_crashed` SSE event, `GET/POST
/api/workspaces/{id}/sandbox{,/restart}`); frontend
[holzi-frontend#40](https://github.com/haexhub/holzi-frontend/pull/40)
(`SandboxCrashedData` re-export, `onSandboxCrashed` callback in
`useChatStream`, `SandboxCrashCard.vue`, wiring + restart action in
`pages/index.vue`, component tests). `git` operations stayed as plain
`exec(["git", ...])` instead of a new method — exec already streams stdout/
stderr and an exit code, which is exactly what git needs; adding a parallel
typed path would have been duplication.

UI surfaces the plan called out — workspace badge, "Recent sandbox crashes"
on Diagnostics — are deferred to **Plan 12** (Workspace browser owns the
workspace panel where the badge belongs) and **Plan 20** (Diagnostics owns
the crash-history list). 11b-b ships the in-chat crash card + Restart action,
which is what the runtime needs to be usable today; the larger panels can
land cleanly with the surfaces they belong to.

**Known limit (also deferred to Plan 20).** The health watcher fires while a
chat SSE stream is open and the agent emits the event into that stream; it
does **not** persist crashes for later replay. If a workspace dies while no
chat stream is connected, the crash card never appears for that crash. Plan
20's persistent crash log is the place to fix this — the runtime spine
already records the dedupe state, so backfilling a persistent ring buffer
later is additive.

> **Split (2026-05-27).** Too large for one session. The safety-critical spine —
> container lifecycle, `exec`, mandatory resource limits, and network isolation —
> shipped as [11b-a](./11b-a-sandbox-spine.md) (backend-only, rootless Podman).
> This file is now the **11b-b remainder**: the richer internal API
> (read_file/write_file/git), the health watcher → `sandbox_crashed` SSE event +
> restart endpoint, and the frontend surface. The runtime decision (rootless
> Podman, no Docker socket, no DinD) and the `SandboxBackend`/`SandboxManager`
> abstraction are settled in 11b-a; 11b-b builds on them. Sections below that
> 11b-a already delivered (topology, lifecycle, limits, isolation tests) are
> retained for context but are done.

Depends on: [11b-a](./11b-a-sandbox-spine.md) (sandbox spine);
[01b](./01b-conversation-retention-and-bookmarks.md) (data layout).

## Goal

Keep the agent container unkillable. Any operation that runs user/agent code,
performs unbounded file writes, or executes arbitrary shell must happen in an
isolated sandbox container, not in the agent process.

## Why

The agent is supposed to be always reachable. A runaway tool call, an OOM
during a build, or a hostile script must take down at most a sandbox, never
the agent.

## Sandbox Topology

Three roles, three container shapes:

- **Agent container** — always up, lightweight, single worker. Hosts LLM
  calls, conversation/memory storage, routing, and read-only tools (DB
  lookups, web search, memory queries).
- **Workspace sandbox** — one persistent container per workspace, restartable.
  Owns the workspace volume. Hosts file writes, builds, tests, git operations,
  and any code execution scoped to that workspace.
- **Ephemeral execution sandbox** — one-shot container spawned for a single
  task (e.g. "run this Python snippet" outside any workspace), destroyed when
  the task ends.

Anything that doesn't fall in the "code execution / unbounded write / shell"
bucket stays in the agent container. The principle is *isolate risk*, not
*one container per tool call*.

## Notes carried over from the 11b-a review

Two behaviours the health watcher / restart UX must account for, both shipped
deliberately in 11b-a:

- **A crashed workspace stays cached until an explicit restart.** `SandboxManager.get_workspace` returns the cached handle without a liveness probe; after an OOM/crash the caller keeps getting the dead handle until `restart_workspace` is called. 11b-b's health watcher is the piece that detects the dead state and drives the `sandbox_crashed` event + Restart action — without it, a crashed workspace is a permanent dead entry. Decide whether the watcher restarts automatically or only surfaces the action.
- **`_map_state` maps any non-zero/Dead exit to `crashed`, not `exited`.** For the idle `sleep infinity` workspace model this is the intended "something killed my workspace" signal, but it conflates a clean non-zero exit with a real crash. If the health watcher needs to tell those apart (e.g. don't alarm on a deliberate stop), refine the mapping in `_map_state` at `src/hermes/sandbox/podman.py` in the
backend repo (`haexhub/Holzi` — code lives in the backend, not this repo).

## Backend

- Define a `sandbox_kind` enum: `workspace` | `ephemeral`.
- Sandboxes expose a small internal API (HTTP over a private network or a UDS
  socket) for:
  - `exec` (run a command, stream stdout/stderr)
  - `read_file` / `write_file`
  - `git` operations
  - status / restart / shutdown
- Lifecycle:
  - workspace sandboxes auto-start on first use, persist across runs, restart
    on demand
  - ephemeral sandboxes are created per call, destroyed after
- Resource limits per container (CPU, RAM, disk) are mandatory.
- Health: agent watches sandbox liveness; a crashed workspace sandbox surfaces
  as a `sandbox_crashed` event in the chat and offers a Restart action.

## Frontend

- Sandbox status badge on workspaces.
- Restart action on the workspace panel.
- "Recent sandbox crashes" surface on Diagnostics ([Plan 20](./20-onboarding-diagnostics-docs.md)).

## Tests

- Killing a sandbox container does not kill the agent.
- A sandbox OOM is reported and recoverable.
- Ephemeral sandboxes are cleaned up after task completion (no leaked
  containers after N runs).
- Resource limits are enforced.
- Sandbox cannot reach the agent's DB, secrets, or other sandboxes (network
  isolation test).

## Acceptance Criteria

- The agent container has no code-execution or arbitrary-shell tools.
- Every "run command" or "write file" tool call routes through a sandbox.
- A crashed sandbox is restartable from the UI; the conversation survives.
- Sandboxes cannot reach the agent's DB, secrets, or other sandboxes.

## Out Of Scope

- Multi-tenant sandbox sharing across users (still one user per agent).
- gVisor / firecracker / VM-grade isolation; standard Docker isolation is
  enough for v1.
- Sandbox migration between hosts.
- Per-conversation sandbox lifetime (workspace is the boundary, not
  conversation).

## Files Likely Touched

- Holzi backend:
  - `src/hermes/sandbox/` (new)
  - `src/hermes/agent.py`
  - `src/hermes/routes/api.py`
  - `Dockerfile.sandbox` (new)
  - `docker-compose.yml`
  - `tests/test_sandbox.py`
- Frontend:
  - `app/components/panels/WorkspacePanel.vue`
  - `app/pages/settings/diagnostics.vue`
