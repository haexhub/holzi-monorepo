# Design: VS Code Multi-Panel "New Chat" + Removal of Last-Conversation Redirect

## Summary

1. `HolziPanel` (VS Code extension) becomes multi-instance: every "New Chat" opens
   its own panel/tab with its own webview and its own backend session — like
   Claude Code's tab model.
2. Each panel's tab gets a human-readable title derived from the user's first
   message instead of a sequential number.
3. The "resume last conversation" redirect on `/` is removed entirely (web
   frontend and VS Code webview share this code via `holzi-ui`). `/` (and a
   freshly opened VS Code panel) always starts a brand-new chat. Old sessions
   are reachable only through the existing conversation list in `Hub.vue`'s
   left sidebar — already present in both contexts.

## Section 1: HolziPanel — Singleton → Multi-Instance

File: `apps/vscode/extension/src/HolziPanel.ts`

- Replace `private static current: HolziPanel | undefined` with
  `private static instances = new Set<HolziPanel>()`.
- `createOrShow` drops the "reveal existing panel" branch — it always creates a
  new `vscode.WebviewPanel` and a new `HolziPanel` instance, added to
  `instances`.
- `onDidDispose` removes the instance from `instances` instead of resetting a
  single static field.
- Every invocation of the `holzi.openChat` command therefore opens a new
  tab/panel — matching the "New Chat" semantics.

## Section 2: Remove the last-conversation redirect

The redirect-on-mount in `pages/index.vue` (driven by
`stores/lastConversation.ts`) is removed entirely so `/` always renders an
empty `ChatHub`. This makes a freshly opened VS Code panel behave identically
to a freshly loaded `/` in the web frontend: always a new chat, new backend
session created lazily on first message via the existing `session` SSE event.

Changes (all in `packages/holzi-ui`, shared by web frontend and VS Code
webview):

- **`pages/index.vue`**: remove the `onMounted` redirect logic and the
  `useLastConversationStore` import. Template becomes just `<ChatHub />`.
- **`components/chat/Hub.vue`**: remove the `useLastConversationStore` import
  and all `rememberLastConversation(...)` calls (in `loadConversation`,
  `reloadActive`, `newChat`, the `onSession` stream callback, attachment
  upload rollback, `logout`, `deleteConversation`). `newChat()` keeps its
  other behavior (clear `activeId`, messages, queue, navigate to `/`).
- **`pages/chat/[id].vue`**: remove the `lastConv.clear()` call and the
  `useLastConversationStore` import on the 404 path. Still navigates back to
  `/` on invalid ids (which now always means "new chat").
- **`stores/lastConversation.ts`**: delete the file (no remaining references
  after the above).
- **Tests**: update `apps/frontend/tests/pages/index.test.ts`,
  `apps/frontend/tests/pages/chat-id.test.ts`, and
  `apps/frontend/tests/components/ChatHub.channel-filter.test.ts` to drop
  `lastConversation` mocks/assertions.

Old sessions remain reachable via the existing `ConversationList` in `Hub.vue`'s
left sidebar (`onSelect(id)` → `/chat/<id>`), unchanged — present in both the
web frontend and the VS Code webview panel already.

## Section 3: Panel title from first message

- **`packages/holzi-ui/components/chat/Hub.vue`**: add an emit
  `first-message: [text: string]`, fired exactly once — when a message is sent
  while `messages.value` is still empty (the first turn of a new chat).
- **`apps/vscode/webview`**: listen for `first-message` on the root `ChatHub`
  usage. Derive a short title:
  ```typescript
  const title = text.trim().replace(/\s+/g, ' ').slice(0, 50) || 'New Chat'
  $vscode.post({ type: 'set_title', title })
  ```
- **`HolziPanel._handleWebviewMessage`**: handle `set_title` →
  `this.panel.title = msg.title as string`.

No backend involvement — purely a VS Code tab-title affordance. The actual
backend session is created lazily on first message via the existing `session`
SSE event, independent of the title.

## Verification

- `HolziPanel`: manual check — running `holzi.openChat` multiple times opens
  multiple independent tabs, each loads its own `ChatHub` at `/`, each starts
  its own conversation on first message.
- `holzi-ui`: existing unit tests for `Hub.vue`, `pages/index.vue`,
  `pages/chat/[id].vue` updated and passing after `lastConversation` removal.
- Manual: send a message in a fresh panel/tab → tab title updates to a
  truncated version of that message; reload `/` (web) → always lands on an
  empty new chat, never resumes a previous conversation.
