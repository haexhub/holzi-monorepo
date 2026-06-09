Status: BE done (PR #82, merged 2026-06-08, squash `2361ebf`). FE extension (separate VS Code project) not started.

# Plan 41: Holzi VS Code Extension

Depends on: Plan 17 (Cline channel, `/v1/chat/completions` proxy already live)

## Goal

A native VS Code extension that connects to holzi.haex.cloud with full
per-conversation model selection, Skills, MCPs, and local file/CLI access —
same experience as Claude Code, powered by Holzi.

## Why

Cline (Plan 17 Stufe 1) works but the model is a global provider setting, not
per-conversation. Skills and MCPs are not accessible from VS Code at all. The
extension closes this gap: every conversation in VS Code gets the same model
picker, Skills, MCPs, and memory as the web UI.

## Architecture

```
VS Code Extension                    holzi.haex.cloud
┌─────────────────────┐              ┌──────────────────┐
│  Webview (Chat UI)  │              │  Agent Loop      │
│  - Model picker     │              │  - Skills        │
│  - Skills picker    │◄─WebSocket──►│  - MCPs          │
│  - MCP picker       │              │  - Memory        │
│  - Permission mode  │              └──────────────────┘
├─────────────────────┤
│  Tool Executor      │
│  - read/write_file  │
│  - run_command      │
│  - apply_diff       │
│  - get_selection    │
└─────────────────────┘
```

The extension opens a persistent WebSocket to Holzi. Chat messages go upstream.
When Holzi's agent loop needs to read a file or run a command, it sends a
`tool_call` event back over the same connection. The extension executes locally
and returns `tool_result`. No tunnels, no external services.

## WebSocket Protocol

All messages are JSON.

### Client → Server

```jsonc
// Session start — sent once after connection
{ "type": "start_session",
  "model": "claude-sonnet-4-6",
  "skills": ["code-review"],
  "permission_mode": "ask",          // "plan" | "ask" | "auto_edit" | "auto"
  "tools": ["read_file", "write_file", "list_dir", "run_command",
            "apply_diff", "get_selection", "open_file"] }

// User message
{ "type": "message", "content": "...",
  "context": { "file": "src/Chat.vue", "selection": "line 12-24",
               "selected_text": "..." } }

// Tool result (response to a tool_call from server)
{ "type": "tool_result", "id": "<call_id>", "result": "..." }
// Or on denial / error:
{ "type": "tool_result", "id": "<call_id>", "error": "user_denied" }

// Permission mode change mid-conversation
{ "type": "update_permission_mode", "mode": "auto" }
```

### Server → Client

```jsonc
{ "type": "stream_chunk", "delta": "..." }
{ "type": "tool_call", "id": "<call_id>", "name": "read_file",
  "params": { "path": "src/Chat.vue" } }
{ "type": "stream_done" }
{ "type": "permission_mode_ack", "mode": "auto" }
{ "type": "error", "code": "...", "message": "..." }
```

## Permission Modes

Switchable any time — including mid-conversation — via a dropdown in the
input bar. The active mode is shown at all times (like Claude Code's "Auto
mode" button). Mode changes take effect on the next tool call.

| Mode | Behaviour |
|---|---|
| **Plan** | Only read tools (`read_file`, `list_dir`, `get_selection`) are executed. Write and run tools are blocked; Holzi receives `{ error: "plan_mode" }` and phrases responses as "I would do X". |
| **Ask before edit** | `write_file`, `apply_diff` show a confirmation dialog with diff preview. `run_command` always asks. |
| **Edit automatically** | `write_file`, `apply_diff` execute without confirmation. `run_command` still asks. |
| **Auto** | All tools execute without confirmation. |

When the user denies a tool call, the extension returns `{ error: "user_denied" }`.
Holzi can then ask for clarification or suggest an alternative.

## VS Code Extension Structure

```
holzi-vscode/
├── src/
│   ├── extension.ts          # Activation, commands, panel lifecycle
│   ├── HolziPanel.ts         # Webview panel + message relay
│   ├── HolziSocket.ts        # WebSocket client, reconnect, protocol
│   ├── tools/
│   │   ├── index.ts          # Tool registry + dispatcher + permission check
│   │   ├── filesystem.ts     # read_file, write_file, list_dir
│   │   ├── terminal.ts       # run_command via child_process
│   │   └── editor.ts         # get_selection, apply_diff, open_file
│   └── webview/
│       ├── index.html
│       ├── main.ts           # Webview-side logic
│       └── style.css         # VS Code CSS variables only
├── package.json
└── tsconfig.json
```

**Local tools:**

| Tool | Implementation |
|---|---|
| `read_file(path)` | `vscode.workspace.fs.readFile` |
| `write_file(path, content)` | `WorkspaceEdit` — shown as diff in editor |
| `list_dir(path)` | `vscode.workspace.fs.readDirectory` |
| `run_command(cmd, cwd)` | `child_process.exec` with output capture |
| `get_selection()` | `activeTextEditor.selection + document.getText(range)` |
| `apply_diff(path, patch)` | `WorkspaceEdit` with unified diff parsing |
| `open_file(path, line)` | `vscode.window.showTextDocument` |

Paths are always resolved relative to the first workspace folder.

## UI Design

VS Code-native look: no custom chrome, no rounded cards, no shadows. Uses VS
Code CSS variables exclusively so Dark/Light/High-Contrast themes work
automatically. Modelled after Claude Code's VS Code extension.

```
┌──────────────────────────────────────────────┐
│                                              │
│  ● read_file src/components/Chat.vue         │  ← collapsible tool call
│                                              │
│  Hier ist mein Vorschlag: ...                │
│                                              │
│  ┌─ write_file src/components/Chat.vue ─────┐│
│  │ +12 / -3 lines  [diff preview]           ││  ← inline diff on "ask" mode
│  │                 [Allow]  [Deny]          ││
│  └───────────────────────────────────────────┘│
│                                              │
├──────────────────────────────────────────────┤
│ [+] [/]  2 lines selected    [Ask ▾]  [➤]   │  ← input bar
└──────────────────────────────────────────────┘
```

- **Model picker**: in conversation header, loads from `GET /api/llm/models`
- **Skills picker**: `@mention` style, activates for this conversation
- **MCP picker**: `#mention` style, activates for this conversation
- **Permission dropdown**: always visible in input bar, switchable mid-chat
- **Tool calls**: collapsible rows while running, expandable for output after
- **Conversation list**: sidebar panel, loads `GET /api/conversations?channel=vscode`

## Holzi Backend Changes

**Status: implemented and merged in PR #82 (squash `2361ebf`, 2026-06-08).**
12 new pytest tests cover the protocol; full suite 1004 passed, ruff + mypy clean.

### New endpoint: `GET /ws/agent`

WebSocket upgrade endpoint. Auth via `Authorization: Bearer <token>` header or
`?token=<token>` query param (same `AUTH_TOKEN` as the REST API).

### New files

```
src/hermes/routes/ws_agent.py      # WebSocket route + WsSession lifecycle
src/hermes/tools/remote.py         # RemoteTool class — delegates to WS client
src/hermes/tools/plan_wrapper.py   # Wraps RemoteTools in plan mode: no exec
```

### RemoteTool

Shipped as `make_remote_tool(name, session)` factory in `src/hermes/tools/remote.py`
(not a `BaseTool` subclass — the codebase's `Tool` dataclass is composed
with a closure-based handler). Sends a `tool_call` message over the WS,
awaits the matching `tool_result` with a 30s timeout, returns the result string.

```python
def make_remote_tool(name: str, session: WsSession) -> Tool:
    async def handler(params: dict[str, Any]) -> str:
        call_id = uuid4().hex
        await session.ws.send_json(
            {"type": "tool_call", "id": call_id, "name": name, "params": params}
        )
        return await session.wait_for_result(call_id, timeout=30.0)
    return Tool(name=name, ..., handler=handler)
```

Remote tools are registered dynamically per session from `start_session.tools`.
They are invisible to other sessions.

### Permission mode in agent

The session stores `permission_mode`. In `plan` mode, all `RemoteTool` calls
are replaced by a `PlanOnlyWrapper` that returns a description string instead
of executing — Holzi phrases responses as "I would do X".

`update_permission_mode` messages update the session state immediately and
Holzi acknowledges with `permission_mode_ack`.

## Acceptance Criteria

- Extension connects to holzi.haex.cloud, model can be chosen per conversation
- Skills and MCPs can be activated per conversation
- Permission mode is switchable at any time including mid-conversation
- `write_file` / `apply_diff` show diff preview and require confirmation in Ask mode
- `run_command` output is captured and shown in the tool call row
- Conversations appear in Holzi web UI under channel `vscode`
- Plan mode blocks all writes/runs; Holzi describes what it would do instead
- VS Code theme variables used throughout — works in Dark, Light, High Contrast

## Out of Scope

- Voice input
- Image attachments
- Notebook support
- Multi-root workspace (single workspace folder only for now)
