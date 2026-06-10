# VS Code Multi-Panel "New Chat" + Redirect Removal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every `holzi.openChat` invocation open an independent VS Code
panel/tab with its own webview session, give each tab a title derived from
the user's first message, and remove the "resume last conversation" redirect
so `/` (web and VS Code webview) always starts a brand-new chat.

**Architecture:** Three independent changes, each separately verifiable:
(1) `HolziPanel` becomes multi-instance via a `Set` instead of a singleton
field; (2) the `lastConversation` Pinia store and its redirect/clear logic
are deleted from `packages/holzi-ui` (shared by web frontend and VS Code
webview); (3) `Hub.vue` emits a `first-message` event on the first send of a
new chat, and a VS Code-only page override forwards that text to the
extension host via `postMessage`, which sets the panel/tab title.

**Tech Stack:** TypeScript, VS Code Extension API, Vue 3 `<script setup>`,
Nuxt 4 layers, Pinia, Vitest + `@vue/test-utils` (`environment: 'nuxt'`).

**Design doc:** `docs/plans/2026-06-10-vscode-multi-panel-new-chat-design.md`

---

## Task 1: `HolziPanel` — Singleton → Multi-Instance

**Files:**
- Modify: `apps/vscode/extension/src/HolziPanel.ts`

No automated tests exist for this file (it's a thin VS Code API wrapper with
no test harness in this repo). Verification is a TypeScript build + manual
check.

**Step 1: Replace the singleton field with an instance set and update
`createOrShow` / disposal**

In `apps/vscode/extension/src/HolziPanel.ts`, replace:

```typescript
export class HolziPanel {
  private static current: HolziPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private readonly context: vscode.ExtensionContext
  private readonly logger: vscode.OutputChannel

  static async createOrShow(
    context: vscode.ExtensionContext,
    logger: vscode.OutputChannel,
  ): Promise<void> {
    if (HolziPanel.current) {
      HolziPanel.current.panel.reveal()
      return
    }
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One

    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Holzi', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
    })
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')

    HolziPanel.current = new HolziPanel(panel, context, logger)
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    logger: vscode.OutputChannel,
  ) {
    this.panel = panel
    this.context = context
    this.logger = logger

    this.panel.webview.html = this._buildHtml(context)
    this.panel.webview.onDidReceiveMessage((msg) => this._handleWebviewMessage(msg))
    this.panel.onDidDispose(() => {
      HolziPanel.current = undefined
    })
  }
```

with:

```typescript
export class HolziPanel {
  private static instances = new Set<HolziPanel>()
  private readonly panel: vscode.WebviewPanel
  private readonly context: vscode.ExtensionContext
  private readonly logger: vscode.OutputChannel

  static async createOrShow(
    context: vscode.ExtensionContext,
    logger: vscode.OutputChannel,
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

    HolziPanel.instances.add(new HolziPanel(panel, context, logger))
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    logger: vscode.OutputChannel,
  ) {
    this.panel = panel
    this.context = context
    this.logger = logger

    this.panel.webview.html = this._buildHtml(context)
    this.panel.webview.onDidReceiveMessage((msg) => this._handleWebviewMessage(msg))
    this.panel.onDidDispose(() => {
      HolziPanel.instances.delete(this)
    })
  }
```

**Step 2: Build the extension to verify it compiles**

Run: `pnpm --filter holzi build`
Expected: build succeeds with no TypeScript errors.

**Step 3: Commit**

```bash
git add apps/vscode/extension/src/HolziPanel.ts
git commit -m "feat(vscode): make HolziPanel multi-instance"
```

---

## Task 2: Remove the last-conversation redirect

This removes `packages/holzi-ui/stores/lastConversation.ts` and every
reference to it. Update tests first so they reflect the target behavior,
then delete the implementation.

### Step 1: Simplify `apps/frontend/tests/pages/index.test.ts` (RED)

The page will become a one-line template (`<ChatHub />`, no script, no
redirect logic), so there is nothing left for a dedicated page test to
verify beyond "it renders ChatHub". Delete the file — testing a trivial
pass-through template adds no value (YAGNI).

```bash
git rm apps/frontend/tests/pages/index.test.ts
```

### Step 2: Simplify `packages/holzi-ui/pages/index.vue`

Replace the entire file content:

```vue
<template>
  <ChatHub />
</template>
```

### Step 3: Update `apps/frontend/tests/pages/chat-id.test.ts`

Remove the now-unused `lastConversation` references. In
`apps/frontend/tests/pages/chat-id.test.ts`:

- Remove the test `'toasts + redirects to / on 404, and clears the
  last-active pointer'`'s `localStorage.setItem('holzi.lastConversationId',
  '42')` line and the `expect(localStorage.getItem('holzi.lastConversationId')).toBeNull()`
  assertion — but keep the rest of the test (toast + redirect assertions
  still apply). Rename the test to drop the "and clears the last-active
  pointer" clause:

```typescript
  it('toasts + redirects to / on 404', async () => {
    const err = Object.assign(new Error('not found'), { statusCode: 404 })
    apiGet.mockRejectedValueOnce(err)
    const wrapper = mount(ChatIdPage)
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith('pages.chat.notFound')
    // useLocalePath() may return '/en' under the EN locale — match either.
    expect(navigateMock).toHaveBeenLastCalledWith(expect.stringMatching(/^\/(en\/?)?$/), { replace: true })
    // No hub mounted while invalid.
    expect(wrapper.find('[data-testid="chathub-stub"]').exists()).toBe(false)
  })
```

### Step 4: Update `packages/holzi-ui/pages/chat/[id].vue`

Remove the `lastConversation` import, the `lastConv` instance, and the
`lastConv.clear()` call (with its preceding comment) inside `validate`'s
catch branch.

Remove this line near the top:

```typescript
import { useLastConversationStore } from '~/stores/lastConversation'
```

Remove this line:

```typescript
const lastConv = useLastConversationStore()
```

In the `catch` block of `validate`, replace:

```typescript
    valid.value = false
    toast.error(t('pages.chat.notFound'))
    // Drop the last-active pointer too — if it was pointing here we
    // don't want `/` to bounce straight back.
    lastConv.clear()
    await navigateTo(localePath('/'), { replace: true })
```

with:

```typescript
    valid.value = false
    toast.error(t('pages.chat.notFound'))
    await navigateTo(localePath('/'), { replace: true })
```

### Step 5: Update `apps/frontend/tests/components/ChatHub.channel-filter.test.ts`

Remove the now-unused mock:

```typescript
vi.mock('~/stores/lastConversation', () => ({
  useLastConversationStore: () => ({ remember: vi.fn(), lastId: null }),
}))
```

### Step 6: Remove all `lastConversation` references from `Hub.vue`

In `packages/holzi-ui/components/chat/Hub.vue`:

**6a.** Remove the import (around line 15):

```typescript
import { useLastConversationStore } from '~/stores/lastConversation'
```

**6b.** Remove the store instance and helper (around lines 165-173),
including its leading comment block:

```typescript
// Plan 26: persist the last-active conversation id via the Pinia store
// (which wraps VueUse `useLocalStorage` — same pattern as `auth.ts`).
// Updated whenever a conversation becomes active (selection / fresh-chat
// first-send / route param load) and cleared on logout or when "Neuer
// Chat" routes back to `/`.
const lastConv = useLastConversationStore()
function rememberLastConversation(id: number | null) {
  lastConv.remember(id)
}

```

Delete this whole block (the blank line after it can stay as the single
separator before `async function loadConversations()`).

**6c.** In `loadConversation`, remove the line:

```typescript
  rememberLastConversation(id)
```

(the one directly after `activeId.value = id` inside `loadConversation`).

**6d.** In `reloadActive`, remove the line:

```typescript
  rememberLastConversation(id)
```

(the one directly after `activeId.value = id` inside `reloadActive`).

**6e.** In `newChat`, remove the line:

```typescript
  rememberLastConversation(null)
```

**6f.** In the `runStream` `onSession` callback, replace:

```typescript
      onSession: (id) => {
        activeId.value = id
        rememberLastConversation(id)
      },
```

with:

```typescript
      onSession: (id) => {
        activeId.value = id
      },
```

**6g.** In `send`'s attachment-upload block, remove both occurrences:

```typescript
        activeId.value = convo.id
        rememberLastConversation(convo.id)
        await loadConversations()
```

becomes:

```typescript
        activeId.value = convo.id
        await loadConversations()
```

and:

```typescript
      if (createdConversationId !== null) {
        activeId.value = null
        rememberLastConversation(null)
        await api.delete<void>(`/api/conversations/${createdConversationId}`)
          .catch(() => {})
        await loadConversations()
      }
```

becomes:

```typescript
      if (createdConversationId !== null) {
        activeId.value = null
        await api.delete<void>(`/api/conversations/${createdConversationId}`)
          .catch(() => {})
        await loadConversations()
      }
```

**6h.** In `logout`, remove the line:

```typescript
  rememberLastConversation(null)
```

**6i.** In `clearConversation`, remove the line:

```typescript
    rememberLastConversation(null)
```

### Step 7: Delete the store

```bash
git rm packages/holzi-ui/stores/lastConversation.ts
```

### Step 8: Run the frontend test suite

Run: `pnpm --filter @holzi/frontend run test -- --run`

Expected: the same 45 pre-existing failing test files as on `main` (these
fail for unrelated reasons — `~/stores/auth` / `~/utils/markdown` resolution
and one `data-channel` assertion — confirmed via baseline run before this
work started). No *new* failures, and no failures referencing
`lastConversation` or `holzi.lastConversationId`.

Run a scoped check on the two files you touched, to confirm they don't
themselves throw on the removed import:

Run: `pnpm --filter @holzi/frontend exec vitest run tests/pages/chat-id.test.ts tests/components/ChatHub.channel-filter.test.ts`

### Step 9: Commit

```bash
git add packages/holzi-ui/pages/index.vue packages/holzi-ui/pages/chat/\[id\].vue \
  packages/holzi-ui/components/chat/Hub.vue \
  apps/frontend/tests/pages/chat-id.test.ts \
  apps/frontend/tests/components/ChatHub.channel-filter.test.ts
git rm apps/frontend/tests/pages/index.test.ts packages/holzi-ui/stores/lastConversation.ts
git commit -m "refactor(holzi-ui): remove last-conversation redirect"
```

---

## Task 3: Emit `first-message` from `Hub.vue`

### Step 1: Write the failing test

Create `apps/frontend/tests/components/ChatHub.first-message.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return { ...orig, useI18n: () => ({ t: (k: string) => k }) }
})

const apiGet = vi.fn((path: string) => {
  if (path === '/api/conversations') return Promise.resolve([])
  return Promise.resolve({ id: 1, messages: [] })
})

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: apiGet,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}))

vi.mock('~/composables/useChatStream', async (importOriginal) => {
  const orig = await importOriginal<typeof import('~/composables/useChatStream')>()
  return {
    ...orig,
    sendChatMessage: vi.fn(async (_payload, callbacks) => {
      callbacks.onSession?.(1)
      return { conversationId: 1, runId: null, text: '', cancelled: false }
    }),
  }
})

describe('ChatHub first-message emit', () => {
  it('emits first-message exactly once, on the first send of a new chat', async () => {
    const { default: ChatHub } = await import('@holzi/ui/components/chat/Hub.vue')
    const wrapper = mount(ChatHub, {
      global: {
        stubs: {
          ChatConversationList: true,
          Teleport: true,
        },
      },
    })

    const composer = wrapper.findComponent({ name: 'ChatComposer' })
    await composer.vm.$emit('send', { text: 'Hello there', files: [] })
    await composer.vm.$emit('send', { text: 'Second message', files: [] })

    expect(wrapper.emitted('first-message')).toEqual([['Hello there']])
  })
})
```

**Step 2: Run it to verify it fails**

Run: `pnpm --filter @holzi/frontend exec vitest run tests/components/ChatHub.first-message.test.ts`
Expected: FAIL — `wrapper.emitted('first-message')` is `undefined` (event
not yet declared/emitted).

**Step 3: Implement the emit**

In `packages/holzi-ui/components/chat/Hub.vue`, add the emit declaration
near the top, after `const props = withDefaults(...)`:

```typescript
const emit = defineEmits<{ 'first-message': [text: string] }>()
```

In `send`, fire it once `text`/`files` have been resolved (after the
"pure slash command" early return, before the optimistic message is
pushed) — guarded by `messages.value.length === 0`:

```typescript
  if (!text && !files.length) {
    // Pure slash command — override is set, nothing to send.
    return
  }

  if (messages.value.length === 0) {
    emit('first-message', text)
  }

```

(insert the new `if` block directly after the existing early-return block,
before the `if (isStreaming.value) { ... }` check).

**Step 4: Run the test to verify it passes**

Run: `pnpm --filter @holzi/frontend exec vitest run tests/components/ChatHub.first-message.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/holzi-ui/components/chat/Hub.vue \
  apps/frontend/tests/components/ChatHub.first-message.test.ts
git commit -m "feat(holzi-ui): emit first-message on first send of a new chat"
```

---

## Task 4: VS Code webview — title from first message

### Step 1: Create the page override

Create `apps/vscode/webview/app/pages/index.vue`. This is a Nuxt layer
override of `packages/holzi-ui/pages/index.vue` (Nuxt resolves same-path
pages from the extending app over the extended layer):

```vue
<script setup lang="ts">
const { $vscode } = useNuxtApp()

function onFirstMessage(text: string) {
  const title = text.trim().replace(/\s+/g, ' ').slice(0, 50) || 'New Chat'
  $vscode.post({ type: 'set_title', title })
}
</script>

<template>
  <ChatHub @first-message="onFirstMessage" />
</template>
```

### Step 2: Handle `set_title` in `HolziPanel`

In `apps/vscode/extension/src/HolziPanel.ts`, in
`_handleWebviewMessage`, add a branch before the final
`unhandled webview message` log:

```typescript
  private async _handleWebviewMessage(msg: { type?: string }): Promise<void> {
    if (msg?.type === 'webview_ready') {
      const host = getHost() || 'https://holzi.haex.cloud'
      const token = await getToken(this.context)
      this.panel.webview.postMessage({ type: 'config', host, token })
      this.logger.appendLine(`[holzi] sent config (host=${host}, hasToken=${token.length > 0})`)
      return
    }
    if (msg?.type === 'set_title' && typeof (msg as { title?: unknown }).title === 'string') {
      this.panel.title = (msg as { title: string }).title
      return
    }
    this.logger.appendLine(`[holzi] unhandled webview message: ${JSON.stringify(msg)}`)
  }
```

### Step 3: Build the webview + extension

Run: `pnpm run build:vscode`
Expected: build succeeds with no errors (Nuxt picks up the new page,
extension TypeScript compiles).

### Step 4: Manual verification

- Run `holzi.openChat` twice → two independent panel tabs, each loads its
  own `/` (empty `ChatHub`).
- Send a message in one tab → that tab's title updates to a truncated
  version of the message; the other tab's title is unaffected.
- Reload the web frontend's `/` → always lands on an empty new chat.

### Step 5: Commit

```bash
git add apps/vscode/webview/app/pages/index.vue apps/vscode/extension/src/HolziPanel.ts
git commit -m "feat(vscode): set panel title from first chat message"
```

---

## Final Verification

Run: `pnpm --filter @holzi/frontend run test -- --run`
Expected: same pre-existing 45-failed-file baseline as before this work
(no new failures), `ChatHub.first-message.test.ts` passes.

Run: `pnpm run build`
Expected: full monorepo build (frontend, webview, extension) succeeds.
