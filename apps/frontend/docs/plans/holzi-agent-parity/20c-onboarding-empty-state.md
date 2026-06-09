# Plan 20-C: Onboarding-EmptyState (Diagnostics-Aware)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Implemented and merged on 2026-05-30.** Frontend-only:
[holzi-frontend#60](https://github.com/haexhub/holzi-frontend/pull/60)
(squashed as `2170407`).

CodeRabbit credits-exhausted → self-reviewed via a parallel
general-purpose agent per [[reference-code-review-subagent]]. All findings
were NITs ("ship it"); one was addressed inline (`9d591f6` — explanatory
comment on the watcher's one-shot semantics).

Verification (2026-05-30):

- `pnpm vitest run tests/components/EmptyChatState.test.ts` → 6 cases pass.
- `pnpm vitest run` → 22 files / 196 tests / no regression.
- `pnpm typecheck` → exit 0.
- **Live on Docker host** via `make up-local-full` + Playwright accessibility
  snapshot at `http://app.localhost:11080`: banner renders
  `"Setup unvollständig — 3 Subsysteme melden Warnungen oder Fehler."`,
  href `/settings/diagnostics`. The 3 = `messenger + workspace + sandbox =
  warning` matches `/api/diagnostics`-Output for a sandbox-less Docker dev
  host (post-Plan-20-B baseline). Tear-down clean via `make down-local`.

Second of the three Plan 20 follow-up slices (after [20-A](./20a-sandbox-crash-log.md)).
Closes the "Diagnostics zeigt *was* fehlt, nicht *wie* fixen"-gap that [Plan
20](./20-onboarding-diagnostics-docs.md) deferred. Frontend-only — no backend
changes, no `/api/diagnostics` change.

## Goal

`EmptyChatState.vue` becomes diagnostics-aware: when the user lands on a fresh
conversation with credentials configured, a subtle banner under "Sag Hermes
Hallo." surfaces "Setup unvollständig — N Subsysteme melden Warnungen" with a
CTA to `/settings/diagnostics`, *unless* `/api/diagnostics` reports
`overall === 'ok'`.

## Why

Plan 20 added `/settings/diagnostics` and Plan 20-A added the persistent
crash log. Both make problems *discoverable* if the user navigates there.
But the natural first action after first-run is opening the chat — and the
empty chat surface today only tells the user "Sag Hermes Hallo." even when
e.g. the messenger or workspace subsystem is misconfigured. The banner
closes that loop with a single line + link, without re-rendering the
diagnostics list inline.

## Non-Goals

- Inline-list of failing checks. The brainstorming decision was "Ein Hinweis
  + Link"; the diagnostics page is one click away and already does the
  per-check layout. Don't duplicate.
- Auto-refresh of the diagnostics call. One fetch on conversation-empty mount
  is enough; the user moves to `/settings/diagnostics` to refresh.
- Behaviour when the diagnostics call *fails*. Diagnostics-down is an
  auth/connectivity problem, not an onboarding signal — render no banner,
  fall through to the existing "Sag Hermes Hallo."-state silently.
- Banner shown while `hasCredentials === false`. The Credentials-CTA is the
  priority in that state; piling a second CTA on top dilutes both. Banner
  only renders when `hasCredentials === true`.
- New plan for Docs (README quickstart + troubleshooting + provider setup).
  That's the third Plan 20 follow-up; own slice.

## Scope

Frontend (`/home/haex/Projekte/holzi-frontend`):

- `app/components/chat/EmptyChatState.vue` — pull `useDiagnostics()`, run
  `loadDiagnostics()` on mount when `hasCredentials === true`, render the
  conditional banner.
- `tests/components/EmptyChatState.test.ts` *(new)* — mount with the four
  combinatorial states (`hasCredentials` null / false / true × diagnostics
  null / ok / warning), assert banner visibility + CTA target.
- No changes to `pages/index.vue`. `EmptyChatState` keeps its
  `hasCredentials` prop; the diagnostics fetch is component-internal so
  the parent doesn't need to know.

Backend: none. `/api/diagnostics` already returns the shape we need
([Plan 20](./20-onboarding-diagnostics-docs.md)).

## Suggested Implementation

### 1. Component fetch wiring

`EmptyChatState.vue` gains:

```ts
import { onMounted, ref, watch, computed } from 'vue'
import { useDiagnostics } from '~/composables/useDiagnostics'

const props = defineProps<{ hasCredentials: boolean | null }>()

const { diagnostics, loadDiagnostics } = useDiagnostics()

// Only fetch when credentials are confirmed present — otherwise the
// Credentials-CTA is the priority and the banner stays out of the way.
// Triggers exactly once per becomes-true transition (`{ immediate: true }`
// covers the case where the parent already had hasCredentials=true at
// mount time).
watch(
  () => props.hasCredentials,
  (val) => {
    if (val === true && diagnostics.value === null) {
      void loadDiagnostics()
    }
  },
  { immediate: true },
)

const findingCount = computed(() => {
  const d = diagnostics.value
  if (!d || d.overall === 'ok') return 0
  return d.checks.filter((c) => c.status !== 'ok').length
})

const showBanner = computed(
  () => props.hasCredentials === true && findingCount.value > 0,
)
```

### 2. Banner markup

Append below the existing `<template v-else>` block (the "Sag Hermes
Hallo."-branch):

```vue
<NuxtLink
  v-if="showBanner"
  to="/settings/diagnostics"
  data-testid="empty-state-diagnostics-banner"
  class="group mt-2 flex max-w-md items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-left text-sm transition-colors hover:bg-amber-500/10"
>
  <AlertTriangle class="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
  <span class="flex-1">
    <span class="font-medium">Setup unvollständig</span>
    <span class="block text-muted-foreground">
      {{ findingCount }} {{ findingCount === 1 ? 'Subsystem meldet' : 'Subsysteme melden' }} Warnungen oder Fehler.
    </span>
  </span>
  <ArrowRight class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
</NuxtLink>
```

…and add `AlertTriangle` to the lucide-vue-next import.

### 3. Component test

New `tests/components/EmptyChatState.test.ts` modelled on
`SettingsPlaceholder.test.ts` (smallest existing component test). Cases:

| `hasCredentials` | Mocked `/api/diagnostics` | Expected banner |
|---|---|---|
| `null` | n/a (no fetch) | hidden |
| `false` | n/a (no fetch) | hidden, Credentials-CTA visible |
| `true` | `overall = 'ok'` | hidden |
| `true` | `overall = 'warning'`, 2 non-ok checks | visible, copy "2 Subsysteme melden …", `href="/settings/diagnostics"` |
| `true` | `overall = 'error'`, 1 non-ok check | visible, copy "1 Subsystem meldet …" |
| `true` | fetch rejects | hidden (silent fallthrough) |

Use `vi.mock('~/composables/useApi')` returning a stub with a `get` spy.
Mount via `@vue/test-utils` per [[reference-component-testing]];
`await vi.waitFor(() => ...)` for the post-fetch assertions because the
banner appears asynchronously.

### 4. Verification

Per [[verification-before-completion]]:

- `pnpm typecheck` — green.
- `pnpm vitest run tests/components/EmptyChatState.test.ts` — green.
- `pnpm vitest run` — full suite, no regression.
- Live (per [[reference-docker-local-devstack]] post-Plan-20-B):
  - `make up-local-full` on the user's Docker host.
  - Open `http://app.localhost:11080` with a configured Claude-OAuth
    credential, fresh conversation pane.
  - Banner appears under "Sag Hermes Hallo.", links to
    `/settings/diagnostics`. The Docker-host default has at least
    sandbox+workspace+messenger = warning, so the banner *will* show.
  - Clicking the banner navigates to the Diagnostics page.
  - `make down-local`.

## Out Of Scope

- README / troubleshooting / provider-setup docs — third Plan 20 follow-up.
- Banner severity styling (currently amber regardless of `overall`).
  `overall === 'error'` could render red, but the visual difference is
  minor and the page-one-click-away is the canonical place to see
  per-check severity.
- Per-check inline CTAs.
- I18n. Copy stays German, matching the rest of the EmptyChatState.

## Acceptance Criteria

- `EmptyChatState.vue` renders the banner iff `hasCredentials === true`
  AND `/api/diagnostics` returned `overall !== 'ok'`.
- Banner copy uses singular/plural correctly based on non-ok check count.
- Diagnostics fetch failure does not surface anything to the user — the
  empty state silently keeps showing "Sag Hermes Hallo."
- Credentials-missing state is unchanged (priority CTA stays alone).
- New component test covers all six matrix cases.
- `useDiagnostics` composable not touched (already-shipped surface).

## Files Likely Touched

- `app/components/chat/EmptyChatState.vue` — main change.
- `tests/components/EmptyChatState.test.ts` — new.

## After Merge

Per [[feedback-session-wrapup-ritual]]:

- Status block on this file with squashed SHA + live-verification output.
- Update [Plan 20](./20-onboarding-diagnostics-docs.md): move the
  "first-run / onboarding empty state" bullet from "Deferred" to a
  "Resolved follow-ups" line pointing at this slice.
- Update [[project-holzi-diagnostics-panel]] memory: note 20-C merged,
  Plan 20 has one remaining follow-up (docs).
- Roadmap README: add 20-C to Completed, drop from "next up".

PR workflow + CodeRabbit per [[feedback-coderabbit-workflow]] (likely still
credit-exhausted → parallel general-purpose review per
[[reference-code-review-subagent]]); push/merge via the haexhub token per
[[reference-git-push-account]]. Per [[feedback-session-scoping]] this is
the only slice in the session.
