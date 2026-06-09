# Plan 12: Workspace Browser Read-Only

Status: implemented and merged on 2026-05-29. Cross-repo: backend
[Holzi#45](https://github.com/haexhub/Holzi/pull/45) (`list_dir` on the
sandbox backend, the three `/api/workspace/{roots,tree,file}` endpoints,
preview classification, `HERMES_WORKSPACE_ROOTS` config); frontend
[holzi-frontend#42](https://github.com/haexhub/holzi-frontend/pull/42)
(`WorkspacePanel.vue` as the 4th right-panel tab with breadcrumb, dir
listing, preview, refresh, stale-response guard). All reads route through
the sandbox-mounted `/workspace` volume — never the host filesystem.

The sandbox status badge the plan mentioned in passing didn't actually live
in Plan 12's frontend brief and stays deferred until a clear home appears
(workspace shell in 14 or write-mode in 13). Plan 11b-b's in-chat
`SandboxCrashCard` already covers the user-facing recovery path.

Depends on: [11b](./11b-sandbox-runtime.md) — workspaces are owned by their
sandbox container; tree/file reads go through that sandbox, not directly from
the agent container's filesystem.

## Goal

Add a safe read-only workspace/file browser to the right panel.

## Why

Hermes WebUI's workspace panel is powerful because the agent and user can orient
around real project files. Holzi should gain this carefully, starting read-only.

## Scope

Backend:

- Configure allowed workspace roots.
- Add `GET /api/workspace/tree`.
- Add `GET /api/workspace/file?path=...`.
- Prevent path traversal.
- Return file type, size, and preview content where safe.

Frontend:

- Add `WorkspacePanel.vue`.
- Add right-panel tab beside Notes/Todos/Reminders.
- Render tree/list.
- Preview text, Markdown, and images.

Tests:

- Backend traversal rejection.
- Hidden/large/binary file behavior.
- Frontend preview state if extracted.

## Suggested Implementation

1. Add config variable, for example `HERMES_WORKSPACE_ROOTS`.
2. Represent paths relative to a root ID or root name.
3. Tree endpoint returns shallow children first; avoid recursive full scans.
4. File endpoint returns:
   - metadata
   - text content if text and below limit
   - image URL/blob endpoint if image
5. Frontend starts with a simple two-pane layout in the right panel.

## Acceptance Criteria

- User can browse configured workspace roots.
- User can preview text and Markdown files.
- User can preview common image files.
- Attempts to access `../` outside roots fail.
- Large/binary files do not freeze the UI.

## Out Of Scope

- Editing.
- Rename/delete/create.
- Git status.
- Agent file write tools.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/config.py`
  - `src/hermes/routes/workspace.py`
  - `tests/test_api_workspace.py`
- Frontend:
  - `app/components/panels/WorkspacePanel.vue`
  - `app/pages/index.vue`
