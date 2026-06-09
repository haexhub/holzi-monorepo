# Design: Sidebar + VS Code Chat Participant

## Summary

Add three things to the Holzi VS Code extension:
1. Activity Bar icon + sidebar with chat history
2. `@holzi` participant in the VS Code Chat panel (alongside Copilot/Claude Code/Codex)
3. Auth/server configuration commands + status bar item

## Section 1: Activity Bar + Sidebar

### package.json additions

```json
"viewsContainers": {
  "activitybar": [{
    "id": "holzi-sidebar",
    "title": "Holzi",
    "icon": "images/icon.svg"
  }]
},
"views": {
  "holzi-sidebar": [{
    "type": "webview",
    "id": "holzi.sidebarView",
    "name": "Chats"
  }]
}
```

### HolziSidebarProvider

Implements `vscode.WebviewViewProvider`. Displays:
- "New Chat" button (opens `HolziPanel`)
- List of past sessions (title + last message preview + date)
- Connection status + server URL with "Configure" button

**Session storage:** Metadata only (`{ id, title, lastMessage, updatedAt }`).
- Persisted locally in `context.globalState`
- On connect: fetched from `GET /api/sessions`, merged with local cache (server is authoritative)

Clicking a session opens `HolziPanel` with that session's ID, which loads full history from the server.

## Section 2: VS Code Chat Participant (`@holzi`)

### package.json addition

```json
"chatParticipants": [{
  "id": "holzi.chat",
  "fullName": "Holzi",
  "name": "holzi",
  "description": "Holzi AI Assistant",
  "isSticky": true
}]
```

### HolziChatParticipant

Registered via `vscode.chat.createChatParticipant('holzi.chat', handler)`.

- One `HolziSocket` per VS Code chat session (keyed by `context.history` thread)
- Forwards user message + VS Code context (active file, selection) to backend
- Streams response via `stream.markdown(delta)`
- Tool calls shown as `stream.progress('Running: read_file...')`
- Tool confirmations (`apply_diff`, `run_command`) via `vscode.window.showWarningMessage`
- Reuses existing `ToolRegistry` — no duplicate tool logic

## Section 3: Auth + Server Configuration

### New commands

```json
{ "command": "holzi.configure", "title": "Holzi: Configure Server" },
{ "command": "holzi.login",     "title": "Holzi: Sign In" }
```

**`holzi.configure`:** InputBox prefilled with current `holzi.host`. On confirm: saves to config, reconnects socket.

**`holzi.login`:** InputBox for Bearer token. On confirm: saves to `holzi.token`, reconnects socket.

### Status bar item

- `$(holzi-icon) Holzi: Connected` / `Holzi: Not connected`
- Click when not connected → triggers `holzi.login`
- Sidebar shows "Not configured" state with "Sign In" button when no token is set

### Language

English only throughout (UI, error messages, status strings).
