# VS Code Activity-Bar Sidebar with Sessions List Implementation Plan

**Goal:** Re-introduce a Holzi entry in the VS Code Activity Bar that opens a
native `TreeView` sidebar listing all conversations (newest first), with a `+`
to start a new chat, click-to-open (focus existing tab or open a new one at
`/chat/<id>`), and a hover trash icon to delete.

**Architecture:** Pure extension-host work plus a thin webview IPC addition.
A `TreeDataProvider` (`SessionsProvider`) fetches `GET /api/conversations` via a
minimal `api.ts` HTTP client and renders each conversation as a `TreeItem`.
`package.json` re-declares the activity-bar container, the `Sessions` view, its
welcome content, title/inline menus, and three new commands. `extension.ts`
wires the provider, commands, and two `when`-context keys
(`holzi.authenticated`, `holzi.sessionsEmpty`). For "focus instead of
duplicate", `HolziPanel` tracks each tab's current conversation id (reported by
a new webview→host `conversation_id` message) and can navigate a freshly-opened
tab to `/chat/<id>` via a new host→webview `navigate` message. The sidebar
refreshes on first-message (reusing the existing `set_title` signal) and on a
manual refresh action.

**Tech Stack:** TypeScript, VS Code Extension API (`TreeDataProvider`,
`viewsContainers`, `setContext`), Node built-in `fetch`, Nuxt 4 webview client
plugins, Vue Router.

**Design doc:** `docs/plans/2026-06-10-vscode-sidebar-sessions-design.md`

**Testing note:** The `apps/vscode/extension` and `apps/vscode/webview`
packages have **no test runner** (confirmed: `extension/package.json` has no
`test` script; the only suites in the repo are the frontend Vitest tests).
Per the precedent set in
`docs/plans/2026-06-10-vscode-multi-panel-new-chat-impl.md` (Task 1), extension
and webview code here is verified by a **TypeScript/Nuxt build + manual F5 dev
host**, not automated tests. Pure helpers (`formatRelative`) are written as
exported pure functions so they *could* be unit-tested later, but introducing
Vitest into the extension package is out of scope (YAGNI). Every task ends with
a build check; the final task is the end-to-end manual verification from the
design doc.

**Key facts verified against the codebase (do not re-derive):**
- `Conversation` summary shape (`packages/holzi-ui/types/api-generated.ts:1640`,
  `ConversationSummaryResponse`): `{ id: number; title: string | null;
  updated_at: number; started_at: number; ... }`.
- `updated_at` / `started_at` are **unix seconds** — multiply by 1000 for
  `Date` (`packages/holzi-ui/components/chat/ConversationList.vue:49` does
  `new Date(ts * 1000)`).
- Config helpers already exist: `getHost()` and `getToken(context)` in
  `apps/vscode/extension/src/config.ts`.
- `HolziPanel` is already multi-instance via `private static instances =
  new Set<HolziPanel>()` (`apps/vscode/extension/src/HolziPanel.ts:9`).
- The webview IPC bridge (`$vscode.post`, `$vscode.onMessage`, `available`)
  lives in `apps/vscode/webview/app/plugins/vscode-bridge.client.ts`; types in
  `apps/vscode/webview/app/types/vscode.d.ts`.
- The activity-bar/sidebar was removed in commit `ba905bb`; `package.json`
  `contributes` currently has only `commands` + `configuration`.
- An activity-bar icon already exists: `apps/vscode/extension/images/icon.svg`.
- Build commands: `pnpm run build:extension` (extension only),
  `pnpm run build:vscode` (webview + extension).

---

## Task 1: `api.ts` — minimal authenticated HTTP client

**Files:**
- Create: `apps/vscode/extension/src/api.ts`

**Step 1: Write the client**

Create `apps/vscode/extension/src/api.ts`:

```typescript
import * as vscode from 'vscode'
import { getHost, getToken } from './config'

/** Subset of the backend's ConversationSummaryResponse the sidebar needs. */
export interface ConversationSummary {
  id: number
  title: string | null
  updated_at: number
}

/** Error carrying the HTTP status so callers can branch on 401. */
export class HolziHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'HolziHttpError'
  }
}

async function authedFetch(
  context: vscode.ExtensionContext,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const host = getHost() || 'https://holzi.haex.cloud'
  const token = await getToken(context)
  return fetch(`${host}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
}

export async function listConversations(
  context: vscode.ExtensionContext,
): Promise<ConversationSummary[]> {
  const res = await authedFetch(context, '/api/conversations')
  if (!res.ok) {
    throw new HolziHttpError(`listConversations failed: ${res.status}`, res.status)
  }
  return (await res.json()) as ConversationSummary[]
}

export async function deleteConversation(
  context: vscode.ExtensionContext,
  id: number,
): Promise<void> {
  const res = await authedFetch(context, `/api/conversations/${id}`, { method: 'DELETE' })
  // 404 is fine — the conversation is already gone, which is the desired state.
  if (!res.ok && res.status !== 404) {
    throw new HolziHttpError(`deleteConversation failed: ${res.status}`, res.status)
  }
}
```

**Step 2: Build to verify it compiles**

Run: `pnpm run build:extension`
Expected: build succeeds, no TypeScript errors. (`fetch`/`RequestInit`/`Response`
are global under `@types/node` ^25, already a devDependency.)

**Step 3: Commit**

```bash
git add apps/vscode/extension/src/api.ts
git commit -m "feat(vscode): add authenticated conversations api client"
```

---

## Task 2: `SessionsProvider.ts` — TreeDataProvider + relative-time helper

**Files:**
- Create: `apps/vscode/extension/src/SessionsProvider.ts`

**Step 1: Write the provider**

Create `apps/vscode/extension/src/SessionsProvider.ts`:

```typescript
import * as vscode from 'vscode'
import { listConversations, HolziHttpError, type ConversationSummary } from './api'

/** Pure: unix-seconds timestamp → short relative label (now, 9m, 2h, 3d, …). */
export function formatRelative(unixSeconds: number): string {
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds))
  if (sec < 60) return 'now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(day / 365)}y`
}

export class SessionItem extends vscode.TreeItem {
  // NOTE: field is `sessionId`, not `id` — `vscode.TreeItem` already declares
  // an inherited `id?: string`, so a `readonly id: number` parameter property
  // collides (TS2415). Consumers use `item.sessionId`.
  constructor(readonly sessionId: number, label: string, description: string) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.description = description
    this.contextValue = 'session'
    this.command = {
      command: 'holzi.openSession',
      title: 'Open Session',
      arguments: [sessionId],
    }
  }
}

export class SessionsProvider implements vscode.TreeDataProvider<SessionItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private cache: ConversationSummary[] | null = null

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: vscode.OutputChannel,
  ) {}

  /** Drop the cache and re-render (triggers a re-fetch on next getChildren). */
  refresh(): void {
    this.cache = null
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(item: SessionItem): vscode.TreeItem {
    return item
  }

  async getChildren(): Promise<SessionItem[]> {
    if (this.cache === null) {
      try {
        this.cache = await listConversations(this.context)
        await vscode.commands.executeCommand(
          'setContext', 'holzi.sessionsEmpty', this.cache.length === 0,
        )
      } catch (err) {
        if (err instanceof HolziHttpError && err.status === 401) {
          await vscode.commands.executeCommand('setContext', 'holzi.authenticated', false)
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          this.logger.appendLine(`[holzi] sessions fetch failed: ${msg}`)
          vscode.window.showErrorMessage(`Holzi: could not load sessions (${msg})`)
        }
        this.cache = []
        return []
      }
    }
    return [...this.cache]
      .sort((a, b) => b.updated_at - a.updated_at)
      .map((c) => new SessionItem(c.id, c.title || 'Untitled', formatRelative(c.updated_at)))
  }
}
```

**Step 2: Build to verify it compiles**

Run: `pnpm run build:extension`
Expected: build succeeds, no TypeScript errors.

**Step 3: Commit**

```bash
git add apps/vscode/extension/src/SessionsProvider.ts
git commit -m "feat(vscode): add SessionsProvider tree data provider"
```

---

## Task 3: `package.json` — activity-bar container, view, menus, commands

**Files:**
- Modify: `apps/vscode/extension/package.json` (the `contributes` block)

**Step 1: Add the new commands**

In `apps/vscode/extension/package.json`, the `contributes.commands` array
currently holds `holzi.openChat`, `holzi.configure`, `holzi.login`. Give
`holzi.openChat` an `add` codicon (it doubles as the view-title `+`) and append
the three new commands:

```jsonc
"commands": [
  {
    "command": "holzi.openChat",
    "title": "Holzi: Open Chat",
    "icon": "$(add)"
  },
  {
    "command": "holzi.configure",
    "title": "Holzi: Configure Server"
  },
  {
    "command": "holzi.login",
    "title": "Holzi: Sign In"
  },
  {
    "command": "holzi.openSession",
    "title": "Holzi: Open Session"
  },
  {
    "command": "holzi.refreshSessions",
    "title": "Holzi: Refresh Sessions",
    "icon": "$(refresh)"
  },
  {
    "command": "holzi.deleteSession",
    "title": "Holzi: Delete Session",
    "icon": "$(trash)"
  }
],
```

**Step 2: Add the container, view, welcome content, and menus**

Add these four keys to `contributes` (alongside `commands` and
`configuration`):

```jsonc
"viewsContainers": {
  "activitybar": [
    {
      "id": "holzi",
      "title": "Holzi",
      "icon": "images/icon.svg"
    }
  ]
},
"views": {
  "holzi": [
    {
      "id": "holzi.sessions",
      "name": "Sessions",
      "type": "tree"
    }
  ]
},
"viewsWelcome": [
  {
    "view": "holzi.sessions",
    "when": "!holzi.authenticated",
    "contents": "Sign in to see your Holzi sessions.\n[Sign in to Holzi](command:holzi.login)"
  },
  {
    "view": "holzi.sessions",
    "when": "holzi.authenticated && holzi.sessionsEmpty",
    "contents": "No sessions yet.\n[New session](command:holzi.openChat)"
  }
],
"menus": {
  "view/title": [
    {
      "command": "holzi.openChat",
      "when": "view == holzi.sessions",
      "group": "navigation@1"
    },
    {
      "command": "holzi.refreshSessions",
      "when": "view == holzi.sessions",
      "group": "navigation@2"
    }
  ],
  "view/item/context": [
    {
      "command": "holzi.deleteSession",
      "when": "view == holzi.sessions && viewItem == session",
      "group": "inline"
    }
  ]
}
```

**Step 3: Validate the JSON + build**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/vscode/extension/package.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

Run: `pnpm run build:extension`
Expected: build succeeds.

(The new commands are declared but not yet registered in `extension.ts` — that
is Task 6. The manifest contributing an unregistered command is fine for the
build; only invoking it at runtime before Task 6 would error.)

**Step 4: Commit**

```bash
git add apps/vscode/extension/package.json
git commit -m "feat(vscode): contribute activity-bar sessions view and commands"
```

---

## Task 4: `HolziPanel` — tab tracking, navigate, first-message hook

**Files:**
- Modify: `apps/vscode/extension/src/HolziPanel.ts`

This adds: a per-tab `currentConversationId`, a `findByConversationId` lookup, a
public `reveal()`, an `options` argument to `createOrShow`
(`{ conversationId?, onFirstMessage? }`), a host→webview `navigate` post after
the webview is ready, and handling of the new `conversation_id` message. The
`set_title` handler additionally invokes `onFirstMessage` (this is the sidebar
refresh trigger — the webview already emits `set_title` exactly on the first
message of a new chat, commit `95d85c1`).

**Step 1: Add fields, options, and the static lookup**

In `apps/vscode/extension/src/HolziPanel.ts`, replace the class fields,
`createOrShow`, and constructor (lines 8–46) with:

```typescript
export interface OpenOptions {
  conversationId?: number
  onFirstMessage?: () => void
}

export class HolziPanel {
  private static instances = new Set<HolziPanel>()
  private readonly panel: vscode.WebviewPanel
  private readonly context: vscode.ExtensionContext
  private readonly logger: vscode.OutputChannel
  private readonly onFirstMessage?: () => void
  private readonly pendingNavigateId?: number
  private currentConversationId: number | null = null

  static async createOrShow(
    context: vscode.ExtensionContext,
    logger: vscode.OutputChannel,
    options?: OpenOptions,
  ): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One

    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Holzi', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
    })
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')

    HolziPanel.instances.add(new HolziPanel(panel, context, logger, options))
  }

  /** Find an open tab currently showing the given conversation, if any. */
  static findByConversationId(id: number): HolziPanel | undefined {
    for (const inst of HolziPanel.instances) {
      if (inst.currentConversationId === id) return inst
    }
    return undefined
  }

  /** Bring this panel's tab to the foreground. */
  reveal(): void {
    this.panel.reveal()
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    logger: vscode.OutputChannel,
    options?: OpenOptions,
  ) {
    this.panel = panel
    this.context = context
    this.logger = logger
    this.onFirstMessage = options?.onFirstMessage
    this.pendingNavigateId = options?.conversationId
    this.currentConversationId = options?.conversationId ?? null

    this.panel.webview.html = this._buildHtml(context)
    this.panel.webview.onDidReceiveMessage((msg) => this._handleWebviewMessage(msg))
    this.panel.onDidDispose(() => {
      HolziPanel.instances.delete(this)
    })
  }
```

**Step 2: Handle `navigate` post + `conversation_id` + first-message**

Replace `_handleWebviewMessage` (lines 48–61) with:

```typescript
  private async _handleWebviewMessage(msg: { type?: string }): Promise<void> {
    if (msg?.type === 'webview_ready') {
      const host = getHost() || 'https://holzi.haex.cloud'
      const token = await getToken(this.context)
      this.panel.webview.postMessage({ type: 'config', host, token })
      this.logger.appendLine(`[holzi] sent config (host=${host}, hasToken=${token.length > 0})`)
      if (this.pendingNavigateId !== undefined) {
        this.panel.webview.postMessage({ type: 'navigate', path: `/chat/${this.pendingNavigateId}` })
      }
      return
    }
    if (msg?.type === 'conversation_id') {
      const id = (msg as { id?: unknown }).id
      this.currentConversationId = typeof id === 'number' ? id : null
      return
    }
    if (msg?.type === 'set_title' && typeof (msg as { title?: unknown }).title === 'string') {
      this.panel.title = (msg as { title: string }).title
      this.onFirstMessage?.()
      return
    }
    this.logger.appendLine(`[holzi] unhandled webview message: ${JSON.stringify(msg)}`)
  }
```

**Step 3: Build to verify it compiles**

Run: `pnpm run build:extension`
Expected: build succeeds, no TypeScript errors.

**Step 4: Commit**

```bash
git add apps/vscode/extension/src/HolziPanel.ts
git commit -m "feat(vscode): track conversation id per panel and support deep-link open"
```

---

## Task 5: Webview — report `conversation_id`, handle `navigate`

**Files:**
- Create: `apps/vscode/webview/app/plugins/vscode-router.client.ts`

A single client plugin handles both directions: it listens for the host's
`navigate` message and routes there, and on every route change it reports the
current conversation id (parsed from `/chat/<id>`) back to the host.

**Step 1: Write the plugin**

Create `apps/vscode/webview/app/plugins/vscode-router.client.ts`:

```typescript
// VS Code router bridge: lets the extension host deep-link this webview to a
// conversation (host → { type: 'navigate', path }) and keeps the host informed
// of which conversation this tab is showing (webview → { type: 'conversation_id',
// id }) so it can focus an existing tab instead of opening a duplicate.

export default defineNuxtPlugin((nuxtApp) => {
  const { $vscode } = nuxtApp as {
    $vscode: {
      post: (m: unknown) => void
      onMessage: (h: (d: unknown) => void) => () => void
      available: boolean
    }
  }
  if (!$vscode.available) return

  const router = useRouter()

  // host → webview: navigate to a path (e.g. /chat/123)
  $vscode.onMessage((msg: unknown) => {
    const m = msg as { type?: string; path?: string }
    if (m?.type === 'navigate' && typeof m.path === 'string') {
      router.replace(m.path)
    }
  })

  // webview → host: report the conversation id (or null) on every route change
  function report(path: string) {
    const match = path.match(/\/chat\/(\d+)/)
    $vscode.post({ type: 'conversation_id', id: match ? Number(match[1]) : null })
  }
  router.afterEach((to) => report(to.path))
})
```

**Step 2: Build the webview + extension**

Run: `pnpm run build:vscode`
Expected: build succeeds (Nuxt picks up the new client plugin, extension
compiles).

**Step 3: Commit**

```bash
git add apps/vscode/webview/app/plugins/vscode-router.client.ts
git commit -m "feat(vscode): webview reports conversation id and handles deep-link navigate"
```

> **Known edge case (faithful to the approved design, not a bug to fix here):**
> A brand-new chat opened via `+` stays on the `/` route — `Hub.vue` keeps its
> active conversation id internally and does **not** push `/chat/<id>` after the
> first message. So that tab reports `conversation_id: null` and clicking its
> freshly-created sidebar entry opens a *second* tab at `/chat/<id>` instead of
> focusing the original. Sessions opened **from the sidebar** navigate via the
> `navigate` message and therefore report their id correctly, so the
> focus-instead-of-duplicate behavior in verification step 5 works. Closing this
> gap would require `Hub.vue` (shared `holzi-ui`) to emit the new conversation
> id so the webview can route to `/chat/<id>`; that is a separate change and is
> out of scope for this plan.

---

## Task 6: `extension.ts` — register view, commands, context keys, auth listener

**Files:**
- Modify: `apps/vscode/extension/src/extension.ts`

**Step 1: Wire the provider, context keys, and commands**

Replace the entire body of `activate` in
`apps/vscode/extension/src/extension.ts` (keep the existing `configure` and
`login` command registrations verbatim — only `openChat` changes and new
commands are added):

```typescript
import * as vscode from 'vscode'
import { HolziPanel } from './HolziPanel'
import { SessionsProvider, type SessionItem } from './SessionsProvider'
import { deleteConversation } from './api'
import { getToken } from './config'

export function activate(context: vscode.ExtensionContext): void {
  const logger = vscode.window.createOutputChannel('Holzi')
  context.subscriptions.push(logger)

  const sessionsProvider = new SessionsProvider(context, logger)
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('holzi.sessions', sessionsProvider),
  )

  // Keep the `holzi.authenticated` when-context in sync with the stored token.
  async function syncAuthContext(): Promise<void> {
    const token = await getToken(context)
    await vscode.commands.executeCommand('setContext', 'holzi.authenticated', token.length > 0)
    sessionsProvider.refresh()
  }
  void syncAuthContext()
  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === 'holzi.token') void syncAuthContext()
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('holzi.openChat', async () => {
      await HolziPanel.createOrShow(context, logger, {
        onFirstMessage: () => sessionsProvider.refresh(),
      })
    }),
    vscode.commands.registerCommand('holzi.openSession', async (id: number) => {
      const existing = HolziPanel.findByConversationId(id)
      if (existing) {
        existing.reveal()
        return
      }
      await HolziPanel.createOrShow(context, logger, {
        conversationId: id,
        onFirstMessage: () => sessionsProvider.refresh(),
      })
    }),
    vscode.commands.registerCommand('holzi.refreshSessions', () => {
      sessionsProvider.refresh()
    }),
    vscode.commands.registerCommand('holzi.deleteSession', async (item: SessionItem) => {
      const confirm = await vscode.window.showWarningMessage(
        `Delete "${item.label}"?`,
        { modal: true },
        'Delete',
      )
      if (confirm !== 'Delete') return
      try {
        await deleteConversation(context, item.sessionId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.appendLine(`[holzi] delete failed: ${msg}`)
        vscode.window.showErrorMessage(`Holzi: could not delete session (${msg})`)
        return
      }
      sessionsProvider.refresh()
    }),
    vscode.commands.registerCommand('holzi.configure', async () => {
      const config = vscode.workspace.getConfiguration('holzi')
      const current = config.get<string>('host') ?? 'https://holzi.haex.cloud'
      const value = await vscode.window.showInputBox({
        title: 'Holzi: Configure Server',
        prompt: 'Enter Holzi server URL',
        value: current,
        validateInput: v => /^https?:\/\/.+/.test(v) ? null : 'Must start with http:// or https://',
      })
      if (value !== undefined) {
        await config.update('host', value.replace(/\/$/, ''), vscode.ConfigurationTarget.Global)
      }
    }),
    vscode.commands.registerCommand('holzi.login', async () => {
      const token = await vscode.window.showInputBox({
        title: 'Holzi: Sign In',
        prompt: 'Paste your Holzi API token',
        password: true,
      })
      if (token) {
        await context.secrets.store('holzi.token', token.trim())
      }
    }),
  )
}

export function deactivate(): void {}
```

> **Note on `item.label`:** `SessionItem.label` is set via the `TreeItem`
> constructor and is typed as `string | TreeItemLabel | undefined`. Because we
> always construct it with a string (`c.title || 'Untitled'`), interpolating it
> into the confirmation string is safe; if TypeScript complains, coerce with
> `String(item.label)`.

**Step 2: Build to verify it compiles**

Run: `pnpm run build:extension`
Expected: build succeeds, no TypeScript errors.

**Step 3: Commit**

```bash
git add apps/vscode/extension/src/extension.ts
git commit -m "feat(vscode): register sessions view, commands, and auth context"
```

---

## Task 7: End-to-end manual verification

Run the full VS Code build, launch the dev host, and walk the design's
verification checklist.

**Step 1: Full build**

Run: `pnpm run build:vscode`
Expected: webview + extension build succeed with no errors.

**Step 2: Launch the Extension Development Host**

Open `apps/vscode/extension` in VS Code and press `F5` (or run the existing
launch config). A second VS Code window opens with the dev extension loaded.

**Step 3: Walk the checklist** (from the design doc, Section "Verification")

1. **Activity bar:** the Holzi icon appears in the Activity Bar → click it →
   the `Sessions` sidebar opens.
2. **Auth gating:** with no token stored, the view shows the welcome
   "Sign in to Holzi"; run `holzi.login` and paste a valid token → the list
   loads automatically (via `secrets.onDidChange` → `syncAuthContext`).
3. **List rendering:** conversations appear newest-first with a right-aligned
   relative timestamp (`now`, `9m`, `2h`, `3d`, …). `Ctrl+F` filters the tree
   natively.
4. **Open a session:** click an entry → a new panel tab opens and loads
   directly at `/chat/<id>` with history rendered.
5. **Focus, not duplicate:** click the *same* entry again → the existing tab is
   revealed (no second tab). (Works because the deep-linked tab navigated to
   `/chat/<id>` and reported its id back to the host.)
6. **New chat refresh:** click `+` in the view title → an empty new tab opens;
   send the first message → its title updates *and* the new conversation
   appears at the top of the sidebar (via the `set_title` → `onFirstMessage` →
   `refresh` path). (Per the Task 5 known-edge-case note, clicking that
   brand-new entry may open a second tab — acceptable for V1.)
7. **Delete:** hover an entry → the trash inline icon appears → click it →
   confirm the modal → the entry disappears from the list and the backend
   (`DELETE /api/conversations/<id>`).
8. **Refresh action:** the refresh icon in the view title reloads the list.

**Step 4: Final commit (if any manual fix-ups were needed)**

If verification surfaced a small fix, commit it with a descriptive message.
Otherwise this task produces no commit — the feature is complete.

---

## Out of Scope (YAGNI — from the design)

- No polling / WebSocket — only first-message refresh + manual refresh.
- No rename / pin / export in the sidebar.
- No pagination — assumes `/api/conversations` returns a manageable volume.
- No webview-based sidebar — the slim-host stance of `ba905bb` is preserved.
- Closing the brand-new-chat focus gap (Task 5 note) — needs a shared
  `Hub.vue` change; deferred.
