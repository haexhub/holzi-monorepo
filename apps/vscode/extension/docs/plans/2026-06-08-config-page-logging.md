# Config Page & Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add max-width layout, Claude Code send button style, a Settings view inside the slash menu, and VSCode output channel logging that surfaces real connection errors.

**Architecture:** Settings live as a Vue view inside the existing HolziPanel webview (toggled via SlashMenu). The extension host manages config persistence (URL → workspace config, token → secrets) and exposes a `reconnect()` method on HolziPanel. A VSCode OutputChannel is created in extension.ts and passed down through HolziPanel to HolziSocket for structured logging.

**Tech Stack:** Vue 3, TypeScript, Tailwind CSS, VSCode Extension API

---

### Task 1: Max width layout + Claude Code send button style

**Files:**
- Modify: `src/webview/App.vue`
- Modify: `src/webview/components/InputArea.vue`

**Step 1: Add max-width wrapper in App.vue**

In the root `<div>` of App.vue's template, add `max-w-[740px] mx-auto w-full` so the entire panel (MessageList + InputArea) is centered and width-constrained.

Change:
```html
<div class="flex flex-col h-screen overflow-hidden" @click="inputAreaCloseMenu">
```
To:
```html
<div class="flex flex-col h-screen overflow-hidden">
  <div class="flex flex-col h-full w-full max-w-[740px] mx-auto" @click="inputAreaCloseMenu">
```
And close the inner div before `</template>`.

**Step 2: Update send button to Claude Code style in InputArea.vue**

Find the send button (line ~158) and update its class — replace the VSCode button background variables with the Claude Code orange:
```html
class="w-7 h-7 min-w-7 min-h-7 flex items-center justify-center rounded-full bg-[#e05b2b] text-white border-none cursor-pointer text-base hover:bg-[#c94e24] disabled:opacity-40 disabled:cursor-default"
```

**Step 3: Build and verify visually**
```bash
cd /home/haex/Projekte/holzi-vscode && pnpm compile:webview
```
Open extension in Extension Development Host, verify layout is centered with orange send button.

**Step 4: Commit**
```bash
git add src/webview/App.vue src/webview/components/InputArea.vue
git commit -m "feat: max-width layout and Claude Code send button style"
```

---

### Task 2: Add "Settings…" entry to SlashMenu

**Files:**
- Modify: `src/webview/components/SlashMenu.vue`

**Step 1: Add emit + menu entry**

Add `openSettings: []` to the emits definition.

At the bottom of the main menu `<div>` (after the "Attach file" button, line ~148), add:
```html
<div class="h-px bg-[var(--vscode-panel-border)] mx-3" />

<button
  class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left text-[var(--vscode-descriptionForeground)]"
  @click="emit('openSettings'); emit('close')"
>
  ⚙ Settings…
</button>
```

**Step 2: Commit**
```bash
git add src/webview/components/SlashMenu.vue
git commit -m "feat: add Settings entry to slash menu"
```

---

### Task 3: Create SettingsView.vue

**Files:**
- Create: `src/webview/components/SettingsView.vue`

**Step 1: Create the component**

```vue
<!-- src/webview/components/SettingsView.vue -->
<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  currentUrl: string
  hasToken: boolean
}>()

const emit = defineEmits<{
  save: [url: string, token: string]
  back: []
}>()

const url = ref(props.currentUrl)
const token = ref('')

function save() {
  emit('save', url.value.trim(), token.value.trim())
}
</script>

<template>
  <div class="flex flex-col h-full px-4 py-3 gap-4">
    <div class="flex items-center gap-2">
      <button
        class="text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] bg-transparent border-none cursor-pointer text-base p-0"
        @click="emit('back')"
      >←</button>
      <span class="text-sm font-medium text-[var(--vscode-foreground)]">Settings</span>
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-xs text-[var(--vscode-descriptionForeground)]">Server URL</label>
      <input
        v-model="url"
        type="url"
        placeholder="https://holzi.haex.cloud"
        class="bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border,var(--vscode-panel-border))] rounded px-2.5 py-1.5 text-sm outline-none focus:border-[var(--vscode-focusBorder)] w-full"
      />
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-xs text-[var(--vscode-descriptionForeground)]">
        Bearer Token
        <span v-if="hasToken" class="ml-1 opacity-60">(configured — leave blank to keep)</span>
      </label>
      <input
        v-model="token"
        type="password"
        :placeholder="hasToken ? '••••••••' : 'Paste token here'"
        class="bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border,var(--vscode-panel-border))] rounded px-2.5 py-1.5 text-sm outline-none focus:border-[var(--vscode-focusBorder)] w-full"
      />
    </div>

    <button
      class="mt-auto px-3 py-1.5 text-sm rounded bg-[#e05b2b] text-white hover:bg-[#c94e24] border-none cursor-pointer self-start"
      @click="save"
    >Save & Reconnect</button>
  </div>
</template>
```

**Step 2: Commit**
```bash
git add src/webview/components/SettingsView.vue
git commit -m "feat: add SettingsView component"
```

---

### Task 4: Wire view switching in App.vue

**Files:**
- Modify: `src/webview/App.vue`

**Step 1: Add to the `ToExtension` type**
```typescript
| { type: 'save_config'; url: string; token: string }
| { type: 'get_config' }
```

**Step 2: Add to the `FromExtension` type**
```typescript
| { type: 'config'; url: string; hasToken: boolean }
```

**Step 3: Add state and handler**
```typescript
import SettingsView from './components/SettingsView.vue'

const view = ref<'chat' | 'settings'>('chat')
const configUrl = ref('')
const configHasToken = ref(false)

function openSettings() {
  post({ type: 'get_config' })
  view.value = 'settings'
}

function saveConfig(url: string, token: string) {
  post({ type: 'save_config', url, token })
  view.value = 'chat'
}
```

**Step 4: Handle `config` message in the window event listener**
```typescript
if (msg.type === 'config') {
  configUrl.value = msg.url
  configHasToken.value = msg.hasToken
  return
}
```

**Step 5: Update the template** — replace the inner content with:
```html
<SettingsView
  v-if="view === 'settings'"
  :current-url="configUrl"
  :has-token="configHasToken"
  @save="saveConfig"
  @back="view = 'chat'"
/>
<template v-else>
  <MessageList :messages="messages" @tool-confirm="onToolConfirm" />
  <InputArea
    ref="inputAreaRef"
    ...all existing props...
    @open-settings="openSettings"
  />
</template>
```

**Step 6: Thread `open-settings` through InputArea → SlashMenu**

In `InputArea.vue`, add emit `openSettings: []` and pass `@open-settings="emit('openSettings')"` on `<SlashMenu>`.

**Step 7: Commit**
```bash
git add src/webview/App.vue src/webview/components/InputArea.vue
git commit -m "feat: wire settings view switching in App.vue"
```

---

### Task 5: Handle config messages in HolziPanel + reconnect

**Files:**
- Modify: `src/HolziPanel.ts`

**Step 1: Add `get_config` handler to `_handleWebviewMessage`**
```typescript
case 'get_config': {
  const host = getHost()
  const token = await context.secrets.get('holzi.token') ?? ''
  this._post({ type: 'config', url: host, hasToken: token.length > 0 })
  break
}
```
Note: `context` needs to be stored as `this.context` in the constructor.

**Step 2: Add `save_config` handler**
```typescript
case 'save_config': {
  const { url, token } = msg as { url: string; token: string }
  if (url) {
    await vscode.workspace.getConfiguration('holzi')
      .update('host', url.replace(/\/$/, ''), vscode.ConfigurationTarget.Global)
  }
  if (token) {
    await this.context.secrets.store('holzi.token', token)
  }
  this._reconnect()
  break
}
```

**Step 3: Add `_reconnect()` method**
```typescript
private async _reconnect(): Promise<void> {
  this.socket.disconnect()
  const host = getHost() || 'https://holzi.haex.cloud'
  const token = await getToken(this.context)
  const wsUrl = host.replace(/^http/, 'ws') + '/ws/agent'
  this.socket = new HolziSocket(wsUrl, token, this.logger)
  this._setupSocket()
  this.socket.connect()
}
```

**Step 4: Store `context` as instance variable**

Change constructor signature to store context:
```typescript
private readonly context: vscode.ExtensionContext
```
and `this.context = context` in the constructor body.

**Step 5: Commit**
```bash
git add src/HolziPanel.ts
git commit -m "feat: handle save_config and reconnect in HolziPanel"
```

---

### Task 6: VSCode Output Channel + HolziSocket logging

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/HolziPanel.ts`
- Modify: `src/HolziSocket.ts`

**Step 1: Create output channel in extension.ts**

Before the sidebar registration, add:
```typescript
const logger = vscode.window.createOutputChannel('Holzi')
context.subscriptions.push(logger)
```

Pass `logger` to `HolziPanel.createOrShow(context, logger, sessionId)`.

**Step 2: Update HolziSocket to accept a logger**

Add `logger` optional parameter to constructor:
```typescript
constructor(
  private readonly url: string,
  private readonly token: string,
  private readonly logger?: vscode.OutputChannel
) {
  super()
}
```

Add a private log helper:
```typescript
private _log(msg: string): void {
  this.logger?.appendLine(`[${new Date().toISOString()}] ${msg}`)
}
```

Wire into lifecycle events:
```typescript
// in _open():
this._log(`Connecting to ${this.url}`)

// in ws.on('open'):
this._log('Connected')

// in ws.on('close'):
this._log(`Disconnected — retrying in ${this.reconnectDelay}ms`)

// in ws.on('error'):
this.ws.on('error', (err) => {
  this._log(`Error: ${err.message}`)
  this.emit('error', err)
})
```

**Step 3: Update HolziPanel constructor to accept and pass logger**

```typescript
private readonly logger: vscode.OutputChannel

// in constructor:
this.logger = logger
this.socket = new HolziSocket(wsUrl, token, logger)

// in _reconnect():
this.socket = new HolziSocket(wsUrl, newToken, this.logger)
```

Also log config saves:
```typescript
// in save_config handler:
this.logger.appendLine(`[config] URL updated to ${url}, reconnecting...`)
```

**Step 4: Fix error swallowing in _setupSocket**

Current error handler just emits a status. Add error detail to webview:
```typescript
this.socket.on('error', (err: Error) => {
  this._post({ type: 'status', connected: false, connecting: true })
  this._post({ type: 'error', message: `Connection error: ${err.message}` })
})
```

**Step 5: Build and verify**
```bash
pnpm compile && pnpm compile:webview
```

Open Output panel → select "Holzi" channel. Open chat panel, verify connection attempts appear in the log.

**Step 6: Commit**
```bash
git add src/extension.ts src/HolziPanel.ts src/HolziSocket.ts
git commit -m "feat: VSCode output channel logging and fix error swallowing"
```
