# Webview Vue + Tailwind + shadcn-vue Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the VS Code extension webview from vanilla TS to Vue 3 + Tailwind CSS v4 + shadcn-vue, with a redesigned slash menu that uses panel-based navigation (main menu → overlaying sub-panel with back button).

**Architecture:** Vite (iife format) replaces `tsc` for webview bundling; `vite-plugin-css-injected-by-js` injects Tailwind CSS at runtime so `HolziPanel.ts` no longer needs to read/inline a CSS file. All existing `vscode.postMessage` types (`ToExtension`, `FromExtension`) stay unchanged. Extension host code (rolldown + tsc) is untouched.

**Tech Stack:** Vue 3, Vite 6, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn-vue (Switch component), Radix Vue, `vite-plugin-css-injected-by-js`

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json` (pnpm adds entries automatically)

**Step 1: Install runtime deps**

```bash
pnpm add vue radix-vue lucide-vue-next class-variance-authority clsx tailwind-merge
```

**Step 2: Install dev deps**

```bash
pnpm add -D vite @vitejs/plugin-vue tailwindcss @tailwindcss/vite vite-plugin-css-injected-by-js @vue/tsconfig
```

**Step 3: Verify install**

```bash
pnpm ls vue vite tailwindcss
```
Expected: all three listed with versions

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add Vue 3, Vite, Tailwind, shadcn-vue deps"
```

---

## Task 2: Create Vite config

**Files:**
- Create: `vite.config.ts` (project root)

**Step 1: Write the config**

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'

export default defineConfig({
  plugins: [vue(), tailwindcss(), cssInjectedByJs()],
  build: {
    lib: {
      entry: 'src/webview/main.ts',
      formats: ['iife'],
      name: 'HolziApp',
      fileName: () => 'main.js',
    },
    outDir: 'out/webview',
    emptyOutDir: true,
    cssCodeSplit: false,
  },
})
```

**Step 2: Add tsconfig for Vue files**

Create `tsconfig.vue.json` at project root:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "vue"
  },
  "include": ["src/webview/**/*.ts", "src/webview/**/*.vue", "vite.config.ts"]
}
```

**Step 3: Commit**

```bash
git add vite.config.ts tsconfig.vue.json
git commit -m "chore: add Vite config for webview bundle"
```

---

## Task 3: Update package.json scripts

**Files:**
- Modify: `package.json`

**Step 1: Replace the `compile:webview` script and add `dev:webview`**

Change:
```json
"compile:webview": "tsc -p tsconfig.webview.json",
```
To:
```json
"compile:webview": "vite build",
"dev:webview": "vite build --watch",
```

Also update the `package` script — it already calls `compile:webview`, so no change needed there.

**Step 2: Verify**

```bash
pnpm run compile:webview
```
Expected: `out/webview/main.js` created, no errors

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: switch webview build from tsc to vite"
```

---

## Task 4: Update index.html template

**Files:**
- Modify: `src/webview/index.html`

**Step 1: Replace with minimal Vue mount point**

New content (CSS injection is done by JS bundle now — no `{{STYLES}}`):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-{{NONCE}}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Holzi</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="{{NONCE}}" src="{{MAIN_JS}}"></script>
</body>
</html>
```

---

## Task 5: Update HolziPanel.ts

**Files:**
- Modify: `src/HolziPanel.ts`

The `_buildHtml` method currently reads `style.css` and uses `{{STYLES}}`. Remove that since CSS is now injected by the JS bundle.

**Step 1: Update `_buildHtml`**

Replace the current `_buildHtml`:
```ts
private _buildHtml(context: vscode.ExtensionContext): string {
  const webview = this.panel.webview
  const nonce = Array.from({ length: 32 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[
      Math.floor(Math.random() * 62)
    ],
  ).join('')

  const htmlPath = path.join(context.extensionPath, 'src', 'webview', 'index.html')
  const cssPath = path.join(context.extensionPath, 'src', 'webview', 'style.css')
  const jsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'main.js'),
  )

  let html = fs.readFileSync(htmlPath, 'utf-8')
  const css = fs.readFileSync(cssPath, 'utf-8')

  return html
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace('{{STYLES}}', css)
    .replace('{{MAIN_JS}}', jsUri.toString())
}
```

With:
```ts
private _buildHtml(context: vscode.ExtensionContext): string {
  const webview = this.panel.webview
  const nonce = Array.from({ length: 32 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[
      Math.floor(Math.random() * 62)
    ],
  ).join('')

  const htmlPath = path.join(context.extensionPath, 'src', 'webview', 'index.html')
  const jsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'main.js'),
  )

  return fs.readFileSync(htmlPath, 'utf-8')
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace('{{MAIN_JS}}', jsUri.toString())
}
```

Also remove the `cssPath` variable (it no longer exists).

---

## Task 6: Update .vscodeignore

**Files:**
- Modify: `.vscodeignore`

Remove the line `!src/webview/style.css` (CSS is now generated, not source).
Keep `!src/webview/index.html` (still used as runtime template).

New content:
```
**/*.ts
!out/**
node_modules/
src/**
!src/webview/index.html
tests/
mock-server/
docs/
.worktrees/
tsconfig*.json
vitest.config.ts
vite.config.ts
```

---

## Task 7: Set up shadcn-vue utilities

**Files:**
- Create: `src/webview/lib/utils.ts`
- Create: `src/webview/components/ui/switch/Switch.vue`
- Create: `src/webview/components/ui/switch/index.ts`

**Step 1: Create the `cn` utility**

```ts
// src/webview/lib/utils.ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

**Step 2: Add the Switch component (from shadcn-vue)**

```vue
<!-- src/webview/components/ui/switch/Switch.vue -->
<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: string
  checked?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:checked': [value: boolean]
}>()
</script>

<template>
  <SwitchRoot
    v-bind="props"
    :class="cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
      'transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-[var(--vscode-button-background)]',
      'data-[state=unchecked]:bg-[var(--vscode-panel-border)]',
      props.class
    )"
    @update:checked="emit('update:checked', $event)"
  >
    <SwitchThumb
      :class="cn(
        'pointer-events-none block h-4 w-4 rounded-full',
        'bg-[var(--vscode-button-foreground)]',
        'shadow-lg ring-0 transition-transform',
        'data-[state=checked]:translate-x-4',
        'data-[state=unchecked]:translate-x-0'
      )"
    />
  </SwitchRoot>
</template>
```

```ts
// src/webview/components/ui/switch/index.ts
export { default as Switch } from './Switch.vue'
```

**Step 3: Add path alias to vite.config.ts**

Update `vite.config.ts` to add alias:
```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { fileURLToPath } from 'url'

export default defineConfig({
  plugins: [vue(), tailwindcss(), cssInjectedByJs()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/webview', import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: 'src/webview/main.ts',
      formats: ['iife'],
      name: 'HolziApp',
      fileName: () => 'main.js',
    },
    outDir: 'out/webview',
    emptyOutDir: true,
    cssCodeSplit: false,
  },
})
```

---

## Task 8: Create Tailwind CSS entry

**Files:**
- Create: `src/webview/style.css` (replaces old style.css — becomes Tailwind entry)

```css
/* src/webview/style.css */
@import "tailwindcss";

/* VS Code CSS variable passthrough — Tailwind can't know these at build time */
:root {
  --background: var(--vscode-editor-background);
  --foreground: var(--vscode-foreground);
}

* {
  box-sizing: border-box;
}

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 0;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
```

---

## Task 9: Create Vue entry point

**Files:**
- Modify: `src/webview/main.ts` (replace entirely)

```ts
// src/webview/main.ts
import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

const vscode = acquireVsCodeApi()
const app = createApp(App)
app.provide('vscode', vscode)
app.mount('#app')
```

---

## Task 10: Create App.vue

**Files:**
- Create: `src/webview/App.vue`

App.vue holds all global state and handles extension messages. It passes state down via props/provide.

```vue
<!-- src/webview/App.vue -->
<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import MessageList from './components/MessageList.vue'
import InputArea from './components/InputArea.vue'

type ToExtension =
  | { type: 'send_message'; content: string; context: Record<string, string | undefined> }
  | { type: 'set_permission_mode'; mode: string }
  | { type: 'tool_confirm_response'; id: string; allowed: boolean }
  | { type: 'start_session'; model: string; skills: string[] }
  | { type: 'ready' }
  | { type: 'pick_file' }

export type FromExtension =
  | { type: 'stream_chunk'; delta: string }
  | { type: 'stream_done' }
  | { type: 'status'; connected: boolean; connecting: boolean }
  | { type: 'models'; list: Array<{ id: string; display_name: string }> }
  | { type: 'tool_call_display'; id: string; name: string; params: Record<string, unknown> }
  | { type: 'tool_confirm_request'; id: string; name: string; params: Record<string, unknown>; diff?: string }
  | { type: 'tool_result_display'; id: string; result: string; denied: boolean }
  | { type: 'permission_mode_ack'; mode: string }
  | { type: 'file_picked'; name: string; content: string }
  | { type: 'error'; message: string }

export type Message =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'tool'; id: string; name: string; params: Record<string, unknown>; result?: string; denied?: boolean }

const vscode = inject<{ postMessage(msg: ToExtension): void }>('vscode')!

const messages = ref<Message[]>([])
const connectionStatus = ref<'connected' | 'connecting' | 'disconnected'>('disconnected')
const models = ref<Array<{ id: string; display_name: string }>>([])
const sessionStarted = ref(false)
const sending = ref(false)
const permissionMode = ref('ask')
const effort = ref('medium')
const thinking = ref(false)
const activeSkills = ref<string[]>([])
const selectedModel = ref('')

function post(msg: ToExtension) {
  vscode.postMessage(msg)
}

function send(content: string, attachedFiles: Array<{ name: string; content: string }>) {
  if (!content || sending.value) return
  sending.value = true

  const context: Record<string, string> = {
    __effort: effort.value,
    __thinking: String(thinking.value),
  }
  for (const f of attachedFiles) {
    context[`file:${f.name}`] = f.content
  }

  messages.value.push({ kind: 'user', text: content })
  messages.value.push({ kind: 'assistant', text: '' })
  post({ type: 'send_message', content, context })
}

function startSession() {
  post({ type: 'start_session', model: selectedModel.value, skills: [...activeSkills.value] })
}

function onPermissionModeChange(mode: string) {
  permissionMode.value = mode
  post({ type: 'set_permission_mode', mode })
}

function onToolConfirm(id: string, allowed: boolean) {
  post({ type: 'tool_confirm_response', id, allowed })
}

function onPickFile() {
  post({ type: 'pick_file' })
}

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as FromExtension

  if (msg.type === 'status') {
    connectionStatus.value = msg.connecting ? 'connecting' : msg.connected ? 'connected' : 'disconnected'
    return
  }

  if (msg.type === 'models') {
    models.value = msg.list
    if (msg.list.length > 0) {
      selectedModel.value = msg.list[0].id
      if (!sessionStarted.value) {
        startSession()
        sessionStarted.value = true
      }
    }
    return
  }

  if (msg.type === 'stream_chunk') {
    const last = messages.value[messages.value.length - 1]
    if (last?.kind === 'assistant') last.text += msg.delta
    return
  }

  if (msg.type === 'stream_done') {
    sending.value = false
    return
  }

  if (msg.type === 'tool_call_display') {
    messages.value.push({ kind: 'tool', id: msg.id, name: msg.name, params: msg.params })
    return
  }

  if (msg.type === 'tool_confirm_request') {
    messages.value.push({ kind: 'tool', id: msg.id, name: msg.name, params: msg.params })
    return
  }

  if (msg.type === 'tool_result_display') {
    const tool = messages.value.find((m) => m.kind === 'tool' && m.id === msg.id) as Extract<Message, { kind: 'tool' }> | undefined
    if (tool) {
      tool.result = msg.result
      tool.denied = msg.denied
    }
    return
  }

  if (msg.type === 'permission_mode_ack') {
    permissionMode.value = msg.mode
    return
  }

  if (msg.type === 'file_picked') {
    // forwarded to InputArea via event
    filePickedName.value = msg.name
    filePickedContent.value = msg.content
    return
  }

  if (msg.type === 'error') {
    messages.value.push({ kind: 'error', text: msg.message })
    sending.value = false
    return
  }
})

const filePickedName = ref('')
const filePickedContent = ref('')

onMounted(() => {
  post({ type: 'ready' })
})
</script>

<template>
  <MessageList
    :messages="messages"
    @tool-confirm="onToolConfirm"
  />
  <InputArea
    :connection-status="connectionStatus"
    :models="models"
    :selected-model="selectedModel"
    :permission-mode="permissionMode"
    :effort="effort"
    :thinking="thinking"
    :active-skills="activeSkills"
    :sending="sending"
    :file-picked-name="filePickedName"
    :file-picked-content="filePickedContent"
    @update:selected-model="(v) => { selectedModel = v; startSession() }"
    @update:permission-mode="onPermissionModeChange"
    @update:effort="(v) => effort = v"
    @update:thinking="(v) => thinking = v"
    @update:active-skills="(v) => { activeSkills = v; startSession() }"
    @send="send"
    @pick-file="onPickFile"
  />
</template>
```

---

## Task 11: Create MessageList.vue and ToolRow.vue

**Files:**
- Create: `src/webview/components/MessageList.vue`
- Create: `src/webview/components/ToolRow.vue`

```vue
<!-- src/webview/components/ToolRow.vue -->
<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  id: string
  name: string
  params: Record<string, unknown>
  result?: string
  denied?: boolean
  needsConfirm?: boolean
  diff?: string
}>()

const emit = defineEmits<{
  confirm: [id: string, allowed: boolean]
}>()

const expanded = ref(props.needsConfirm ?? false)

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderDiff(patch: string) {
  return patch.split('\n').map((line) => {
    const esc = escHtml(line)
    if (line.startsWith('+') && !line.startsWith('+++')) return `<span class="text-[var(--vscode-gitDecoration-addedResourceForeground)]">${esc}</span>`
    if (line.startsWith('-') && !line.startsWith('---')) return `<span class="text-[var(--vscode-gitDecoration-deletedResourceForeground)]">${esc}</span>`
    return esc
  }).join('\n')
}

const paramStr = Object.entries(props.params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
</script>

<template>
  <div class="flex flex-col gap-1 border-l-2 border-[var(--vscode-panel-border)] pl-2.5 text-sm">
    <div
      class="flex items-center gap-1.5 cursor-pointer select-none text-[var(--vscode-descriptionForeground)]"
      @click="expanded = !expanded"
    >
      <span class="text-[10px]">{{ result !== undefined ? (denied ? '✗' : '✓') : '●' }}</span>
      <span class="font-semibold text-[var(--vscode-foreground)]">{{ name }}</span>
      <span class="overflow-hidden text-ellipsis whitespace-nowrap flex-1">{{ paramStr }}</span>
    </div>
    <div v-if="expanded" class="mt-1">
      <div v-if="needsConfirm">
        <pre
          v-if="diff"
          class="font-mono text-[0.85em] whitespace-pre overflow-x-auto max-h-48 bg-[var(--vscode-textCodeBlock-background)] p-2 mb-2 rounded"
          v-html="renderDiff(diff)"
        />
        <pre
          v-else
          class="font-mono text-[0.85em] whitespace-pre overflow-x-auto max-h-48 bg-[var(--vscode-textCodeBlock-background)] p-2 mb-2 rounded"
        >{{ JSON.stringify(params, null, 2) }}</pre>
        <div class="flex gap-2">
          <button
            class="px-3 py-1 text-xs bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded hover:bg-[var(--vscode-button-hoverBackground)] cursor-pointer border-none"
            @click="emit('confirm', id, true)"
          >Allow</button>
          <button
            class="px-3 py-1 text-xs bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] rounded cursor-pointer border-none"
            @click="emit('confirm', id, false)"
          >Deny</button>
        </div>
      </div>
      <pre
        v-else-if="result"
        class="font-mono text-[0.85em] whitespace-pre-wrap break-all"
      >{{ result }}</pre>
    </div>
  </div>
</template>
```

```vue
<!-- src/webview/components/MessageList.vue -->
<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { Message } from '../App.vue'
import ToolRow from './ToolRow.vue'

const props = defineProps<{
  messages: Message[]
}>()

const emit = defineEmits<{
  toolConfirm: [id: string, allowed: boolean]
}>()

const listEl = ref<HTMLElement>()

watch(() => props.messages.length, async () => {
  await nextTick()
  listEl.value?.lastElementChild?.scrollIntoView({ block: 'end' })
})
</script>

<template>
  <div
    ref="listEl"
    role="log"
    aria-live="polite"
    class="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
  >
    <template v-for="(msg, i) in messages" :key="i">
      <div
        v-if="msg.kind === 'user'"
        class="self-end max-w-[85%] bg-[var(--vscode-editor-inactiveSelectionBackground)] px-2.5 py-2 rounded leading-relaxed whitespace-pre-wrap break-words"
      >{{ msg.text }}</div>

      <div
        v-else-if="msg.kind === 'assistant'"
        class="max-w-full leading-relaxed whitespace-pre-wrap break-words"
      >{{ msg.text }}</div>

      <div
        v-else-if="msg.kind === 'error'"
        class="leading-relaxed text-[var(--vscode-errorForeground)]"
      >{{ msg.text }}</div>

      <ToolRow
        v-else-if="msg.kind === 'tool'"
        :id="msg.id"
        :name="msg.name"
        :params="msg.params"
        :result="msg.result"
        :denied="msg.denied"
        @confirm="(id, allowed) => emit('toolConfirm', id, allowed)"
      />
    </template>
  </div>
</template>
```

---

## Task 12: Create the SlashMenu panels

**Files:**
- Create: `src/webview/components/panels/ModelPanel.vue`
- Create: `src/webview/components/panels/ModePanel.vue`
- Create: `src/webview/components/panels/EffortPanel.vue`
- Create: `src/webview/components/panels/SkillsPanel.vue`

```vue
<!-- src/webview/components/panels/ModelPanel.vue -->
<script setup lang="ts">
const props = defineProps<{
  models: Array<{ id: string; display_name: string }>
  selectedModel: string
}>()
const emit = defineEmits<{
  'update:selectedModel': [value: string]
  back: []
}>()
</script>

<template>
  <div class="flex flex-col">
    <button
      class="flex items-center gap-2 px-3 py-2 text-sm text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left"
      @click="emit('back')"
    >
      <span>←</span> <span class="font-medium text-[var(--vscode-foreground)]">Model</span>
    </button>
    <div class="h-px bg-[var(--vscode-panel-border)] mx-3" />
    <button
      v-for="m in models"
      :key="m.id"
      class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left"
      :class="m.id === selectedModel ? 'text-[var(--vscode-foreground)]' : 'text-[var(--vscode-descriptionForeground)]'"
      @click="emit('update:selectedModel', m.id); emit('back')"
    >
      <span class="w-3 text-xs">{{ m.id === selectedModel ? '●' : '' }}</span>
      {{ m.display_name }}
    </button>
  </div>
</template>
```

```vue
<!-- src/webview/components/panels/ModePanel.vue -->
<script setup lang="ts">
const MODES = [
  { value: 'plan', label: 'Plan' },
  { value: 'ask', label: 'Ask' },
  { value: 'auto_edit', label: 'Auto Edit' },
  { value: 'auto', label: 'Auto' },
]
const props = defineProps<{ mode: string }>()
const emit = defineEmits<{ 'update:mode': [value: string]; back: [] }>()
</script>

<template>
  <div class="flex flex-col">
    <button
      class="flex items-center gap-2 px-3 py-2 text-sm text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left"
      @click="emit('back')"
    >
      <span>←</span> <span class="font-medium text-[var(--vscode-foreground)]">Mode</span>
    </button>
    <div class="h-px bg-[var(--vscode-panel-border)] mx-3" />
    <button
      v-for="m in MODES"
      :key="m.value"
      class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left"
      :class="m.value === mode ? 'text-[var(--vscode-foreground)]' : 'text-[var(--vscode-descriptionForeground)]'"
      @click="emit('update:mode', m.value); emit('back')"
    >
      <span class="w-3 text-xs">{{ m.value === mode ? '●' : '' }}</span>
      {{ m.label }}
    </button>
  </div>
</template>
```

```vue
<!-- src/webview/components/panels/EffortPanel.vue -->
<script setup lang="ts">
const EFFORTS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
]
const props = defineProps<{ effort: string }>()
const emit = defineEmits<{ 'update:effort': [value: string]; back: [] }>()
</script>

<template>
  <div class="flex flex-col">
    <button
      class="flex items-center gap-2 px-3 py-2 text-sm text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left"
      @click="emit('back')"
    >
      <span>←</span> <span class="font-medium text-[var(--vscode-foreground)]">Effort</span>
    </button>
    <div class="h-px bg-[var(--vscode-panel-border)] mx-3" />
    <button
      v-for="e in EFFORTS"
      :key="e.value"
      class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left"
      :class="e.value === effort ? 'text-[var(--vscode-foreground)]' : 'text-[var(--vscode-descriptionForeground)]'"
      @click="emit('update:effort', e.value); emit('back')"
    >
      <span class="w-3 text-xs">{{ e.value === effort ? '●' : '' }}</span>
      {{ e.label }}
    </button>
  </div>
</template>
```

```vue
<!-- src/webview/components/panels/SkillsPanel.vue -->
<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ skills: string[] }>()
const emit = defineEmits<{ 'update:skills': [value: string[]]; back: [] }>()

const input = ref('')

function addSkill() {
  const name = input.value.trim()
  if (name && !props.skills.includes(name)) {
    emit('update:skills', [...props.skills, name])
    input.value = ''
  }
}

function removeSkill(name: string) {
  emit('update:skills', props.skills.filter((s) => s !== name))
}
</script>

<template>
  <div class="flex flex-col">
    <button
      class="flex items-center gap-2 px-3 py-2 text-sm text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left"
      @click="emit('back')"
    >
      <span>←</span> <span class="font-medium text-[var(--vscode-foreground)]">Skills</span>
    </button>
    <div class="h-px bg-[var(--vscode-panel-border)] mx-3" />
    <div class="px-3 py-2 flex flex-wrap gap-1">
      <span
        v-for="skill in skills"
        :key="skill"
        class="inline-flex items-center gap-1 bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded px-1.5 py-0.5 text-xs"
      >
        {{ skill }}
        <button
          class="bg-none border-none text-inherit cursor-pointer p-0 text-[11px] opacity-70 hover:opacity-100"
          :aria-label="`Remove skill ${skill}`"
          @click="removeSkill(skill)"
        >✕</button>
      </span>
    </div>
    <div class="px-3 pb-2">
      <input
        v-model="input"
        type="text"
        placeholder="Skill name + Enter…"
        autocomplete="off"
        class="w-full bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border,var(--vscode-panel-border))] rounded px-2 py-1 text-sm outline-none focus:border-[var(--vscode-focusBorder)]"
        @keydown.enter.prevent="addSkill"
      />
    </div>
  </div>
</template>
```

---

## Task 13: Create SlashMenu.vue

**Files:**
- Create: `src/webview/components/SlashMenu.vue`

```vue
<!-- src/webview/components/SlashMenu.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { Switch } from './ui/switch'
import ModelPanel from './panels/ModelPanel.vue'
import ModePanel from './panels/ModePanel.vue'
import EffortPanel from './panels/EffortPanel.vue'
import SkillsPanel from './panels/SkillsPanel.vue'

const props = defineProps<{
  models: Array<{ id: string; display_name: string }>
  selectedModel: string
  permissionMode: string
  effort: string
  thinking: boolean
  activeSkills: string[]
}>()

const emit = defineEmits<{
  'update:selectedModel': [value: string]
  'update:permissionMode': [value: string]
  'update:effort': [value: string]
  'update:thinking': [value: boolean]
  'update:activeSkills': [value: string[]]
  attachFile: []
  close: []
}>()

type Panel = 'model' | 'mode' | 'effort' | 'skills' | null
const currentPanel = ref<Panel>(null)

function modelLabel() {
  return props.models.find((m) => m.id === props.selectedModel)?.display_name ?? props.selectedModel
}

const modeLabels: Record<string, string> = {
  plan: 'Plan', ask: 'Ask', auto_edit: 'Auto Edit', auto: 'Auto',
}
</script>

<template>
  <div
    class="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-lg border border-[var(--vscode-widget-border,var(--vscode-panel-border))] bg-[var(--vscode-editorWidget-background,var(--vscode-editor-background))] shadow-xl py-1.5 overflow-hidden"
    @click.stop
  >
    <!-- Sub-panels -->
    <Transition name="slide">
      <ModelPanel
        v-if="currentPanel === 'model'"
        :models="models"
        :selected-model="selectedModel"
        @update:selected-model="emit('update:selectedModel', $event)"
        @back="currentPanel = null"
      />
      <ModePanel
        v-else-if="currentPanel === 'mode'"
        :mode="permissionMode"
        @update:mode="emit('update:permissionMode', $event)"
        @back="currentPanel = null"
      />
      <EffortPanel
        v-else-if="currentPanel === 'effort'"
        :effort="effort"
        @update:effort="emit('update:effort', $event)"
        @back="currentPanel = null"
      />
      <SkillsPanel
        v-else-if="currentPanel === 'skills'"
        :skills="activeSkills"
        @update:skills="emit('update:activeSkills', $event)"
        @back="currentPanel = null"
      />

      <!-- Main menu -->
      <div v-else class="flex flex-col">
        <!-- Switch model -->
        <button
          class="flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left text-[var(--vscode-foreground)]"
          @click="currentPanel = 'model'"
        >
          <span>Switch model…</span>
          <div class="flex items-center gap-1.5 text-[var(--vscode-descriptionForeground)]">
            <span class="text-xs">{{ modelLabel() }}</span>
            <span>›</span>
          </div>
        </button>

        <div class="h-px bg-[var(--vscode-panel-border)] mx-3" />

        <!-- Mode -->
        <button
          class="flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left text-[var(--vscode-foreground)]"
          @click="currentPanel = 'mode'"
        >
          <span>Mode</span>
          <div class="flex items-center gap-1.5 text-[var(--vscode-descriptionForeground)]">
            <span class="text-xs">{{ modeLabels[permissionMode] ?? permissionMode }}</span>
            <span>›</span>
          </div>
        </button>

        <!-- Effort -->
        <button
          class="flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left text-[var(--vscode-foreground)]"
          @click="currentPanel = 'effort'"
        >
          <span>Effort</span>
          <div class="flex items-center gap-1.5 text-[var(--vscode-descriptionForeground)]">
            <span class="text-xs capitalize">{{ effort }}</span>
            <span>›</span>
          </div>
        </button>

        <div class="h-px bg-[var(--vscode-panel-border)] mx-3" />

        <!-- Thinking toggle -->
        <div class="flex items-center justify-between px-3 py-2 text-sm text-[var(--vscode-foreground)]">
          <span>Thinking</span>
          <Switch
            :checked="thinking"
            @update:checked="emit('update:thinking', $event)"
          />
        </div>

        <div class="h-px bg-[var(--vscode-panel-border)] mx-3" />

        <!-- Skills -->
        <button
          class="flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left text-[var(--vscode-foreground)]"
          @click="currentPanel = 'skills'"
        >
          <span>Skills</span>
          <div class="flex items-center gap-1.5 text-[var(--vscode-descriptionForeground)]">
            <span v-if="activeSkills.length" class="text-xs">{{ activeSkills.length }} active</span>
            <span>›</span>
          </div>
        </button>

        <div class="h-px bg-[var(--vscode-panel-border)] mx-3" />

        <!-- Attach file -->
        <button
          class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer border-none bg-transparent w-full text-left text-[var(--vscode-foreground)]"
          @click="emit('attachFile'); emit('close')"
        >
          📎 Attach file…
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.slide-enter-from {
  opacity: 0;
  transform: translateX(8px);
}
.slide-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
```

---

## Task 14: Create InputArea.vue

**Files:**
- Create: `src/webview/components/InputArea.vue`

```vue
<!-- src/webview/components/InputArea.vue -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import SlashMenu from './SlashMenu.vue'

const props = defineProps<{
  connectionStatus: 'connected' | 'connecting' | 'disconnected'
  models: Array<{ id: string; display_name: string }>
  selectedModel: string
  permissionMode: string
  effort: string
  thinking: boolean
  activeSkills: string[]
  sending: boolean
  filePickedName: string
  filePickedContent: string
}>()

const emit = defineEmits<{
  'update:selectedModel': [value: string]
  'update:permissionMode': [value: string]
  'update:effort': [value: string]
  'update:thinking': [value: boolean]
  'update:activeSkills': [value: string[]]
  send: [content: string, attachedFiles: Array<{ name: string; content: string }>]
  pickFile: []
}>()

const inputText = ref('')
const menuOpen = ref(false)
const attachedFiles = ref<Array<{ name: string; content: string }>>([])
const inputEl = ref<HTMLTextAreaElement>()

watch(() => props.filePickedName, (name) => {
  if (name && props.filePickedContent) {
    attachedFiles.value.push({ name, content: props.filePickedContent })
  }
})

function autoGrow() {
  if (!inputEl.value) return
  inputEl.value.style.height = 'auto'
  inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 200) + 'px'
}

function doSend() {
  const content = inputText.value.trim()
  if (!content || props.sending) return
  emit('send', content, [...attachedFiles.value])
  inputText.value = ''
  attachedFiles.value = []
  if (inputEl.value) inputEl.value.style.height = 'auto'
}

function removeFile(idx: number) {
  attachedFiles.value.splice(idx, 1)
}

const modeLabels: Record<string, string> = {
  plan: 'Plan', ask: 'Ask', auto_edit: 'Auto Edit', auto: 'Auto',
}
</script>

<template>
  <div class="relative shrink-0 px-2.5 pb-2.5">
    <SlashMenu
      v-if="menuOpen"
      :models="models"
      :selected-model="selectedModel"
      :permission-mode="permissionMode"
      :effort="effort"
      :thinking="thinking"
      :active-skills="activeSkills"
      @update:selected-model="emit('update:selectedModel', $event)"
      @update:permission-mode="emit('update:permissionMode', $event)"
      @update:effort="emit('update:effort', $event)"
      @update:thinking="emit('update:thinking', $event)"
      @update:active-skills="emit('update:activeSkills', $event)"
      @attach-file="emit('pickFile')"
      @close="menuOpen = false"
    />

    <div
      class="border border-[var(--vscode-input-border,var(--vscode-panel-border))] rounded-lg bg-[var(--vscode-input-background)] flex flex-col focus-within:border-[var(--vscode-focusBorder)]"
      @click.self="menuOpen = false"
    >
      <!-- Attached files -->
      <div v-if="attachedFiles.length" class="flex flex-wrap gap-1 px-3 pt-2">
        <span
          v-for="(f, i) in attachedFiles"
          :key="i"
          class="inline-flex items-center gap-1 bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded px-1.5 py-0.5 text-xs"
        >
          📎 {{ f.name }}
          <button
            class="bg-none border-none text-inherit cursor-pointer p-0 text-[11px] opacity-70 hover:opacity-100"
            @click="removeFile(i)"
          >✕</button>
        </span>
      </div>

      <textarea
        ref="inputEl"
        v-model="inputText"
        rows="1"
        placeholder="Message Holzi…"
        aria-label="Message input"
        class="w-full bg-transparent text-[var(--vscode-input-foreground)] border-none outline-none px-3 pt-2.5 pb-1.5 font-[var(--vscode-font-family)] text-[var(--vscode-font-size)] resize-none max-h-48 overflow-y-auto leading-relaxed"
        @input="autoGrow"
        @keydown.enter.exact.prevent="doSend"
        @click="menuOpen = false"
      />

      <div class="flex items-center justify-between px-2 py-1 border-t border-[var(--vscode-panel-border)]">
        <div class="flex items-center gap-0.5">
          <button
            title="Attach file"
            aria-label="Attach file"
            class="w-7 h-7 flex items-center justify-center rounded-full bg-transparent border border-[var(--vscode-panel-border)] text-[var(--vscode-descriptionForeground)] cursor-pointer text-lg hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)]"
            @click="emit('pickFile')"
          >+</button>
          <button
            title="Options"
            aria-label="Open options"
            class="w-7 h-7 flex items-center justify-center rounded-full bg-transparent border-none text-[var(--vscode-descriptionForeground)] cursor-pointer text-lg hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)]"
            @click.stop="menuOpen = !menuOpen"
          >/</button>
        </div>
        <div class="flex items-center gap-0.5">
          <span
            class="w-2 h-2 rounded-full mx-1 shrink-0"
            :class="{
              'bg-[var(--vscode-testing-iconPassed)]': connectionStatus === 'connected',
              'bg-[var(--vscode-charts-yellow)]': connectionStatus === 'connecting',
              'bg-[var(--vscode-testing-iconFailed)]': connectionStatus === 'disconnected',
            }"
            :title="connectionStatus"
          />
          <button
            class="text-[0.85em] px-2.5 py-1 border border-[var(--vscode-panel-border)] rounded bg-transparent text-[var(--vscode-descriptionForeground)] cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)]"
            @click.stop="menuOpen = !menuOpen"
          >{{ modeLabels[permissionMode] ?? permissionMode }}</button>
          <button
            title="Send (Enter)"
            aria-label="Send message"
            :disabled="sending"
            class="w-7 h-7 min-w-7 min-h-7 flex items-center justify-center rounded-full bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] border-none cursor-pointer text-base hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-40 disabled:cursor-default"
            @click="doSend"
          >➤</button>
        </div>
      </div>
    </div>
  </div>
</template>
```

---

## Task 15: Close menu on outside click + global click handler

The `SlashMenu` is conditionally rendered (`v-if`). Outside-click is handled in `InputArea.vue`: clicking anywhere on the input container or textarea sets `menuOpen = false`. The only gap is clicking outside the entire input area.

**Files:**
- Modify: `src/webview/App.vue`

Add a click handler on the root `<template>` wrapper div:

Replace the App.vue template section with:
```vue
<template>
  <div class="flex flex-col h-full overflow-hidden" @click="inputAreaRef?.closeMenu()">
    <MessageList
      :messages="messages"
      @tool-confirm="onToolConfirm"
    />
    <InputArea
      ref="inputAreaRef"
      ...same props as before...
    />
  </div>
</template>
```

And in InputArea.vue, expose `closeMenu`:
```ts
defineExpose({ closeMenu: () => { menuOpen.value = false } })
```

---

## Task 16: Delete old files and clean up

**Files:**
- Delete: `tsconfig.webview.json` (replaced by vite.config.ts)

```bash
git rm tsconfig.webview.json
```

The old `src/webview/style.css` and `src/webview/main.ts` are replaced in-place (not deleted, just overwritten). The old `src/webview/index.html` is also replaced in-place.

---

## Task 17: Build and verify

**Step 1: Run existing tests to confirm nothing broke**

```bash
pnpm test
```
Expected: all tests pass (they cover extension host code only)

**Step 2: Build webview**

```bash
pnpm run compile:webview
```
Expected: `out/webview/main.js` created, no errors

**Step 3: Build extension**

```bash
pnpm run compile && pnpm run bundle
```
Expected: `out/extension.js` created, no errors

**Step 4: Full package**

```bash
pnpm run package
```
Expected: new `.vsix` created

**Step 5: Commit everything**

```bash
git add src/webview/ vite.config.ts tsconfig.vue.json .vscodeignore package.json pnpm-lock.yaml
git commit -m "feat: migrate webview to Vue 3 + Tailwind + shadcn-vue with panel-based slash menu"
```

---

## Notes

- If `vite-plugin-css-injected-by-js` causes CSP issues (unlikely since `style-src 'unsafe-inline'` is set), fall back to: remove the plugin and update `HolziPanel.ts` to read `out/webview/style.css` instead.
- The `tsconfig.webview.json` can be kept for IDE type-checking if needed, but the build uses Vite.
- shadcn-vue's full CLI init is skipped in favour of manual setup to avoid conflicts with the non-standard project structure.
