# Plan 14: Control Center Shell

Status: **Merged 2026-05-29** (frontend-only [holzi-frontend#46](https://github.com/haexhub/holzi-frontend/pull/46)).

Verification:

- `pnpm run typecheck` — clean.
- `pnpm test` — 18 files, 152 tests passing (incl. new `tests/components/SettingsPlaceholder.test.ts`).
- Visual smoke not run against the dev-stack; layout uses standard Tailwind responsive utilities (`md:hidden` / `hidden md:flex`) and is covered by tests for the nav model + placeholder rendering.

Notes:

- Nav model lives in `app/lib/settingsNav.ts` as a `readonly SettingsNavItem[]` — one source of truth consumed by `pages/settings.vue` (sidebar + mobile tabs) and the shared `components/settings/PlaceholderSection.vue`. Each item carries an optional `upcoming` hint; shipped sections (`llm`, `messenger`) omit it. Plan 15/16/20 just need to remove the `upcoming` hint and add their content.
- `/settings` keeps redirecting to `/settings/llm` (existing middleware in `pages/settings/index.vue`).
- Header label flipped to `Control Center`; subtitle remains German.
- Six placeholder routes added (`preferences`, `memory`, `tasks`, `skills`, `workspaces`, `diagnostics`) — each page is two lines and mounts `PlaceholderSection` which looks itself up in `settingsNav` by `route.path`. No fake functionality.
- Responsive layout: desktop renders a 208 px sidebar with icons + labels; mobile renders the same items as horizontally scrollable top tabs (`overflow-x-auto` band). Both navs share the same `settingsNav` array, so deep links + browser back work and the two layouts can never drift apart.

## Goal

Create a coherent Control Center for operating Holzi.

## Why

Settings will grow beyond LLM credentials and messenger accounts. A stable
Control Center structure prevents a pile-up of unrelated settings pages.

## Scope

Frontend:

- Rework `/settings` into a Control Center shell.
- Preserve existing LLM and Messenger pages.
- Add placeholder routes for:
  - Preferences
  - Memory
  - Tasks
  - Skills/Tools
  - Workspaces
  - Diagnostics
- Add responsive navigation.

Backend:

- No backend changes required unless a basic preferences endpoint is included.

Tests:

- Route rendering smoke tests if project has route test pattern.
- At minimum run typecheck.

## Suggested Implementation

1. Keep existing `/settings/llm` and `/settings/messenger`.
2. Add a settings navigation model in one place.
3. Use route-based tabs/sidebar so deep links work.
4. Add empty placeholder pages with concise copy and no fake functionality.
5. Avoid visual over-design; this is an operational UI.

## Acceptance Criteria

- Existing LLM and Messenger settings still work.
- New Control Center navigation gives each future area a clear home.
- `/settings` redirects to a sensible default.
- Layout works on mobile and desktop.

## Out Of Scope

- Implementing all panels.
- Backend preferences.
- Auth changes.

## Files Likely Touched

- Frontend:
  - `app/pages/settings.vue`
  - `app/pages/settings/index.vue`
  - `app/pages/settings/llm.vue`
  - `app/pages/settings/messenger.vue`
  - new placeholder files under `app/pages/settings/`
