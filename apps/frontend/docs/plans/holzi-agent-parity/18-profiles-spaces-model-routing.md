# Plan 18: Spaces And Model Routing

Depends on: [14](./14-control-center-shell.md).

> **Likely supplanted by workspaces.** With [Plan 11b](./11b-sandbox-runtime.md)
> in place, each workspace already comes with its own sandbox container,
> volume, and (via this plan's draft) default model/credential. A standalone
> "Space" concept then just renames "Workspace + defaults". Do not implement
> this plan unless a use case appears that needs *non-workspace* context
> switching inside a single agent. Strong default: drop this plan and let
> workspaces carry the role.

## Goal

Introduce contexts that let one Holzi instance separate work, projects, tools,
workspaces, and model preferences without spinning up a new container.

## Why

If multiple contexts share one container, "Private assistant", "coding agent",
and "vault automation" should not all share identical tools, memory, model, and
workspace roots. Spaces are the in-app context boundary for that case.

## Scope

Backend:

- Add `profiles` or `spaces` table.
- Associate conversations with a profile/space.
- Allow default credential/model per profile.
- Allow workspace roots per profile.

Frontend:

- Add profile/space switcher.
- Add profile management page in Control Center.
- Show active profile in chat header.

Tests:

- Conversations are created under active profile.
- Model selection resolves profile default.
- Missing profile falls back safely.

## Single Concept: Space

Commit to one concept named `space`. A Space bundles:

- workspace roots
- default credential and default model
- enabled tools (later)
- memory namespace (later)

The earlier idea of a separate `profile` is dropped — with single-user
containers there is no second dimension that justifies the split.

## Suggested Implementation

1. Add minimal table:
   - `id`
   - `name`
   - `description`
   - `default_credential_id`
   - `default_model`
   - `created_at`
   - `updated_at`
2. Add nullable `space_id` to conversations.
3. Add CRUD API for spaces.
4. Frontend switcher stores selected space and passes it to new chat requests.
5. Existing conversations without a space remain visible under "All" or
   "Default".

## Acceptance Criteria

- User can create/select a space.
- New conversations are associated with selected space.
- Conversation list can filter by space.
- Space can define default model/credential or inherit global active credential.
- Existing data still loads.

## Out Of Scope

- Fine-grained permission system.
- Separate auth per space.
- Complex tool policies.

## Files Likely Touched

- Holzi backend:
  - `src/hermes/schema.py`
  - `src/hermes/routes/spaces.py`
  - `src/hermes/repository/spaces.py`
  - `src/hermes/repository/conversations.py`
  - `tests/test_api_spaces.py`
- Frontend:
  - `app/pages/settings/spaces.vue`
  - `app/components/chat/SpaceSwitcher.vue`
  - `app/pages/index.vue`
