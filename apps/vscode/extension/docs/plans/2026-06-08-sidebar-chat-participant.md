# Sidebar + VS Code Chat Participant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an Activity Bar sidebar with chat history, a `@holzi` VS Code Chat participant, and auth/server configuration commands.

**Architecture:** Three independent additions wired together in `extension.ts`: (1) `HolziSidebarProvider` as a `WebviewViewProvider` managing session metadata in `globalState`, (2) `HolziChatParticipant` bridging the VS Code Chat API to `HolziSocket`+`ToolRegistry`, (3) two commands (`holzi.configure`, `holzi.login`) + a status bar item. Each component reads VS Code config (`holzi.host`, `holzi.token`) independently on construction.

**Tech Stack:** TypeScript, VS Code Extension API (≥1.90), `vscode.chat`, `vscode.WebviewViewProvider`, `vscode.StatusBarItem`, existing `HolziSocket` + `ToolRegistry`.

---

## Task 1: Activity Bar SVG icon

**Files:**
- Create: `images/icon.svg`

**Step 1: Create the SVG**

Create `images/icon.svg` — a simple "H" lettermark that renders well at 24×24:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <line x1="5" y1="4" x2="5" y2="20"/>
  <line x1="19" y1="4" x2="19" y2="20"/>
  <line x1="5" y1="12" x2="19" y2="12"/>
</svg>
```

VS Code renders activity bar icons in `currentColor` — the SVG must use `stroke="currentColor"` or `fill="currentColor"`, not hardcoded colors.

**Step 2: Commit**

```bash
git add images/icon.svg
git commit -m "feat: add activity bar SVG icon"
```

---

## Task 2: package.json — new contributions

**Files:**
- Modify: `package.json`

**Step 1: Bump engine version and add all new contributions**

Change `"engines": { "vscode": "^1.85.0" }` → `"^1.90.0"` (required for `vscode.chat` API).

Add to `contributes`:

```json
"viewsContainers": {
  "activitybar": [
    {
      "id": "holzi-sidebar",
      "title": "Holzi",
      "icon": "images/icon.svg"
    }
  ]
},
"views": {
  "holzi-sidebar": [
    {
      "type": "webview",
      "id": "holzi.sidebarView",
      "name": "Chats"
    }
  ]
},
"chatParticipants": [
  {
    "id": "holzi.chat",
    "fullName": "Holzi",
    "name": "holzi",
    "description": "Holzi AI Assistant",
    "isSticky": true
  }
]
```

Add to `contributes.commands`:

```json
{ "command": "holzi.configure", "title": "Holzi: Configure Server" },
{ "command": "holzi.login",     "title": "Holzi: Sign In" }
```

**Step 2: Verify JSON is valid**

```bash
node -e "require('./package.json')" && echo "valid"
```

Expected: `valid`

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add sidebar, chat participant, and auth command contributions to package.json"
```

---

## Task 3: Session merge utility (with tests)

**Files:**
- Create: `src/sessionUtils.ts`
- Create: `tests/sessionUtils.test.ts`

**Step 1: Write failing tests**

Create `tests/sessionUtils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mergeSessions, type SessionMeta } from '../src/sessionUtils'

const s = (id: string, updatedAt: number): SessionMeta =>
  ({ id, title: `Chat ${id}`, lastMessage: 'hello', updatedAt })

describe('mergeSessions', () => {
  it('returns empty array for empty inputs', () => {
    expect(mergeSessions([], [])).toEqual([])
  })

  it('returns local sessions when no remote', () => {
    const local = [s('a', 1), s('b', 2)]
    expect(mergeSessions(local, [])).toHaveLength(2)
  })

  it('remote wins on conflict', () => {
    const local = [s('a', 1)]
    const remote = [{ id: 'a', title: 'Updated', lastMessage: 'new', updatedAt: 2 }]
    const result = mergeSessions(local, remote)
    expect(result[0].title).toBe('Updated')
  })

  it('local-only sessions are preserved', () => {
    const local = [s('local-only', 1)]
    const remote = [s('remote-only', 2)]
    const result = mergeSessions(local, remote)
    expect(result.map(r => r.id)).toContain('local-only')
    expect(result.map(r => r.id)).toContain('remote-only')
  })

  it('sorts by updatedAt descending', () => {
    const local = [s('a', 1), s('b', 3)]
    const remote = [s('c', 2)]
    const result = mergeSessions(local, remote)
    expect(result.map(r => r.id)).toEqual(['b', 'c', 'a'])
  })
})
```

**Step 2: Run to verify tests fail**

```bash
npm test -- tests/sessionUtils.test.ts
```

Expected: FAIL — `Cannot find module '../src/sessionUtils'`

**Step 3: Implement**

Create `src/sessionUtils.ts`:

```typescript
export type SessionMeta = {
  id: string
  title: string
  lastMessage: string
  updatedAt: number
}

export function mergeSessions(local: SessionMeta[], remote: SessionMeta[]): SessionMeta[] {
  const map = new Map<string, SessionMeta>()
  for (const s of local) map.set(s.id, s)
  for (const s of remote) map.set(s.id, s)
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}
```

**Step 4: Run tests**

```bash
npm test -- tests/sessionUtils.test.ts
```

Expected: 5 passing

**Step 5: Commit**

```bash
git add src/sessionUtils.ts tests/sessionUtils.test.ts
git commit -m "feat: add session metadata type and merge utility"
```

---

## Task 4: HolziSidebarProvider

**Files:**
- Create: `src/HolziSidebarProvider.ts`

**Step 1: Implement**

Create `src/HolziSidebarProvider.ts`:

```typescript
import * as vscode from 'vscode'
import { mergeSessions, type SessionMeta } from './sessionUtils'

const CACHE_KEY = 'holzi.sessions'

export class HolziSidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.onDidReceiveMessage((msg: any) => this._handleMessage(msg))
    this._render()
    this._syncSessions()
  }

  refresh(): void {
    if (this.view) {
      this._render()
      this._syncSessions()
    }
  }

  private _sessions(): SessionMeta[] {
    return this.context.globalState.get<SessionMeta[]>(CACHE_KEY) ?? []
  }

  private async _syncSessions(): Promise<void> {
    const config = vscode.workspace.getConfiguration('holzi')
    const host = (config.get<string>('host') ?? '').replace(/\/$/, '')
    const token = config.get<string>('token') ?? ''
    if (!host || !token) return

    try {
      const res = await fetch(`${host}/api/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const remote = await res.json() as SessionMeta[]
      const merged = mergeSessions(this._sessions(), remote)
      await this.context.globalState.update(CACHE_KEY, merged)
      this._render()
    } catch {
      // network unavailable — keep local cache
    }
  }

  private _handleMessage(msg: any): void {
    switch (msg.type) {
      case 'new_chat':
        vscode.commands.executeCommand('holzi.openChat')
        break
      case 'open_session':
        vscode.commands.executeCommand('holzi.openChat', msg.id as string)
        break
      case 'sign_in':
        vscode.commands.executeCommand('holzi.login')
        break
      case 'configure':
        vscode.commands.executeCommand('holzi.configure')
        break
    }
  }

  private _render(): void {
    if (!this.view) return
    const config = vscode.workspace.getConfiguration('holzi')
    const host = config.get<string>('host') ?? ''
    const token = config.get<string>('token') ?? ''
    const sessions = this._sessions()
    this.view.webview.html = this._buildHtml(host, token, sessions)
  }

  private _buildHtml(host: string, token: string, sessions: SessionMeta[]): string {
    const notConfigured = !host || !token
    const sessionItems = sessions.map(s => {
      const date = new Date(s.updatedAt).toLocaleDateString()
      const preview = s.lastMessage.slice(0, 60)
      return `<li class="session" data-id="${escapeAttr(s.id)}">
        <div class="session-title">${escapeHtml(s.title)}</div>
        <div class="session-preview">${escapeHtml(preview)}</div>
        <div class="session-date">${escapeHtml(date)}</div>
      </li>`
    }).join('')

    const body = notConfigured
      ? `<div class="empty">
           <p>Not connected to a Holzi server.</p>
           <button id="btn-signin">Sign In</button>
           <button id="btn-configure">Configure Server</button>
         </div>`
      : `<button id="btn-new">+ New Chat</button>
         ${sessions.length === 0
           ? '<p class="empty">No chats yet.</p>'
           : `<ul class="sessions">${sessionItems}</ul>`
         }`

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"/>
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px; margin: 0; }
  button { width: 100%; padding: 6px; margin-bottom: 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; border-radius: 2px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  ul.sessions { list-style: none; padding: 0; margin: 0; }
  li.session { padding: 6px; cursor: pointer; border-radius: 2px; margin-bottom: 2px; }
  li.session:hover { background: var(--vscode-list-hoverBackground); }
  .session-title { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .session-preview { font-size: 0.85em; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .session-date { font-size: 0.75em; opacity: 0.5; }
  .empty { text-align: center; opacity: 0.7; margin-top: 16px; }
  p.empty { text-align: center; opacity: 0.7; }
  #btn-configure { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style>
</head>
<body>
${body}
<script>
  const vscode = acquireVsCodeApi()
  document.getElementById('btn-new')?.addEventListener('click', () => vscode.postMessage({ type: 'new_chat' }))
  document.getElementById('btn-signin')?.addEventListener('click', () => vscode.postMessage({ type: 'sign_in' }))
  document.getElementById('btn-configure')?.addEventListener('click', () => vscode.postMessage({ type: 'configure' }))
  document.querySelectorAll('.session').forEach(el => {
    el.addEventListener('click', () => vscode.postMessage({ type: 'open_session', id: el.dataset.id }))
  })
</script>
</body>
</html>`
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /path/to/worktree && npm run compile 2>&1 | head -30
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/HolziSidebarProvider.ts
git commit -m "feat: add HolziSidebarProvider with session list and local cache"
```

---

## Task 5: HolziChatParticipant

**Files:**
- Create: `src/HolziChatParticipant.ts`

**Step 1: Implement**

Create `src/HolziChatParticipant.ts`:

```typescript
import * as vscode from 'vscode'
import { HolziSocket } from './HolziSocket'
import { ToolRegistry, PermissionMode } from './tools/index'
import { readFile, writeFile, listDir } from './tools/filesystem'
import { runCommand } from './tools/terminal'
import { getSelection, applyDiff, openFile } from './tools/editor'
import type { ServerMessage, ClientMessage } from './HolziSocket'

const ALL_TOOLS = ['read_file', 'write_file', 'list_dir', 'run_command',
                   'get_selection', 'apply_diff', 'open_file']

export function registerChatParticipant(context: vscode.ExtensionContext): void {
  // vscode.chat is only available in VS Code 1.90+
  if (!('chat' in vscode)) return

  const participant = (vscode as any).chat.createChatParticipant(
    'holzi.chat',
    async (
      request: any,
      chatContext: any,
      stream: any,
      token: vscode.CancellationToken,
    ) => {
      const config = vscode.workspace.getConfiguration('holzi')
      const host = (config.get<string>('host') ?? '').replace(/\/$/, '')
      const holziToken = config.get<string>('token') ?? ''

      if (!host || !holziToken) {
        stream.markdown('**Holzi not configured.** Run `Holzi: Configure Server` and `Holzi: Sign In` first.')
        return
      }

      const wsUrl = host.replace(/^http/, 'ws') + '/ws/agent'
      const socket = new HolziSocket(wsUrl, holziToken)
      const registry = new ToolRegistry()
      _registerTools(registry, stream)

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.disconnect()
          reject(new Error('Connection timeout'))
        }, 10000)

        socket.on('connected', () => {
          clearTimeout(timeout)

          // Build context from active editor
          const editor = vscode.window.activeTextEditor
          const ctx: Record<string, string | undefined> = {}
          if (editor) {
            ctx.active_file = editor.document.uri.fsPath
            const sel = editor.selection
            if (!sel.isEmpty) {
              ctx.selection = editor.document.getText(sel)
            }
          }

          socket.send({
            type: 'start_session',
            model: '',
            skills: [],
            permission_mode: registry.getPermissionMode(),
            tools: ALL_TOOLS,
          })

          socket.send({
            type: 'message',
            content: request.prompt as string,
            context: ctx,
          })
        })

        socket.on('message', async (msg: ServerMessage) => {
          if (token.isCancellationRequested) {
            socket.disconnect()
            resolve()
            return
          }

          switch (msg.type) {
            case 'stream_chunk':
              stream.markdown(msg.delta)
              break

            case 'stream_done':
              socket.disconnect()
              resolve()
              break

            case 'tool_call': {
              stream.progress(`Running: ${msg.name}`)
              const result = await registry.execute(msg.name, msg.params as Record<string, unknown>)
              const denied = 'error' in result && result.error === 'user_denied'
              const wire: ClientMessage = denied
                ? { type: 'tool_result', id: msg.id, error: 'user_denied' }
                : { type: 'tool_result', id: msg.id, result: 'result' in result ? result.result : result.error }
              socket.send(wire)
              break
            }

            case 'error':
              stream.markdown(`**Error:** ${msg.message}`)
              socket.disconnect()
              resolve()
              break
          }
        })

        socket.on('error', () => {
          clearTimeout(timeout)
          socket.disconnect()
          reject(new Error('Socket error'))
        })

        socket.connect()
      }).catch((err: Error) => {
        stream.markdown(`**Connection failed:** ${err.message}`)
      })
    },
  )

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')
  context.subscriptions.push(participant)
}

function _registerTools(registry: ToolRegistry, stream: any): void {
  registry.register('read_file', readFile)
  registry.register('write_file', writeFile)
  registry.register('list_dir', listDir)
  registry.register('run_command', runCommand)
  registry.register('get_selection', getSelection)
  registry.register('apply_diff', applyDiff)
  registry.register('open_file', openFile)
  registry.setPermissionMode(PermissionMode.Ask)

  registry.setConfirmFn(async (toolName, params) => {
    const preview = toolName === 'apply_diff' && typeof params.patch === 'string'
      ? `\n\`\`\`diff\n${params.patch}\n\`\`\``
      : ''
    const answer = await vscode.window.showWarningMessage(
      `Holzi wants to run: ${toolName}${preview}`,
      { modal: true },
      'Allow',
      'Deny',
    )
    return answer === 'Allow'
  })
}
```

**Step 2: Compile**

```bash
npm run compile 2>&1 | head -30
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/HolziChatParticipant.ts
git commit -m "feat: add HolziChatParticipant bridging VS Code Chat API to HolziSocket"
```

---

## Task 6: Wire everything in extension.ts

**Files:**
- Modify: `src/extension.ts`

**Step 1: Replace extension.ts**

```typescript
import * as vscode from 'vscode'
import { HolziPanel } from './HolziPanel'
import { HolziSidebarProvider } from './HolziSidebarProvider'
import { registerChatParticipant } from './HolziChatParticipant'

export function activate(context: vscode.ExtensionContext): void {
  // Sidebar
  const sidebarProvider = new HolziSidebarProvider(context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('holzi.sidebarView', sidebarProvider),
  )

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.text = '$(plug) Holzi'
  statusBar.tooltip = 'Holzi: click to sign in'
  statusBar.command = 'holzi.login'
  statusBar.show()
  context.subscriptions.push(statusBar)

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('holzi.openChat', (sessionId?: string) => {
      HolziPanel.createOrShow(context, sessionId)
    }),

    vscode.commands.registerCommand('holzi.configure', async () => {
      const config = vscode.workspace.getConfiguration('holzi')
      const current = config.get<string>('host') ?? 'https://holzi.haex.cloud'
      const value = await vscode.window.showInputBox({
        title: 'Holzi: Configure Server',
        prompt: 'Enter Holzi server URL',
        value: current,
        validateInput: v => v.startsWith('http') ? null : 'Must start with http:// or https://',
      })
      if (value !== undefined) {
        await config.update('host', value.replace(/\/$/, ''), vscode.ConfigurationTarget.Global)
        vscode.window.showInformationMessage(`Holzi server set to ${value}`)
        sidebarProvider.refresh()
      }
    }),

    vscode.commands.registerCommand('holzi.login', async () => {
      const config = vscode.workspace.getConfiguration('holzi')
      const value = await vscode.window.showInputBox({
        title: 'Holzi: Sign In',
        prompt: 'Enter your Bearer token',
        password: true,
        placeHolder: 'Paste token here',
      })
      if (value !== undefined && value.trim() !== '') {
        await config.update('token', value.trim(), vscode.ConfigurationTarget.Global)
        statusBar.text = '$(check) Holzi'
        statusBar.tooltip = 'Holzi: connected'
        statusBar.command = undefined
        vscode.window.showInformationMessage('Holzi: signed in.')
        sidebarProvider.refresh()
      }
    }),
  )

  // Chat participant (@holzi in VS Code Chat panel)
  registerChatParticipant(context)
}

export function deactivate(): void {}
```

**Step 2: Run all tests**

```bash
npm test
```

Expected: 39 tests passing (no regressions — new code is VS Code API-dependent and not unit tested)

**Step 3: Compile**

```bash
npm run compile
```

Expected: no errors

**Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire sidebar, auth commands, status bar, and chat participant in extension.ts"
```

---

## Task 7: Build and package

**Files:**
- No changes

**Step 1: Full compile**

```bash
npm run compile && npm run compile:webview
```

Expected: no errors

**Step 2: Run all tests**

```bash
npm test
```

Expected: all passing

**Step 3: Package VSIX**

```bash
npm run package
```

Expected: `holzi-vscode-0.1.2.vsix` created (or similar)

**Step 4: Bump version in package.json**

Change `"version": "0.1.1"` → `"0.1.2"`.

**Step 5: Commit**

```bash
git add package.json
git commit -m "chore: bump to v0.1.2"
```

---

## Manual Verification Checklist

After packaging and installing the VSIX:

- [ ] Holzi icon appears in Activity Bar (left sidebar)
- [ ] Clicking icon opens sidebar showing "Not connected" + Sign In / Configure buttons (if no token set)
- [ ] `Holzi: Configure Server` command sets `holzi.host` via input box
- [ ] `Holzi: Sign In` command sets `holzi.token` via masked input box
- [ ] After sign in, status bar changes from plug icon to check icon
- [ ] After sign in, sidebar shows session list (or "No chats yet" if empty)
- [ ] "New Chat" button in sidebar opens the chat panel
- [ ] `@holzi` appears in VS Code Chat panel (Ctrl+Alt+I or the chat icon)
- [ ] Sending a message to `@holzi` streams a response
