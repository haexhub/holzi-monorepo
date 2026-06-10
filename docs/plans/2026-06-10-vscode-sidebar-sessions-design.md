# Design: VS Code Activity-Bar Sidebar with Sessions List

## Summary

Re-introduce a Holzi entry in the VS Code Activity Bar (removed in
`ba905bb`). Clicking it opens a sidebar containing a flat, chronological
list of all conversations fetched from `GET /api/conversations`. The
sidebar uses VS Code's native `TreeView` API — no second webview, no
duplicate build, no duplicate auth bootstrap. A `+` action in the view
title opens a new chat tab; clicking a session focuses the existing tab
for that conversation if one is open, otherwise opens a new tab loaded
directly at `/chat/<id>`. A trash icon on hover deletes a session.

This restores the affordance the user lost while keeping the slim-host
architecture intact.

## Reference

Visual target: Claude Code's sidebar — flat list, search-on-`Ctrl+F`,
right-aligned relative timestamp, hover-only inline action icons, `+`
button in the title bar. The native `TreeView` API delivers every one of
these without a webview.

## Section 1: Architecture & UI Surface

**New files in `apps/vscode/extension/src/`:**

- `api.ts` — minimal HTTP client. Two functions:
  `listConversations(context)` → `GET {host}/api/conversations` and
  `deleteConversation(context, id)` → `DELETE {host}/api/conversations/{id}`.
  Uses Node's built-in `fetch`, `Authorization: Bearer <token>`,
  reads host/token via the existing `config.ts` helpers (`getHost`,
  `getToken`).
- `SessionsProvider.ts` — implements
  `vscode.TreeDataProvider<SessionItem>`. Holds the conversation list in
  memory, sorts by `updated_at desc`, maps each conversation to a
  `SessionItem` with `label = title || "Untitled"`,
  `description = formatRelative(updated_at)`, `command = holzi.openSession`,
  `contextValue = "session"`. Exposes an
  `EventEmitter<void>` for refreshes.

**New commands (registered in `extension.ts`):**

- `holzi.openSession` (arg: `id: string`) — see Section 3.
- `holzi.refreshSessions` — clears cache and re-emits the change event.
- `holzi.deleteSession` (arg: `SessionItem`) — confirms with a modal
  warning, calls `deleteConversation`, then refreshes.

**`package.json` contributions:**

```jsonc
"contributes": {
  "viewsContainers": {
    "activitybar": [
      { "id": "holzi", "title": "Holzi", "icon": "images/icon.svg" }
    ]
  },
  "views": {
    "holzi": [
      { "id": "holzi.sessions", "name": "Sessions", "type": "tree" }
    ]
  },
  "viewsWelcome": [
    {
      "view": "holzi.sessions",
      "when": "!holzi.authenticated",
      "contents": "[Sign in to Holzi](command:holzi.login)"
    },
    {
      "view": "holzi.sessions",
      "when": "holzi.authenticated && holzi.sessionsEmpty",
      "contents": "[New session](command:holzi.openChat)"
    }
  ],
  "menus": {
    "view/title": [
      { "command": "holzi.openChat",        "when": "view == holzi.sessions", "group": "navigation@1" },
      { "command": "holzi.refreshSessions", "when": "view == holzi.sessions", "group": "navigation@2" }
    ],
    "view/item/context": [
      { "command": "holzi.deleteSession",
        "when": "view == holzi.sessions && viewItem == session",
        "group": "inline" }
    ]
  }
}
```

Two `when`-context keys (`holzi.authenticated`, `holzi.sessionsEmpty`)
are maintained by the extension via
`vscode.commands.executeCommand('setContext', …)`.

## Section 2: Data & Auth Flow

**Fetch lifecycle:**

- `SessionsProvider.getChildren()` lazily fetches on first call and
  caches. Refresh events drop the cache and re-fetch.
- Sorting is done in the host (no assumption about backend order).
- `description` is a relative-time string (`now`, `9m`, `2h`, `3d`, …)
  produced by a small pure `formatRelative(iso)` helper inside the
  provider.

**Auth handling:**

- On startup and on `context.secrets.onDidChange('holzi.token')` the
  extension calls
  `setContext('holzi.authenticated', token.length > 0)` and refreshes.
- 401 from `listConversations` → clear authenticated context →
  Welcome-view "Sign in" is shown.
- Other errors → logged to the `Holzi` output channel +
  `vscode.window.showErrorMessage`.

**First-message refresh:**

- `HolziPanel._handleWebviewMessage` is extended with an optional
  `onFirstMessage` callback passed in via the constructor. The existing
  `set_title` handler invokes the callback in addition to setting the
  panel title (the webview already emits `set_title` exactly on the
  first message of a new chat — commit `95d85c1`).
- `extension.ts` injects a callback that calls
  `sessionsProvider.refresh()`. No new IPC channel — reuses the existing
  message bus.

**Tab tracking (for "focus instead of duplicate"):**

- `HolziPanel` adds a field `currentConversationId: string | null`.
- New webview→host message type: `{type:'conversation_id', id: string|null}`.
  The webview emits it on every route transition in/out of `/chat/<id>`
  (small `watch` on `useRoute().params.id` in the webview bootstrap).
- `HolziPanel.findByConversationId(id: string): HolziPanel | undefined`
  iterates the existing `instances` set.

## Section 3: Open / Delete Behavior

**`holzi.openSession(id)`:**

```text
existing = HolziPanel.findByConversationId(id)
if existing:
  existing.panel.reveal()
else:
  HolziPanel.createOrShow(context, logger, { conversationId: id })
```

`HolziPanel.createOrShow` gains a third `options?: { conversationId?: string }`
argument. When `conversationId` is set, the host — after the webview
sends `webview_ready` — additionally posts
`{type:'navigate', path:'/chat/<id>'}`. The webview's existing bootstrap
code adds a `navigate` listener → `useRouter().replace(path)`.

This covers both cases:

- Session was opened earlier and is still tabbed → revealed.
- Session is not currently tabbed (or was just created in some other
  tab and we navigated away) → new tab opens directly at the chat
  detail route.

Because the webview reports its `conversation_id` whenever the route
changes, a tab that *started* empty and acquired an id after the first
message is found by `findByConversationId` from then on — no duplicate
tabs.

**`holzi.deleteSession(item)`:**

```text
confirm = showWarningMessage(`Delete "${item.label}"?`,
                             { modal: true }, 'Delete')
if confirm !== 'Delete': return
await deleteConversation(context, item.id)
sessionsProvider.refresh()
```

A tab that happens to be displaying the deleted conversation is left
alone — its webview will hit a 404 on the next backend call, which the
existing frontend already handles by navigating to `/`.

## Verification (manual, no new tests in V1)

1. Build + F5 dev host → Activity Bar shows the Holzi icon → click →
   sidebar opens.
2. With no token: Welcome shows "Sign in"; after `holzi.login` the
   list loads automatically.
3. List shows conversations, newest first, with relative timestamps.
   `Ctrl+F` filters natively.
4. Click an entry → new panel tab, loads directly at `/chat/<id>`,
   history is rendered.
5. Click the same entry again → focuses the existing tab instead of
   opening a duplicate.
6. `+` in the title bar → empty new tab; after the first message the
   new conversation appears at the top of the sidebar.
7. Hover an entry → 🗑 inline icon; Delete removes the entry from the
   list and the backend.

## Out of Scope (YAGNI)

- No polling, no WebSocket — only first-message refresh + manual
  refresh.
- No rename / pin / export in the sidebar.
- No pagination — assumes `/api/conversations` returns a manageable
  volume.
- No webview-based sidebar — the slim-host stance of `ba905bb` is
  preserved.
