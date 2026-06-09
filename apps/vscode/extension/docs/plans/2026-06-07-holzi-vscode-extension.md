# Holzi VS Code Extension — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a VS Code extension that connects to holzi.haex.cloud via WebSocket, executes local file/CLI tools on behalf of the Holzi agent, and renders a native VS Code chat UI.

**Architecture:** The extension host (Node.js) owns the WebSocket connection to Holzi and executes all local tools. The webview (browser sandbox) renders the chat UI and communicates with the extension host via VS Code's `postMessage` API. Tool execution with permission prompts happens in the extension host — the webview only shows previews.

**Tech Stack:** TypeScript, VS Code Extension API, `ws` npm package (WS in extension host), `diff` npm package (unified diff parsing), Vitest + mocked vscode API (unit tests), vanilla TS + VS Code CSS vars (webview)

---

## Pre-flight

Before starting, verify the toolchain:

```bash
cd /home/haex/Projekte/holzi-vscode
node --version   # need 18+
npm --version
code --version
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.test.json`
- Create: `.gitignore`
- Create: `.vscodeignore`
- Create: `vitest.config.ts`

**Step 1: Create package.json**

```json
{
  "name": "holzi-vscode",
  "displayName": "Holzi",
  "description": "Holzi AI assistant in VS Code",
  "version": "0.1.0",
  "publisher": "haex",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["AI"],
  "activationEvents": ["onCommand:holzi.openChat"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      { "command": "holzi.openChat", "title": "Holzi: Open Chat" }
    ],
    "configuration": {
      "title": "Holzi",
      "properties": {
        "holzi.host": {
          "type": "string",
          "default": "https://holzi.haex.cloud",
          "description": "Holzi server URL"
        },
        "holzi.token": {
          "type": "string",
          "description": "Auth token (Bearer)"
        }
      }
    }
  },
  "scripts": {
    "compile": "tsc -p tsconfig.json",
    "watch": "tsc -p tsconfig.json --watch",
    "compile:webview": "tsc -p tsconfig.webview.json",
    "test": "vitest run",
    "mock-server": "npx ts-node mock-server/index.ts",
    "package": "npx @vscode/vsce package"
  },
  "dependencies": {
    "diff": "^5.2.0",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/diff": "^5.2.1",
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "@types/ws": "^8.5.10",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@vscode/vsce": "^2.24.0",
    "ts-node": "^10.9.2"
  }
}
```

**Step 2: Create tsconfig.json** (extension host — Node.js)

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "out",
    "rootDir": "src",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/webview/**", "node_modules"]
}
```

**Step 3: Create tsconfig.webview.json** (webview — browser context, no vscode API)

```json
{
  "compilerOptions": {
    "module": "ES2020",
    "target": "ES2020",
    "outDir": "out/webview",
    "rootDir": "src/webview",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": false
  },
  "include": ["src/webview/**/*.ts"]
}
```

**Step 4: Create tsconfig.test.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "paths": {
      "vscode": ["./tests/__mocks__/vscode.ts"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

**Step 5: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      'vscode': new URL('./tests/__mocks__/vscode.ts', import.meta.url).pathname,
    },
  },
})
```

**Step 6: Create .gitignore**

```
out/
node_modules/
*.vsix
.vscode-test/
```

**Step 7: Create .vscodeignore**

```
**/*.ts
!out/**
node_modules/
src/
tests/
mock-server/
docs/
tsconfig*.json
vitest.config.ts
```

**Step 8: Install deps and verify compile**

```bash
cd /home/haex/Projekte/holzi-vscode
npm install
npx tsc -p tsconfig.json --noEmit
```

Expected: no errors (only missing source files, which is fine).

**Step 9: Commit**

```bash
git init
git add -A
git commit -m "chore: project scaffold for holzi-vscode"
```

---

## Task 2: VS Code Mock + Test Infrastructure

These mocks let unit tests import `vscode` without launching a real VS Code instance.

**Files:**
- Create: `tests/__mocks__/vscode.ts`

**Step 1: Write the vscode mock**

```typescript
// tests/__mocks__/vscode.ts
import { vi } from 'vitest'

export enum Uri {
  file = 'file',
}
export const Uri_static = {
  file: (path: string) => ({ fsPath: path, scheme: 'file', path }),
  joinPath: (base: any, ...parts: string[]) => ({
    fsPath: [base.fsPath, ...parts].join('/'),
    scheme: 'file',
    path: [base.path, ...parts].join('/'),
  }),
}
// Attach static methods to export
Object.assign(Uri, Uri_static)

export const workspace = {
  workspaceFolders: [{ uri: { fsPath: '/workspace', path: '/workspace' } }],
  fs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readDirectory: vi.fn(),
  },
  applyEdit: vi.fn().mockResolvedValue(true),
}

export const window = {
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  createWebviewPanel: vi.fn(),
  activeTextEditor: undefined as any,
  showTextDocument: vi.fn(),
}

export class WorkspaceEdit {
  private edits: any[] = []
  replace(uri: any, range: any, newText: string) {
    this.edits.push({ uri, range, newText })
  }
  insert(uri: any, position: any, newText: string) {
    this.edits.push({ uri, position, newText })
  }
  createFile(uri: any, opts?: any) {
    this.edits.push({ createFile: uri, opts })
  }
  getEdits() { return this.edits }
}

export class Range {
  constructor(
    public start: Position,
    public end: Position,
  ) {}
}

export class Position {
  constructor(public line: number, public character: number) {}
}

export const ViewColumn = { One: 1, Two: 2, Beside: -2 }

export const ExtensionContext = {}
```

**Step 2: Write a smoke test**

Create `tests/mock.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import * as vscode from 'vscode'

describe('vscode mock', () => {
  it('has workspace.fs', () => {
    expect(vscode.workspace.fs.readFile).toBeDefined()
  })
})
```

**Step 3: Run tests**

```bash
cd /home/haex/Projekte/holzi-vscode
npm test
```

Expected: 1 test passes.

**Step 4: Commit**

```bash
git add -A
git commit -m "test: vscode mock and test infrastructure"
```

---

## Task 3: Mock WebSocket Server

The mock server simulates Holzi's backend for local development. It lives in `mock-server/index.ts` and is NOT bundled into the extension.

**Files:**
- Create: `mock-server/index.ts`

**Step 1: Write the mock server**

```typescript
// mock-server/index.ts
import { WebSocketServer, WebSocket } from 'ws'

const PORT = 3333
const wss = new WebSocketServer({ port: PORT })
console.log(`[mock] listening on ws://localhost:${PORT}`)

wss.on('connection', (ws: WebSocket) => {
  console.log('[mock] client connected')
  let sessionReady = false

  ws.on('message', async (raw: Buffer) => {
    const msg = JSON.parse(raw.toString())
    console.log('[mock] ←', JSON.stringify(msg))

    if (msg.type === 'start_session') {
      sessionReady = true
      console.log('[mock] session started, tools:', msg.tools)
      return
    }

    if (msg.type === 'message' && sessionReady) {
      // Simulate: inject a tool_call first, then stream text
      const callId = `call_${Date.now()}`

      // tool_call
      ws.send(JSON.stringify({
        type: 'tool_call',
        id: callId,
        name: 'read_file',
        params: { path: 'src/extension.ts' },
      }))

      // Wait for tool_result
      const result = await waitForResult(ws, callId)
      console.log('[mock] tool result received:', result)

      // Stream a reply
      const reply = `I read the file. Here's what I found based on your message: "${msg.content}"`
      for (const chunk of chunkString(reply, 10)) {
        ws.send(JSON.stringify({ type: 'stream_chunk', delta: chunk }))
        await sleep(50)
      }
      ws.send(JSON.stringify({ type: 'stream_done' }))
      return
    }

    if (msg.type === 'update_permission_mode') {
      ws.send(JSON.stringify({ type: 'permission_mode_ack', mode: msg.mode }))
      return
    }
  })

  ws.on('close', () => console.log('[mock] client disconnected'))
})

function waitForResult(ws: WebSocket, callId: string): Promise<any> {
  return new Promise((resolve) => {
    const handler = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'tool_result' && msg.id === callId) {
        ws.off('message', handler)
        resolve(msg.result ?? msg.error)
      }
    }
    ws.on('message', handler)
  })
}

function chunkString(s: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < s.length; i += size) chunks.push(s.slice(i, i + size))
  return chunks
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}
```

**Step 2: Verify the mock server starts**

```bash
cd /home/haex/Projekte/holzi-vscode
npx ts-node mock-server/index.ts &
sleep 1
# Connect with wscat (install if needed: npm i -g wscat)
# echo '{"type":"start_session","model":"test","skills":[],"permission_mode":"ask","tools":["read_file"]}' | wscat -c ws://localhost:3333
echo "mock server running, kill with: kill %1"
kill %1
```

Expected: `[mock] listening on ws://localhost:3333` then exits.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: mock WebSocket server for local development"
```

---

## Task 4: HolziSocket — WebSocket Client

**Files:**
- Create: `src/HolziSocket.ts`
- Create: `tests/HolziSocket.test.ts`

**Step 1: Write the failing test first**

```typescript
// tests/HolziSocket.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { HolziSocket, ServerMessage } from '../src/HolziSocket'

describe('HolziSocket', () => {
  let wss: WebSocketServer
  let port: number

  beforeAll(async () => {
    wss = new WebSocketServer({ port: 0 })
    port = (wss.address() as any).port
  })

  afterAll(() => wss.close())

  it('emits stream_chunk messages', async () => {
    const received: ServerMessage[] = []
    const socket = new HolziSocket(`ws://localhost:${port}`, 'test-token')
    socket.on('message', (m) => received.push(m))

    await new Promise<void>((resolve) => {
      wss.once('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'stream_chunk', delta: 'hello' }))
        setTimeout(resolve, 100)
      })
      socket.connect()
    })

    socket.disconnect()
    expect(received).toContainEqual({ type: 'stream_chunk', delta: 'hello' })
  })

  it('sends messages as JSON', async () => {
    const serverReceived: any[] = []
    const socket = new HolziSocket(`ws://localhost:${port}`, 'test-token')

    await new Promise<void>((resolve) => {
      wss.once('connection', (ws) => {
        ws.on('message', (raw) => {
          serverReceived.push(JSON.parse(raw.toString()))
          resolve()
        })
        socket.send({ type: 'message', content: 'hi', context: {} })
      })
      socket.connect()
    })

    socket.disconnect()
    expect(serverReceived[0]).toMatchObject({ type: 'message', content: 'hi' })
  })
})
```

**Step 2: Run test — expect FAIL**

```bash
npm test -- tests/HolziSocket.test.ts
```

Expected: FAIL with "Cannot find module '../src/HolziSocket'"

**Step 3: Implement HolziSocket.ts**

```typescript
// src/HolziSocket.ts
import WebSocket from 'ws'
import { EventEmitter } from 'events'

export type ClientMessage =
  | { type: 'start_session'; model: string; skills: string[]; permission_mode: string; tools: string[] }
  | { type: 'message'; content: string; context: Record<string, string | undefined> }
  | { type: 'tool_result'; id: string; result?: string; error?: string }
  | { type: 'update_permission_mode'; mode: string }

export type ServerMessage =
  | { type: 'stream_chunk'; delta: string }
  | { type: 'tool_call'; id: string; name: string; params: Record<string, unknown> }
  | { type: 'stream_done' }
  | { type: 'permission_mode_ack'; mode: string }
  | { type: 'error'; code: string; message: string }

export class HolziSocket extends EventEmitter {
  private ws: WebSocket | null = null
  private reconnectDelay = 1000
  private maxDelay = 30000
  private shouldReconnect = true
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private url: string, private token: string) {
    super()
  }

  connect(): void {
    this.shouldReconnect = true
    this._open()
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private _open(): void {
    const wsUrl = this.url.replace(/^http/, 'ws')
    this.ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${this.token}` } })

    this.ws.on('open', () => {
      this.reconnectDelay = 1000
      this.emit('connected')
    })

    this.ws.on('message', (raw: Buffer) => {
      try {
        const msg: ServerMessage = JSON.parse(raw.toString())
        this.emit('message', msg)
      } catch {
        // ignore malformed frames
      }
    })

    this.ws.on('close', () => {
      this.emit('disconnected')
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this._open(), this.reconnectDelay)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay)
      }
    })

    this.ws.on('error', (err) => this.emit('error', err))
  }
}
```

**Step 4: Run tests — expect PASS**

```bash
npm test -- tests/HolziSocket.test.ts
```

Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: HolziSocket WebSocket client with reconnect"
```

---

## Task 5: Tool Registry and Permission Mode

**Files:**
- Create: `src/tools/index.ts`
- Create: `tests/tools.permission.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/tools.permission.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ToolRegistry, PermissionMode } from '../src/tools/index'

describe('ToolRegistry permission mode', () => {
  it('plan mode blocks write_file', async () => {
    const registry = new ToolRegistry()
    registry.setPermissionMode(PermissionMode.Plan)
    registry.register('write_file', async () => 'written')

    const result = await registry.execute('write_file', { path: 'x', content: 'y' })
    expect(result).toEqual({ error: 'plan_mode' })
  })

  it('plan mode allows read_file', async () => {
    const registry = new ToolRegistry()
    registry.setPermissionMode(PermissionMode.Plan)
    registry.register('read_file', async () => 'file content')

    const result = await registry.execute('read_file', { path: 'x' })
    expect(result).toEqual({ result: 'file content' })
  })

  it('auto mode executes without asking', async () => {
    const registry = new ToolRegistry()
    registry.setPermissionMode(PermissionMode.Auto)
    registry.register('run_command', async () => 'output')

    const result = await registry.execute('run_command', { cmd: 'ls' })
    expect(result).toEqual({ result: 'output' })
  })

  it('unknown tool returns error', async () => {
    const registry = new ToolRegistry()
    const result = await registry.execute('unknown_tool', {})
    expect(result).toEqual({ error: 'unknown_tool' })
  })
})
```

**Step 2: Run test — expect FAIL**

```bash
npm test -- tests/tools.permission.test.ts
```

**Step 3: Implement tools/index.ts**

```typescript
// src/tools/index.ts

export enum PermissionMode {
  Plan = 'plan',
  Ask = 'ask',
  AutoEdit = 'auto_edit',
  Auto = 'auto',
}

const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir', 'get_selection'])
const WRITE_TOOLS = new Set(['write_file', 'apply_diff'])
const RUN_TOOLS = new Set(['run_command'])

export type ToolResult = { result: string } | { error: string }

type ToolFn = (params: Record<string, unknown>) => Promise<string>

// confirmFn is injected by the extension host (shows VS Code UI)
export type ConfirmFn = (
  toolName: string,
  params: Record<string, unknown>,
) => Promise<boolean>

export class ToolRegistry {
  private tools = new Map<string, ToolFn>()
  private mode: PermissionMode = PermissionMode.Ask
  private confirmFn: ConfirmFn = async () => true

  setPermissionMode(mode: PermissionMode): void {
    this.mode = mode
  }

  getPermissionMode(): PermissionMode {
    return this.mode
  }

  setConfirmFn(fn: ConfirmFn): void {
    this.confirmFn = fn
  }

  register(name: string, fn: ToolFn): void {
    this.tools.set(name, fn)
  }

  async execute(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const fn = this.tools.get(name)
    if (!fn) return { error: 'unknown_tool' }

    // Plan mode: only read-only tools allowed
    if (this.mode === PermissionMode.Plan && !READ_ONLY_TOOLS.has(name)) {
      return { error: 'plan_mode' }
    }

    // Ask mode: write tools and run tools need confirmation
    if (this.mode === PermissionMode.Ask) {
      if (WRITE_TOOLS.has(name) || RUN_TOOLS.has(name)) {
        const allowed = await this.confirmFn(name, params)
        if (!allowed) return { error: 'user_denied' }
      }
    }

    // AutoEdit mode: write tools run freely, run tools still ask
    if (this.mode === PermissionMode.AutoEdit && RUN_TOOLS.has(name)) {
      const allowed = await this.confirmFn(name, params)
      if (!allowed) return { error: 'user_denied' }
    }

    try {
      const result = await fn(params)
      return { result }
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
}
```

**Step 4: Run tests — expect PASS**

```bash
npm test -- tests/tools.permission.test.ts
```

Expected: 4 tests pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: tool registry with permission mode enforcement"
```

---

## Task 6: Filesystem Tools

**Files:**
- Create: `src/tools/filesystem.ts`
- Create: `tests/tools.filesystem.test.ts`

**Step 1: Write failing tests**

```typescript
// tests/tools.filesystem.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from 'vscode'
import { readFile, writeFile, listDir } from '../src/tools/filesystem'

describe('filesystem tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset workspace folders
    ;(vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace', path: '/workspace' } },
    ]
  })

  it('read_file returns utf-8 content', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      Buffer.from('hello world'),
    )
    const result = await readFile({ path: 'src/main.ts' })
    expect(result).toBe('hello world')
    expect(vscode.workspace.fs.readFile).toHaveBeenCalledOnce()
  })

  it('list_dir returns formatted entries', async () => {
    vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValue([
      ['src', 2],   // FileType.Directory = 2
      ['README.md', 1],  // FileType.File = 1
    ])
    const result = await listDir({ path: '.' })
    expect(result).toContain('src/')
    expect(result).toContain('README.md')
  })

  it('write_file calls workspace.applyEdit', async () => {
    const result = await writeFile({ path: 'out.txt', content: 'new content' })
    expect(vscode.workspace.applyEdit).toHaveBeenCalledOnce()
    expect(result).toContain('written')
  })
})
```

**Step 2: Run test — expect FAIL**

```bash
npm test -- tests/tools.filesystem.test.ts
```

**Step 3: Implement filesystem.ts**

```typescript
// src/tools/filesystem.ts
import * as vscode from 'vscode'

function resolveWorkspacePath(relPath: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error('no_workspace')
  return vscode.Uri.joinPath(folder.uri, relPath)
}

export async function readFile(params: Record<string, unknown>): Promise<string> {
  const uri = resolveWorkspacePath(params.path as string)
  const bytes = await vscode.workspace.fs.readFile(uri)
  return Buffer.from(bytes).toString('utf-8')
}

export async function writeFile(params: Record<string, unknown>): Promise<string> {
  const uri = resolveWorkspacePath(params.path as string)
  const content = params.content as string
  const edit = new vscode.WorkspaceEdit()
  // Use createFile + replace so the file is created if it doesn't exist
  edit.createFile(uri, { overwrite: true, ignoreIfExists: false })
  edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(9999, 0)), content)
  await vscode.workspace.applyEdit(edit)
  return `written ${uri.fsPath}`
}

export async function listDir(params: Record<string, unknown>): Promise<string> {
  const uri = resolveWorkspacePath(params.path as string)
  const entries = await vscode.workspace.fs.readDirectory(uri)
  return entries
    .map(([name, type]) => (type === 2 ? `${name}/` : name))
    .sort()
    .join('\n')
}
```

**Step 4: Run tests — expect PASS**

```bash
npm test -- tests/tools.filesystem.test.ts
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: filesystem tools (read_file, write_file, list_dir)"
```

---

## Task 7: Terminal Tool

**Files:**
- Create: `src/tools/terminal.ts`
- Create: `tests/tools.terminal.test.ts`

**Step 1: Write failing test**

```typescript
// tests/tools.terminal.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runCommand } from '../src/tools/terminal'

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, opts, cb) => {
    if (cmd === 'echo hello') cb(null, 'hello\n', '')
    else if (cmd === 'fail') cb(new Error('exit 1'), '', 'error output')
    else cb(null, '', '')
  }),
}))

describe('terminal tool', () => {
  it('captures stdout', async () => {
    const result = await runCommand({ cmd: 'echo hello', cwd: '.' })
    expect(result).toContain('hello')
  })

  it('includes stderr on failure', async () => {
    const result = await runCommand({ cmd: 'fail', cwd: '.' })
    expect(result).toContain('error output')
  })
})
```

**Step 2: Run test — expect FAIL**

```bash
npm test -- tests/tools.terminal.test.ts
```

**Step 3: Implement terminal.ts**

```typescript
// src/tools/terminal.ts
import { exec } from 'child_process'
import * as vscode from 'vscode'

export function runCommand(params: Record<string, unknown>): Promise<string> {
  const cmd = params.cmd as string
  const relCwd = (params.cwd as string | undefined) ?? '.'
  const folder = vscode.workspace.workspaceFolders?.[0]
  const cwd = folder ? require('path').join(folder.uri.fsPath, relCwd) : relCwd

  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 30000 }, (_err, stdout, stderr) => {
      const out = [stdout, stderr].filter(Boolean).join('\n').trim()
      resolve(out || '(no output)')
    })
  })
}
```

**Step 4: Run tests — expect PASS**

```bash
npm test -- tests/tools.terminal.test.ts
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: terminal tool (run_command)"
```

---

## Task 8: Editor Tools

**Files:**
- Create: `src/tools/editor.ts`
- Create: `tests/tools.editor.test.ts`

**Step 1: Write failing tests**

```typescript
// tests/tools.editor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as vscode from 'vscode'
import { getSelection, openFile } from '../src/tools/editor'

describe('editor tools', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getSelection returns empty when no editor', async () => {
    ;(vscode.window as any).activeTextEditor = undefined
    const result = await getSelection({})
    expect(result).toBe('')
  })

  it('getSelection returns selected text', async () => {
    ;(vscode.window as any).activeTextEditor = {
      selection: { isEmpty: false },
      document: {
        getText: vi.fn().mockReturnValue('selected code'),
        uri: { fsPath: '/workspace/src/main.ts' },
        fileName: '/workspace/src/main.ts',
      },
    }
    const result = await getSelection({})
    expect(result).toContain('selected code')
  })

  it('openFile calls showTextDocument', async () => {
    ;(vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace', path: '/workspace' } },
    ]
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue(undefined as any)
    await openFile({ path: 'src/main.ts' })
    expect(vscode.window.showTextDocument).toHaveBeenCalledOnce()
  })
})
```

**Step 2: Run test — expect FAIL**

```bash
npm test -- tests/tools.editor.test.ts
```

**Step 3: Implement editor.ts**

```typescript
// src/tools/editor.ts
import * as vscode from 'vscode'
import { applyPatch } from 'diff'

function resolveWorkspacePath(relPath: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error('no_workspace')
  return vscode.Uri.joinPath(folder.uri, relPath)
}

export async function getSelection(_params: Record<string, unknown>): Promise<string> {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.selection.isEmpty) return ''
  const text = editor.document.getText(editor.selection)
  return `${editor.document.fileName}\n${text}`
}

export async function applyDiff(params: Record<string, unknown>): Promise<string> {
  const path = params.path as string
  const patch = params.patch as string
  const uri = resolveWorkspacePath(path)

  const bytes = await vscode.workspace.fs.readFile(uri)
  const original = Buffer.from(bytes).toString('utf-8')
  const patched = applyPatch(original, patch)

  if (patched === false) throw new Error('patch_failed')

  const edit = new vscode.WorkspaceEdit()
  edit.replace(
    uri,
    new vscode.Range(new vscode.Position(0, 0), new vscode.Position(99999, 0)),
    patched,
  )
  await vscode.workspace.applyEdit(edit)
  return `patched ${uri.fsPath}`
}

export async function openFile(params: Record<string, unknown>): Promise<string> {
  const uri = resolveWorkspacePath(params.path as string)
  const doc = await vscode.workspace.openTextDocument(uri)
  const line = (params.line as number | undefined) ?? 0
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.One,
    selection: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0)),
  })
  return `opened ${uri.fsPath}:${line}`
}
```

Note: `vscode.workspace.openTextDocument` needs to be added to the mock if tests fail with "not a function".

**Step 4: Add `openTextDocument` to vscode mock**

In `tests/__mocks__/vscode.ts`, add to `workspace`:
```typescript
openTextDocument: vi.fn().mockResolvedValue({ getText: () => '' }),
```

**Step 5: Run tests — expect PASS**

```bash
npm test -- tests/tools.editor.test.ts
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: editor tools (get_selection, apply_diff, open_file)"
```

---

## Task 9: Webview HTML + CSS

The webview is a browser sandbox. It communicates with the extension host via `acquireVsCodeApi().postMessage`.

**Files:**
- Create: `src/webview/index.html`
- Create: `src/webview/style.css`

**Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-{{NONCE}}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Holzi</title>
  <style>{{STYLES}}</style>
</head>
<body>
  <div id="header">
    <select id="model-picker" title="Model"></select>
    <span id="status-dot" class="dot disconnected" title="Disconnected"></span>
  </div>

  <div id="messages" role="log" aria-live="polite"></div>

  <div id="input-bar">
    <button id="btn-context" title="Add context" aria-label="Add context">+</button>
    <button id="btn-skills" title="Skills (@)" aria-label="Add skill">@</button>
    <div id="input-wrap">
      <textarea id="input" rows="1" placeholder="Message Holzi..." aria-label="Message input"></textarea>
    </div>
    <select id="permission-picker" title="Permission mode" aria-label="Permission mode">
      <option value="plan">Plan</option>
      <option value="ask" selected>Ask</option>
      <option value="auto_edit">Auto Edit</option>
      <option value="auto">Auto</option>
    </select>
    <button id="btn-send" title="Send" aria-label="Send message">➤</button>
  </div>

  <script nonce="{{NONCE}}" src="{{MAIN_JS}}"></script>
</body>
</html>
```

**Step 2: Create style.css** (VS Code CSS vars only)

```css
/* style.css — only var(--vscode-*) colors */
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

#header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

#model-picker {
  flex: 1;
  background: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border);
  padding: 2px 6px;
  font-size: var(--vscode-font-size);
}

.dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot.connected { background: var(--vscode-testing-iconPassed); }
.dot.connecting { background: var(--vscode-charts-yellow); }
.dot.disconnected { background: var(--vscode-testing-iconFailed); }

#messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message {
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.message.user {
  color: var(--vscode-foreground);
  background: var(--vscode-editor-inactiveSelectionBackground);
  padding: 8px 10px;
  border-radius: 4px;
  align-self: flex-end;
  max-width: 85%;
}
.message.assistant { color: var(--vscode-foreground); max-width: 100%; }

/* Tool call rows */
.tool-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-left: 2px solid var(--vscode-panel-border);
  padding-left: 10px;
  font-size: 0.9em;
}
.tool-row .tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  color: var(--vscode-descriptionForeground);
}
.tool-row .tool-header .icon { font-size: 10px; }
.tool-row .tool-name { font-weight: 600; color: var(--vscode-foreground); }
.tool-row .tool-body { display: none; }
.tool-row.expanded .tool-body { display: block; }

/* Diff preview + confirm */
.tool-confirm {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  padding: 8px;
  border-radius: 2px;
}
.diff-preview {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.85em;
  white-space: pre;
  overflow-x: auto;
  max-height: 200px;
  background: var(--vscode-textCodeBlock-background);
  padding: 6px 8px;
  margin-bottom: 8px;
}
.diff-preview .add { color: var(--vscode-gitDecoration-addedResourceForeground); }
.diff-preview .del { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.confirm-buttons { display: flex; gap: 8px; }
.btn-allow, .btn-deny {
  padding: 4px 12px;
  border: none;
  cursor: pointer;
  font-size: var(--vscode-font-size);
}
.btn-allow {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.btn-allow:hover { background: var(--vscode-button-hoverBackground); }
.btn-deny {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

/* Input bar */
#input-bar {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 8px 10px;
  border-top: 1px solid var(--vscode-panel-border);
}

#input-bar button {
  background: transparent;
  border: none;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 4px 6px;
  line-height: 1;
  font-size: 16px;
}
#input-bar button:hover { color: var(--vscode-foreground); }

#input-wrap { flex: 1; }
#input {
  width: 100%;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  padding: 5px 8px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  resize: none;
  max-height: 120px;
  overflow-y: auto;
}
#input:focus { outline: 1px solid var(--vscode-focusBorder); }

#permission-picker {
  background: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border);
  padding: 3px 4px;
  font-size: 0.85em;
}

#btn-send {
  color: var(--vscode-button-foreground) !important;
  background: var(--vscode-button-background) !important;
  padding: 4px 8px !important;
  border-radius: 2px;
}
#btn-send:hover { background: var(--vscode-button-hoverBackground) !important; }
#btn-send:disabled { opacity: 0.5; cursor: default; }
```

No test needed — visual output verified in Task 13 (integration test).

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: webview HTML + CSS (VS Code vars only)"
```

---

## Task 10: Webview main.ts

The webview-side TypeScript. No imports from `vscode` — uses `acquireVsCodeApi()` instead.

**Files:**
- Create: `src/webview/main.ts`

```typescript
// src/webview/main.ts

// Types shared between webview and extension host (copy, not imported)
type ToExtension =
  | { type: 'send_message'; content: string; context: Record<string, string | undefined> }
  | { type: 'set_permission_mode'; mode: string }
  | { type: 'tool_confirm_response'; id: string; allowed: boolean }
  | { type: 'ready' }

type FromExtension =
  | { type: 'stream_chunk'; delta: string }
  | { type: 'stream_done' }
  | { type: 'status'; connected: boolean; connecting: boolean }
  | { type: 'models'; list: Array<{ id: string; display_name: string }> }
  | { type: 'tool_call_display'; id: string; name: string; params: Record<string, unknown> }
  | { type: 'tool_confirm_request'; id: string; name: string; params: Record<string, unknown>; diff?: string }
  | { type: 'tool_result_display'; id: string; result: string; denied: boolean }
  | { type: 'permission_mode_ack'; mode: string }

declare function acquireVsCodeApi(): {
  postMessage(msg: ToExtension): void
}

const vscode = acquireVsCodeApi()

// DOM refs
const messagesEl = document.getElementById('messages')!
const inputEl = document.getElementById('input') as HTMLTextAreaElement
const sendBtn = document.getElementById('btn-send') as HTMLButtonElement
const statusDot = document.getElementById('status-dot')!
const modelPicker = document.getElementById('model-picker') as HTMLSelectElement
const permissionPicker = document.getElementById('permission-picker') as HTMLSelectElement

let currentAssistantEl: HTMLDivElement | null = null

// Send ready
vscode.postMessage({ type: 'ready' })

// Input auto-grow
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto'
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px'
})

// Send on Enter (shift+enter = newline)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    doSend()
  }
})
sendBtn.addEventListener('click', doSend)

permissionPicker.addEventListener('change', () => {
  vscode.postMessage({ type: 'set_permission_mode', mode: permissionPicker.value })
})

function doSend() {
  const content = inputEl.value.trim()
  if (!content) return
  inputEl.value = ''
  inputEl.style.height = 'auto'
  sendBtn.disabled = true

  appendMessage('user', content)

  vscode.postMessage({ type: 'send_message', content, context: {} })
  currentAssistantEl = appendMessage('assistant', '')
}

function appendMessage(role: 'user' | 'assistant', text: string): HTMLDivElement {
  const div = document.createElement('div')
  div.className = `message ${role}`
  div.textContent = text
  messagesEl.appendChild(div)
  div.scrollIntoView({ block: 'end' })
  return div
}

function appendToolRow(id: string, name: string, params: Record<string, unknown>): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'tool-row'
  row.id = `tool-${id}`

  const paramStr = Object.entries(params)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ')

  row.innerHTML = `
    <div class="tool-header" onclick="this.closest('.tool-row').classList.toggle('expanded')">
      <span class="icon">●</span>
      <span class="tool-name">${name}</span>
      <span class="tool-params">${paramStr}</span>
    </div>
    <div class="tool-body"></div>
  `
  messagesEl.appendChild(row)
  row.scrollIntoView({ block: 'end' })
  return row
}

// Message handler
window.addEventListener('message', (e) => {
  const msg: FromExtension = e.data

  if (msg.type === 'status') {
    statusDot.className = `dot ${msg.connecting ? 'connecting' : msg.connected ? 'connected' : 'disconnected'}`
    statusDot.title = msg.connecting ? 'Connecting…' : msg.connected ? 'Connected' : 'Disconnected'
  }

  if (msg.type === 'models') {
    modelPicker.innerHTML = msg.list
      .map((m) => `<option value="${m.id}">${m.display_name}</option>`)
      .join('')
  }

  if (msg.type === 'stream_chunk' && currentAssistantEl) {
    currentAssistantEl.textContent += msg.delta
    currentAssistantEl.scrollIntoView({ block: 'end' })
  }

  if (msg.type === 'stream_done') {
    currentAssistantEl = null
    sendBtn.disabled = false
  }

  if (msg.type === 'tool_call_display') {
    appendToolRow(msg.id, msg.name, msg.params)
  }

  if (msg.type === 'tool_confirm_request') {
    const row = appendToolRow(msg.id, msg.name, msg.params)
    row.classList.add('expanded')
    const body = row.querySelector('.tool-body')!

    const diffHtml = msg.diff
      ? renderDiff(msg.diff)
      : `<pre>${JSON.stringify(msg.params, null, 2)}</pre>`

    const confirm = document.createElement('div')
    confirm.className = 'tool-confirm'
    confirm.innerHTML = `
      <div class="diff-preview">${diffHtml}</div>
      <div class="confirm-buttons">
        <button class="btn-allow">Allow</button>
        <button class="btn-deny">Deny</button>
      </div>
    `
    confirm.querySelector('.btn-allow')!.addEventListener('click', () => {
      vscode.postMessage({ type: 'tool_confirm_response', id: msg.id, allowed: true })
      confirm.remove()
    })
    confirm.querySelector('.btn-deny')!.addEventListener('click', () => {
      vscode.postMessage({ type: 'tool_confirm_response', id: msg.id, allowed: false })
      confirm.remove()
    })
    body.appendChild(confirm)
  }

  if (msg.type === 'tool_result_display') {
    const row = document.getElementById(`tool-${msg.id}`)
    if (!row) return
    const icon = row.querySelector('.icon')!
    icon.textContent = msg.denied ? '✗' : '✓'
    const body = row.querySelector('.tool-body')!
    body.innerHTML = `<pre>${msg.result}</pre>`
  }

  if (msg.type === 'permission_mode_ack') {
    permissionPicker.value = msg.mode
  }
})

function renderDiff(patch: string): string {
  return patch
    .split('\n')
    .map((line) => {
      if (line.startsWith('+')) return `<span class="add">${escHtml(line)}</span>`
      if (line.startsWith('-')) return `<span class="del">${escHtml(line)}</span>`
      return escHtml(line)
    })
    .join('\n')
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
```

**Step 2: Compile webview**

```bash
npx tsc -p tsconfig.webview.json --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: webview main.ts (chat UI, tool confirm flow)"
```

---

## Task 11: HolziPanel.ts

HolziPanel owns the VS Code WebviewPanel and bridges messages between the webview and the extension host. It also calls the model API and relays tool results.

**Files:**
- Create: `src/HolziPanel.ts`

```typescript
// src/HolziPanel.ts
import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { HolziSocket, ClientMessage, ServerMessage } from './HolziSocket'
import { ToolRegistry, PermissionMode } from './tools/index'
import { readFile, writeFile, listDir } from './tools/filesystem'
import { runCommand } from './tools/terminal'
import { getSelection, applyDiff, openFile } from './tools/editor'

const VIEW_TYPE = 'holziChat'

export class HolziPanel {
  private static current: HolziPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private socket: HolziSocket
  private registry: ToolRegistry
  private pendingConfirms = new Map<string, (allowed: boolean) => void>()

  static createOrShow(context: vscode.ExtensionContext): void {
    if (HolziPanel.current) {
      HolziPanel.current.panel.reveal()
      return
    }
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One

    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Holzi', column, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
    })

    HolziPanel.current = new HolziPanel(panel, context)
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel
    this.registry = new ToolRegistry()
    this._registerTools()

    const config = vscode.workspace.getConfiguration('holzi')
    const host = config.get<string>('host', 'https://holzi.haex.cloud')
    const token = config.get<string>('token', '')
    const wsUrl = host.replace(/^http/, 'ws') + '/ws/agent'

    this.socket = new HolziSocket(wsUrl, token)
    this._setupSocket()

    this.panel.webview.html = this._getHtml(context)
    this.panel.webview.onDidReceiveMessage((msg) => this._handleWebviewMessage(msg))
    this.panel.onDidDispose(() => {
      this.socket.disconnect()
      HolziPanel.current = undefined
    })
  }

  private _registerTools(): void {
    this.registry.register('read_file', readFile)
    this.registry.register('write_file', writeFile)
    this.registry.register('list_dir', listDir)
    this.registry.register('run_command', runCommand)
    this.registry.register('get_selection', getSelection)
    this.registry.register('apply_diff', applyDiff)
    this.registry.register('open_file', openFile)

    this.registry.setConfirmFn(async (toolName, params) => {
      return new Promise<boolean>((resolve) => {
        const id = `confirm_${Date.now()}`
        this.pendingConfirms.set(id, resolve)

        // Generate diff string for write tools
        let diff: string | undefined
        if (params.patch) diff = params.patch as string

        this.panel.webview.postMessage({
          type: 'tool_confirm_request',
          id,
          name: toolName,
          params,
          diff,
        })
      })
    })
  }

  private _setupSocket(): void {
    this.socket.on('connected', () => {
      this.panel.webview.postMessage({ type: 'status', connected: true, connecting: false })
      // Load models
      this._loadModels()
    })

    this.socket.on('disconnected', () => {
      this.panel.webview.postMessage({ type: 'status', connected: false, connecting: true })
    })

    this.socket.on('message', async (msg: ServerMessage) => {
      if (msg.type === 'stream_chunk') {
        this.panel.webview.postMessage({ type: 'stream_chunk', delta: msg.delta })
        return
      }

      if (msg.type === 'stream_done') {
        this.panel.webview.postMessage({ type: 'stream_done' })
        return
      }

      if (msg.type === 'tool_call') {
        this.panel.webview.postMessage({
          type: 'tool_call_display',
          id: msg.id,
          name: msg.name,
          params: msg.params,
        })

        const toolResult = await this.registry.execute(msg.name, msg.params as Record<string, unknown>)
        const denied = 'error' in toolResult && toolResult.error === 'user_denied'
        const resultStr = 'result' in toolResult ? toolResult.result : toolResult.error

        this.panel.webview.postMessage({
          type: 'tool_result_display',
          id: msg.id,
          result: resultStr,
          denied,
        })

        const wireMsg: ClientMessage = denied
          ? { type: 'tool_result', id: msg.id, error: 'user_denied' }
          : { type: 'tool_result', id: msg.id, result: resultStr }
        this.socket.send(wireMsg)
        return
      }

      if (msg.type === 'permission_mode_ack') {
        this.panel.webview.postMessage({ type: 'permission_mode_ack', mode: msg.mode })
        return
      }
    })

    this.socket.connect()
  }

  private async _loadModels(): Promise<void> {
    const config = vscode.workspace.getConfiguration('holzi')
    const host = config.get<string>('host', 'https://holzi.haex.cloud')
    const token = config.get<string>('token', '')
    try {
      const res = await fetch(`${host}/api/llm/models`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        this.panel.webview.postMessage({ type: 'models', list: data })
      }
    } catch {
      // Models endpoint not reachable — panel still usable
    }
  }

  private _handleWebviewMessage(msg: any): void {
    if (msg.type === 'ready') {
      this.panel.webview.postMessage({
        type: 'status',
        connected: this.socket.connected,
        connecting: !this.socket.connected,
      })
      return
    }

    if (msg.type === 'send_message') {
      const modelPicker = this.panel.webview  // model selection comes from webview
      this.socket.send({
        type: 'message',
        content: msg.content,
        context: msg.context ?? {},
      })
      return
    }

    if (msg.type === 'set_permission_mode') {
      const mode = msg.mode as PermissionMode
      this.registry.setPermissionMode(mode)
      this.socket.send({ type: 'update_permission_mode', mode })
      return
    }

    if (msg.type === 'tool_confirm_response') {
      const resolve = this.pendingConfirms.get(msg.id)
      if (resolve) {
        this.pendingConfirms.delete(msg.id)
        resolve(msg.allowed)
      }
      return
    }
  }

  private _getHtml(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview
    const nonce = getNonce()

    // Read HTML template
    const htmlPath = path.join(context.extensionPath, 'src', 'webview', 'index.html')
    const cssPath = path.join(context.extensionPath, 'src', 'webview', 'style.css')
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'main.js'),
    )

    let html = fs.readFileSync(htmlPath, 'utf-8')
    const css = fs.readFileSync(cssPath, 'utf-8')

    html = html.replace('{{NONCE}}', nonce)
    html = html.replace('{{STYLES}}', css)
    html = html.replace('{{MAIN_JS}}', jsUri.toString())

    return html
  }

  sendStartSession(model: string, skills: string[]): void {
    this.socket.send({
      type: 'start_session',
      model,
      skills,
      permission_mode: this.registry.getPermissionMode(),
      tools: ['read_file', 'write_file', 'list_dir', 'run_command',
              'get_selection', 'apply_diff', 'open_file'],
    })
  }
}

function getNonce(): string {
  let text = ''
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return text
}
```

**Step 2: Compile check**

```bash
npx tsc -p tsconfig.json --noEmit
```

Expected: no errors (some `fetch` type issues are fine — add `"lib": ["ES2022", "DOM"]` to tsconfig.json if needed).

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: HolziPanel webview panel + socket bridge"
```

---

## Task 12: extension.ts — Activation Entry Point

**Files:**
- Create: `src/extension.ts`

```typescript
// src/extension.ts
import * as vscode from 'vscode'
import { HolziPanel } from './HolziPanel'

export function activate(context: vscode.ExtensionContext): void {
  const openChat = vscode.commands.registerCommand('holzi.openChat', () => {
    HolziPanel.createOrShow(context)
  })

  context.subscriptions.push(openChat)
}

export function deactivate(): void {}
```

**Step 2: Full compile**

```bash
npm run compile && npx tsc -p tsconfig.webview.json
```

Expected: `out/extension.js` and `out/webview/main.js` both produced.

**Step 3: Run all tests**

```bash
npm test
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: extension.ts activation + holzi.openChat command"
```

---

## Task 13: Integration Test with Mock Server

This is a manual integration test. Verify the full flow before packaging.

**Step 1: Start mock server in one terminal**

```bash
cd /home/haex/Projekte/holzi-vscode
npx ts-node mock-server/index.ts
```

Expected: `[mock] listening on ws://localhost:3333`

**Step 2: Set VS Code settings for local testing**

Open VS Code settings (JSON) and add:

```json
{
  "holzi.host": "http://localhost:3333",
  "holzi.token": "test"
}
```

Note: `ws://localhost:3333` — the panel converts `http://` → `ws://` automatically.

**Step 3: Launch the extension in Extension Development Host**

Press `F5` in VS Code (or `Run > Start Debugging`). A new VS Code window opens.

**Step 4: Open the chat panel**

In the Extension Development Host window: `Cmd/Ctrl+Shift+P` → "Holzi: Open Chat"

Expected: panel opens, status dot turns green (connected), model picker populated.

**Step 5: Send a test message**

Type "Hello Holzi" and press Enter.

Expected:
1. User message appears in chat
2. `[mock]` server logs show `start_session` then `message`
3. A `read_file` tool call row appears in the chat (collapsible ● icon)
4. A confirmation dialog appears (Ask mode): "Allow / Deny"
5. Click Allow → tool result shown, then streaming text response

**Step 6: Test permission modes**

Change the permission dropdown to "Plan" and send another message.

Expected: mock server still sends `tool_call` for read_file, but this time the extension auto-allows (read_file is a read-only tool in plan mode). Write tools would be blocked.

Change to "Auto" and send a message.

Expected: tool calls execute without any confirmation dialogs.

**Step 7: Test reconnect**

Kill the mock server (`Ctrl+C`) and wait 3 seconds. Status dot turns yellow (connecting). Restart mock server. Status dot turns green again.

**Step 8: Commit if all passes**

```bash
git add -A
git commit -m "chore: verify integration flow with mock server"
```

---

## Task 14: start_session Handshake

Currently `start_session` is only sent when the user opens the panel and the model/skills are selected. We need to send it once connected (after the webview posts `ready` and model is selected).

**Files:**
- Modify: `src/HolziPanel.ts`
- Modify: `src/webview/main.ts`

**Step 1: Webview — send model selection on change**

In `main.ts`, add a handler:

```typescript
modelPicker.addEventListener('change', () => {
  vscode.postMessage({ type: 'start_session', model: modelPicker.value, skills: [] })
})
```

Also post `start_session` right after `ready` when models load:

```typescript
if (msg.type === 'models') {
  modelPicker.innerHTML = msg.list.map(/* ... */).join('')
  // Auto-start with first model
  if (msg.list.length > 0) {
    vscode.postMessage({ type: 'start_session', model: msg.list[0].id, skills: [] })
  }
}
```

**Step 2: Extension host — handle start_session from webview**

In `HolziPanel._handleWebviewMessage`, add:

```typescript
if (msg.type === 'start_session') {
  this.sendStartSession(msg.model, msg.skills ?? [])
  return
}
```

Also send start_session when first connecting (before models load, use a default):

In `_setupSocket`, on `connected`:

```typescript
this.socket.on('connected', () => {
  // ...
  // Defer start_session until model is selected by webview
})
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: start_session handshake on model selection"
```

---

## Task 15: Package and Smoke Test

**Step 1: Full build**

```bash
cd /home/haex/Projekte/holzi-vscode
npm run compile && npx tsc -p tsconfig.webview.json
npm test
```

Expected: all pass.

**Step 2: Package as VSIX**

```bash
npm run package
```

Expected: `holzi-vscode-0.1.0.vsix` created.

**Step 3: Install the packaged extension**

```bash
code --install-extension holzi-vscode-0.1.0.vsix
```

**Step 4: Verify acceptance criteria checklist**

- [ ] Extension connects to configured host, auth via Bearer token
- [ ] Model is selectable per conversation (loads from backend)
- [ ] Permission mode switchable mid-conversation via dropdown
- [ ] write_file/apply_diff show diff preview with Allow/Deny in Ask mode
- [ ] run_command output shown in tool call row
- [ ] Reconnect on disconnect (exponential backoff)
- [ ] UI uses only VS Code CSS variables (Dark/Light/High-Contrast works)
- [ ] Mock server correctly simulates full tool_call → user confirm → tool_result → stream response flow

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: holzi-vscode 0.1.0 — initial release"
```

---

## Out of Scope (from Plan 41)

- Skills `@mention` and MCP `#mention` picker in input bar (follow-up)
- Conversation list sidebar (follow-up)
- `apply_diff` diff preview (requires reading the file and diffing before showing) — basic impl only in 0.1.0
- Multi-root workspace support
- Voice input, image attachments, notebook support
