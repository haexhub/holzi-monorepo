# Plan 26: Deep-Links auf Conversations — `/chat/[id]` + Reload-stabile URLs

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-06-04** ([holzi-frontend#88](https://github.com/haexhub/holzi-frontend/pull/88)).

Verification (2026-06-04):

- `pnpm test` → 38 files / 328 tests passed (up from 316 baseline; +12
  new tests: 5 for `chat/[id].vue`, 4 for the `/` redirect logic, 3 for
  `ConversationList`'s emit contract).
- `pnpm typecheck` → green.
- The hub body was extracted into `app/components/ChatHub.vue`;
  `app/pages/index.vue` is now the redirect-or-empty shell and
  `app/pages/chat/[id].vue` is the deep-link adapter. Both routes
  render the same `ChatHub` surface.
- `holzi.lastConversationId` persistence moved into a Pinia store
  (`app/stores/lastConversation.ts`) modelled on `auth.ts` — VueUse
  `useLocalStorage` ref + custom serializer that normalises garbage
  values to `null` on read. Self-review pushback against the
  subagent's initial naked `localStorage.getItem/setItem/removeItem`
  pattern: the project already had the Pinia+VueUse precedent, so the
  fix-up commit migrated the three call-sites.
- Two more self-review fix-ups in the same commit: pre-seeded
  `loadingConversation` ref in `ChatHub` hides `EmptyChatState` while
  a deep-linked conversation's messages are still loading (otherwise
  the "Sag Hermes Hallo." greeting flashes briefly on cold load);
  `useHead({ title })` per route so multi-tab workflows show the
  active conversation id instead of every tab reading "Neuer Chat".

Frontend-only. No backend changes required (the `GET /api/conversations/{id}`
endpoint is already there).

Depends on: [01](./01-conversation-lifecycle.md) (conversation CRUD),
[02](./02-conversation-search-organization.md) (list with channels/q).

## Goal

Make every conversation URL-addressable. Today, reload at `/` always lands
on "Neuer Chat"; there's no way to bookmark, share, or come back after a
crash without reopening the conversation list and clicking. After this
plan: `/chat/<id>` opens that conversation directly; `/` redirects to the
last-active conversation if one exists.

## Why

- Every chat tool the user is familiar with (Claude.ai, ChatGPT, Cursor)
  ships URL-addressable conversations. Holzi standing out as the one that
  doesn't is friction.
- Browser-refresh resetting to a fresh chat is the single biggest
  recurring annoyance: a "stay where I was" moment that is one route
  param away.
- Multi-tab usage today is broken — opening a second tab can't pin a
  different conversation; both tabs share the singleton selection.

## Non-Goals

- A multi-tab session-state sync (BroadcastChannel for streaming state).
  Each tab owns its own active conversation; if both tabs open the same
  `/chat/<id>` and one is mid-stream, the other just sees the persisted
  messages — it does not auto-attach to the in-flight SSE.
- Pre-rendered conversation pages (SSR). Nuxt SPA mode (`ssr: false`)
  stays.
- Sharing a conversation link with another user. Single-user invariant
  unchanged.
- URL-encoded conversation state beyond the id (filters, scroll position).
  `id` is enough.

## Scope

### Frontend

- New file: `app/pages/chat/[id].vue` — thin wrapper that imports the
  current Chat hub component, passing the route param as the active id.
- Refactor `app/pages/index.vue` — extract its body into
  `app/components/ChatHub.vue` (or similar) that takes `conversationId:
  string | null` as a prop. The chat hub is the same Vue surface for both
  `/` and `/chat/:id`.
- `app/pages/index.vue`:
  - On mount, read `localStorage.holzi.lastConversationId`. If present
    and the GET request succeeds, ``navigateTo(`/chat/${id}`)``. Otherwise
    render the empty hub.
  - When the user creates a new conversation (first send), persist
    `lastConversationId` and replace the URL via
    ``navigateTo(`/chat/${id}`, { replace: true })``.
- `app/pages/chat/[id].vue`:
  - Validate the param against `/api/conversations/{id}` on mount.
    On 404, route back to `/` and toast "Konversation nicht gefunden".
  - On 401, the existing auth-middleware redirect to `/login` already
    handles it.
  - Sync the in-memory `activeId` with the route param; route changes
    swap the hub's active id.
- `app/components/chat/ConversationList.vue`:
  - Selecting a conversation calls ``navigateTo(`/chat/${id}`)`` instead
    of just mutating `activeId`.
  - "Neuer Chat" button routes to `/`.

### Tests

- `tests/pages/chat-id.test.ts` *(new)* — mount the page with a fixed
  route param, mock the conversation fetch, assert the hub mounts with
  the right id.
- `tests/pages/index.test.ts` *(extend)* — without lastConversationId, no
  redirect; with one + 200 fetch, redirects; with one + 404, clears and
  stays.
- `tests/components/ConversationList.test.ts` — selecting a row calls
  `navigateTo` once.

### Backend

None. `GET /api/conversations/{id}` already returns the messages and
metadata.

## Suggested Implementation

### 1. Extract the hub

- Move `pages/index.vue`'s `<template>` body into
  `components/ChatHub.vue`. Move all reactive state up unchanged.
- `pages/index.vue` becomes ~30 lines: redirect logic + `<ChatHub
  :conversation-id="null" />` fallback.
- `pages/chat/[id].vue`:
  ```vue
  <script setup>
  const route = useRoute()
  const id = computed(() => String(route.params.id))
  // fetch + validation + 404 handling
  </script>
  <template>
    <ChatHub :conversation-id="id" />
  </template>
  ```

### 2. Last-active persistence

- One `useLocalStorage('holzi.lastConversationId', null)` in `pages/index.vue`.
- Update on the existing "first send creates conversation" code path —
  the response carries the id, persist + redirect.

### 3. Route-aware list navigation

- `ConversationList.vue` already emits `select` to its parent. The parent
  (`ChatHub.vue` after extraction) calls `navigateTo` instead of mutating
  a ref.
- Watch `route.params.id` inside `ChatHub` to reload the conversation
  detail when the URL changes (covers browser back/forward).

### 4. Verification

Per [[verification-before-completion]]:

- `pnpm vitest run` — full suite green.
- `pnpm typecheck` — green.
- Live (`make up-local-full`):
  - Send a message, copy the URL, reload → land on the same conversation.
  - Open a second tab with `/chat/<other-id>` → both tabs hold different
    conversations.
  - Browser back from a conversation to "Neuer Chat" via the
    "Neuer Chat" button → URL becomes `/`.
  - Navigate to `/chat/does-not-exist` → toast appears, route resets to
    `/`.

## Acceptance Criteria

- `/chat/<id>` is bookmark-able and reload-stable.
- `/` redirects to the last active conversation if one exists and is
  reachable; otherwise renders the empty hub.
- "Neuer Chat" routes to `/` (no id in URL until first send).
- Selecting a row in the conversation list updates the URL.
- 404 / 401 paths fall back gracefully (toast + redirect).
- Two browser tabs can hold different conversations independently.

## Out Of Scope

- Streaming state cross-tab sync.
- Pre-rendered SSR.
- Conversation-share links.
- Anchor links to a specific message (`/chat/<id>#msg-<mid>`).
- Conversation cards opening in new windows via middle-click — should
  work for free because we use `<NuxtLink>` consistently; not promising
  a test for it.

## Files Likely Touched

- `app/pages/index.vue`
- `app/pages/chat/[id].vue` *(new)*
- `app/components/ChatHub.vue` *(new — extracted)*
- `app/components/chat/ConversationList.vue`
- `tests/pages/chat-id.test.ts` *(new)*
- `tests/pages/index.test.ts` *(extended)*
- `tests/components/ConversationList.test.ts`

## After Merge

- Status block + README row.
- Memory: note that the hub component lives in `ChatHub.vue` and both
  `/` + `/chat/:id` use it.
