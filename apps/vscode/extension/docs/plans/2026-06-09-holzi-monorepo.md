# Holzi Monorepo Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge holzi-frontend and holzi-vscode into a single pnpm monorepo with a shared Nuxt Layer (`packages/holzi-ui`) so both apps use the same chat UI components and composables.

**Architecture:** Pattern from `haextension` — shared code lives in `packages/holzi-ui` as a Nuxt Layer. Both `apps/frontend` (Nuxt) and `apps/vscode/webview` (Nuxt, `ssr:false`, static build) extend that layer. The VS Code extension host stays in `apps/vscode/extension`. Transport differences (HTTP/SSE in frontend vs. postMessage in webview) are handled by a `useChatTransport` composable that each app overrides locally.

**Tech Stack:** pnpm workspaces, Nuxt 4 Layers, Vue 3, Pinia, Tailwind CSS v4, TypeScript, `nuxt generate` for webview static bundle

---

## Repo Layout (target)

```
/home/haex/Projekte/holzi/
├── apps/
│   ├── frontend/              ← holzi-frontend (Nuxt, full web app)
│   └── vscode/
│       ├── extension/         ← VS Code extension host (TypeScript)
│       └── webview/           ← Nuxt app (ssr:false, static → out/webview/)
├── packages/
│   └── holzi-ui/              ← Nuxt Layer: shared components + composables
├── pnpm-workspace.yaml
└── package.json
```

---

## Task 1: Create monorepo scaffold

**Files:**
- Create: `/home/haex/Projekte/holzi/pnpm-workspace.yaml`
- Create: `/home/haex/Projekte/holzi/package.json`
- Create dirs: `apps/frontend/`, `apps/vscode/extension/`, `apps/vscode/webview/`, `packages/holzi-ui/`

**Step 1: Create root directory and pnpm-workspace.yaml**

```bash
mkdir -p /home/haex/Projekte/holzi
cd /home/haex/Projekte/holzi
mkdir -p apps/frontend apps/vscode/extension apps/vscode/webview packages/holzi-ui
```

**Step 2: Write pnpm-workspace.yaml**

```yaml
packages:
  - 'apps/*'
  - 'apps/vscode/*'
  - 'packages/*'
```

**Step 3: Write root package.json**

```json
{
  "name": "holzi",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.2",
  "scripts": {
    "dev:frontend": "pnpm --filter @holzi/frontend dev",
    "dev:webview": "pnpm --filter @holzi/webview dev",
    "build:frontend": "pnpm --filter @holzi/frontend build",
    "build:vscode": "pnpm --filter @holzi/webview generate && pnpm --filter @holzi/extension build"
  }
}
```

**Step 4: Verify**

```bash
cd /home/haex/Projekte/holzi && ls apps/ apps/vscode/ packages/
```
Expected: directories exist without error.

**Step 5: Commit**

```bash
cd /home/haex/Projekte/holzi && git init
git add pnpm-workspace.yaml package.json
git commit -m "chore: init holzi monorepo scaffold"
```

---

## Task 2: Create `packages/holzi-ui` Nuxt Layer

Model from: `haextension/packages/haex-ui/` — especially how `nuxt.config.ts` registers component prefixes and how `package.json` sets `"main": "./nuxt.config.ts"`.

**Files:**
- Create: `packages/holzi-ui/package.json`
- Create: `packages/holzi-ui/nuxt.config.ts`
- Create: `packages/holzi-ui/components/` (empty, populated in Task 4)
- Create: `packages/holzi-ui/composables/` (empty, populated in Task 5)

**Step 1: Write package.json**

```json
{
  "name": "@holzi/ui",
  "version": "0.1.0",
  "type": "module",
  "main": "./nuxt.config.ts",
  "dependencies": {
    "@vueuse/core": "^14.3.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "dompurify": "^3.4.6",
    "katex": "^0.17.0",
    "lucide-vue-next": "^1.0.0",
    "markdown-it": "^14.2.0",
    "mermaid": "^11.15.0",
    "nuxt": "^4.4.6",
    "pinia": "^3.0.4",
    "reka-ui": "^2.9.8",
    "tailwind-merge": "^3.6.0",
    "vue": "^3.5.34"
  }
}
```

**Step 2: Write nuxt.config.ts**

```typescript
export default defineNuxtConfig({
  components: [
    {
      path: './components/chat',
      prefix: 'Chat',
      pathPrefix: false,
      extensions: ['.vue'],
      global: true,
    },
    {
      path: './components/ui',
      prefix: 'Ui',
      pathPrefix: false,
      extensions: ['.vue'],
      global: true,
    },
  ],
})
```

**Step 3: Create placeholder index files**

```bash
mkdir -p packages/holzi-ui/components/chat packages/holzi-ui/components/ui packages/holzi-ui/composables packages/holzi-ui/types
touch packages/holzi-ui/components/chat/.gitkeep packages/holzi-ui/composables/.gitkeep
```

**Step 4: Install**

```bash
cd /home/haex/Projekte/holzi && pnpm install
```
Expected: no errors, `packages/holzi-ui` appears in workspace.

**Step 5: Commit**

```bash
git add packages/holzi-ui/
git commit -m "feat: add holzi-ui Nuxt Layer skeleton"
```

---

## Task 3: Move holzi-frontend → `apps/frontend`

**Step 1: Copy repo**

```bash
cp -r /home/haex/Projekte/holzi-frontend/. /home/haex/Projekte/holzi/apps/frontend/
```

**Step 2: Update package name in `apps/frontend/package.json`**

Change `"name": "holzi-frontend"` → `"name": "@holzi/frontend"`.

**Step 3: Add layer extension to `apps/frontend/nuxt.config.ts`**

Add at the top of `defineNuxtConfig({...})`:

```typescript
extends: ['../../packages/holzi-ui'],
```

**Step 4: Install and verify**

```bash
cd /home/haex/Projekte/holzi && pnpm install
cd apps/frontend && pnpm dev
```
Expected: dev server starts, app works exactly as before (no components moved yet).

**Step 5: Commit**

```bash
cd /home/haex/Projekte/holzi
git add apps/frontend/
git commit -m "feat: add holzi-frontend as apps/frontend"
```

---

## Task 4: Extract shared chat components into holzi-ui

Components to move from `apps/frontend/app/components/chat/` to `packages/holzi-ui/components/chat/`:

- `ChatMessage.vue`
- `ChatComposer.vue`
- `AttachmentChip.vue`
- `CommandPicker.vue`
- `ToolCallCard.vue`
- `ReasoningCard.vue`
- `ApprovalCard.vue`
- `SubagentCard.vue`
- `McpInstallApprovalDetails.vue`
- `EmptyChatState.vue`
- `RenderedMarkdown.vue`
- `ErrorCard.vue`
- `SandboxCrashCard.vue`
- `HeaderPill.vue`

**NOT moved** (app-specific): `ChatHub.vue`, `ConversationList.vue`

**Step 1: Move files**

```bash
cd /home/haex/Projekte/holzi
for f in ChatMessage ChatComposer AttachmentChip CommandPicker ToolCallCard ReasoningCard ApprovalCard SubagentCard McpInstallApprovalDetails EmptyChatState RenderedMarkdown ErrorCard SandboxCrashCard HeaderPill; do
  mv apps/frontend/app/components/chat/${f}.vue packages/holzi-ui/components/chat/
done
```

**Step 2: Fix `~/` path aliases in moved components**

The moved components use `~/components/ui/...` imports. In the Nuxt Layer, these become `#components` or the component prefix system handles them automatically. Search for any remaining `~/` references:

```bash
grep -r "from '~/" packages/holzi-ui/components/chat/ --include="*.vue"
```

If any remain, replace `~/types/api` with a relative path `../../types/api` (types will live in the layer at `packages/holzi-ui/types/api.ts` — move them in this step).

**Step 3: Move shared types**

```bash
cp apps/frontend/app/types/api.ts packages/holzi-ui/types/api.ts
```

Update all `~/types/api` references in moved components to `~/types/api` — these will resolve via Nuxt Layer's own `~/` pointing to `packages/holzi-ui/`.

**Step 4: Verify frontend still builds**

```bash
cd /home/haex/Projekte/holzi/apps/frontend && pnpm dev
```
Expected: dev server starts, chat page renders correctly.

**Step 5: Commit**

```bash
cd /home/haex/Projekte/holzi
git add packages/holzi-ui/components/ packages/holzi-ui/types/
git add apps/frontend/
git commit -m "feat: extract shared chat components into holzi-ui layer"
```

---

## Task 5: Extract shared composables with transport abstraction

**Goal:** Move composables to `packages/holzi-ui/composables/` but keep transport (HTTP/SSE vs. postMessage) overridable per app.

**Pattern:**
- `packages/holzi-ui/composables/useChatTransport.ts` — defines the interface, throws if not overridden
- `apps/frontend/composables/useChatTransport.ts` — HTTP/SSE implementation (current `useChatStream`)
- `apps/vscode/webview/composables/useChatTransport.ts` — postMessage implementation (Task 6)

**Step 1: Move non-transport composables to holzi-ui**

These are safe to share as-is (pure data transformation or backend-agnostic):

```bash
cd /home/haex/Projekte/holzi
for f in useModels usePersonas useSkills useTools useLlmCredentials useReasoningPreference useToast useConfirm usePromptDialog; do
  mv apps/frontend/app/composables/${f}.ts packages/holzi-ui/composables/
done
```

**Step 2: Move `useApi.ts` and replace `$fetch` with an injectable**

`useApi.ts` currently uses Nuxt's `$fetch`. Move it to the layer and make the fetcher injectable:

```typescript
// packages/holzi-ui/composables/useApi.ts
export function useApi(fetcher = $fetch) {
  // ... rest of implementation unchanged, replace $fetch calls with fetcher(...)
}
```

Move: `mv apps/frontend/app/composables/useApi.ts packages/holzi-ui/composables/useApi.ts`

Then edit per above. In `apps/frontend`, no override needed — Nuxt's `$fetch` is the default.

**Step 3: Define the transport interface**

Create `packages/holzi-ui/composables/useChatTransport.ts`:

```typescript
// Default implementation throws — each app must provide its own version.
export function useChatTransport() {
  throw new Error('useChatTransport must be implemented by the app layer')
}
```

**Step 4: Move `useChatStream.ts` to frontend (it IS the transport)**

`useChatStream` is the HTTP/SSE implementation for the web frontend. It stays in `apps/frontend`:

```bash
# already there, no move needed — just confirm it stays at:
# apps/frontend/app/composables/useChatStream.ts
```

Rename it to match the interface: `useChatTransport.ts` in `apps/frontend/app/composables/`.

**Step 5: Fix remaining `~/` imports in moved composables**

```bash
grep -r "from '~/" packages/holzi-ui/composables/ --include="*.ts"
```

Replace `~/stores/auth` with relative import or move the auth store to the layer (it's generic enough).

**Step 6: Verify**

```bash
cd /home/haex/Projekte/holzi/apps/frontend && pnpm dev
```
Expected: frontend works, no import errors.

**Step 7: Commit**

```bash
cd /home/haex/Projekte/holzi
git add packages/holzi-ui/composables/ apps/frontend/
git commit -m "feat: extract shared composables into holzi-ui, add transport interface"
```

---

## Task 6: Create `apps/vscode/webview` Nuxt app

A minimal Nuxt SPA that renders the chat panel. No routing (single page). Communicates with the extension host via `vscode.acquireVsCodeApi().postMessage`.

**Step 1: Scaffold new Nuxt app**

```bash
cd /home/haex/Projekte/holzi/apps/vscode/webview
pnpm dlx nuxi init . --no-install --template minimal
```

**Step 2: Write `package.json`**

```json
{
  "name": "@holzi/webview",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nuxt dev",
    "generate": "nuxt generate",
    "postinstall": "nuxt prepare"
  },
  "dependencies": {
    "@holzi/ui": "workspace:*",
    "nuxt": "^4.4.6"
  }
}
```

**Step 3: Write `nuxt.config.ts`**

```typescript
export default defineNuxtConfig({
  extends: ['../../../packages/holzi-ui'],
  ssr: false,
  compatibilityDate: '2025-07-15',

  // Output directly into extension's expected location
  nitro: {
    output: {
      publicDir: '../extension/out/webview',
    },
  },
})
```

**Step 4: Write the transport composable**

Create `apps/vscode/webview/composables/useChatTransport.ts`:

```typescript
// postMessage-based transport for VS Code webview.
// The extension host handles WebSocket/HTTP — we just relay via the VS Code API.
export function useChatTransport() {
  const vscodeApi = window.acquireVsCodeApi?.()

  function send(message: unknown) {
    vscodeApi?.postMessage(message)
  }

  function onMessage(handler: (data: unknown) => void) {
    window.addEventListener('message', (event) => handler(event.data))
  }

  return { send, onMessage }
}
```

**Step 5: Write the single page `app/app.vue`**

```vue
<template>
  <div class="h-screen flex flex-col">
    <!-- ChatHub without routing: just the chat panel -->
    <ChatComposer ... />
    <ChatMessageList ... />
  </div>
</template>
```

Wire up the transport composable to the same events the extension host sends (same format as current `HolziPanel` postMessage protocol).

**Step 6: Verify build**

```bash
cd /home/haex/Projekte/holzi/apps/vscode/webview && pnpm install && pnpm generate
```
Expected: `.output/public/` (or `../extension/out/webview/`) contains `index.html` and `_nuxt/` assets.

**Step 7: Commit**

```bash
cd /home/haex/Projekte/holzi
git add apps/vscode/webview/
git commit -m "feat: add vscode webview as Nuxt SPA with postMessage transport"
```

---

## Task 7: Move extension host → `apps/vscode/extension`, update _buildHtml

**Step 1: Copy extension host**

```bash
cp -r /home/haex/Projekte/holzi-vscode/. /home/haex/Projekte/holzi/apps/vscode/extension/
# Remove the old webview source (replaced by apps/vscode/webview)
rm -rf /home/haex/Projekte/holzi/apps/vscode/extension/src/webview
```

**Step 2: Update `package.json`**

- Change `"name": "holzi-vscode"` → `"name": "@holzi/extension"`
- Remove webview build scripts (now handled by `apps/vscode/webview`)
- Keep vsce packaging scripts

**Step 3: Update `_buildHtml` in `src/HolziPanel.ts`**

Current code reads `src/webview/index.html` and replaces `{{MAIN_JS}}`. With Nuxt, the output is `out/webview/index.html` with multiple script/link tags pointing to `/_nuxt/...`.

Replace `_buildHtml` with a version that:
1. Reads `out/webview/index.html`
2. Rewrites all `/_nuxt/filename.js` src/href attributes with `webview.asWebviewUri(...)` 
3. Adds nonce to all `<script>` tags
4. Updates CSP header to allow the nonce

```typescript
private _buildHtml(context: vscode.ExtensionContext): string {
  const webview = this.panel.webview
  const nonce = crypto.randomUUID().replace(/-/g, '')

  const htmlPath = path.join(context.extensionPath, 'out', 'webview', 'index.html')
  let html = fs.readFileSync(htmlPath, 'utf-8')

  // Rewrite /_nuxt/... paths to webview URIs
  html = html.replace(/(src|href)="\/_nuxt\/([^"]+)"/g, (_match, attr, file) => {
    const uri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', '_nuxt', file)
    )
    return `${attr}="${uri}"`
  })

  // Add nonce to all script tags
  html = html.replace(/<script /g, `<script nonce="${nonce}" `)

  // Inject CSP
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  html = html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`)

  return html
}
```

**Step 4: Update `localResourceRoots`**

In `createOrShow`, change:
```typescript
localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
```

**Step 5: Remove vite.config.mts webview build**

The `vite.config.mts` is no longer needed for webview. Either delete it or repurpose for extension-only build.

**Step 6: Update `.vscodeignore` / packaging**

Ensure `out/webview/**` is included in the vsix package.

**Step 7: Build and test**

```bash
cd /home/haex/Projekte/holzi
pnpm build:vscode
```
Expected: `apps/vscode/extension/out/webview/index.html` exists with `_nuxt/` assets.

Open VS Code, run extension via F5, verify Holzi panel loads.

**Step 8: Commit**

```bash
cd /home/haex/Projekte/holzi
git add apps/vscode/extension/
git commit -m "feat: move extension host, update _buildHtml for Nuxt static output"
```

---

## Task 8: Wire up monorepo build pipeline & cleanup

**Step 1: Add root-level build scripts**

In root `package.json`, add:

```json
"scripts": {
  "dev:frontend": "pnpm --filter @holzi/frontend dev",
  "dev:webview": "pnpm --filter @holzi/webview dev",
  "build": "pnpm --filter @holzi/ui build && pnpm --filter @holzi/frontend build && pnpm build:vscode",
  "build:vscode": "pnpm --filter @holzi/webview generate && pnpm --filter @holzi/extension build",
  "package:vscode": "pnpm build:vscode && pnpm --filter @holzi/extension package"
}
```

**Step 2: Add README-level note about old repos**

Both `holzi-frontend` and `holzi-vscode` originals can be archived on GitHub after verifying the monorepo builds and tests pass.

**Step 3: Run full build**

```bash
cd /home/haex/Projekte/holzi && pnpm install && pnpm build
```
Expected: all apps build without errors.

**Step 4: Run existing tests**

```bash
pnpm --filter @holzi/frontend test
pnpm --filter @holzi/extension test
```
Expected: all tests pass.

**Step 5: Final commit**

```bash
git add .
git commit -m "chore: complete monorepo wiring, build pipeline ready"
```

---

## Key Risks & Notes

- **Nuxt Layer `~/` resolution**: Inside `packages/holzi-ui`, `~/` resolves to that package's root, not the consuming app's root. Import paths that cross the layer boundary (e.g., types the app defines) must be passed as props or re-exported from the layer.

- **postMessage protocol compatibility**: `apps/vscode/webview/composables/useChatTransport.ts` must match the exact message shapes that `HolziPanel` currently posts. Check `HolziSocket.ts` and `HolziPanel.ts` for the full message format before implementing.

- **Nuxt 4 `app/` directory**: `apps/frontend` uses Nuxt 4's `app/` subdirectory layout. `apps/vscode/webview` should match this convention.

- **CSS in webview**: Nuxt injects CSS as separate `<link>` tags. The CSP in `_buildHtml` must allow `style-src` for webview URIs, not just `'unsafe-inline'`. Add the webview origin: `style-src ${webview.cspSource} 'unsafe-inline'`.

- **`vscode.acquireVsCodeApi()`**: Only available inside a VS Code webview. Guard with `typeof acquireVsCodeApi !== 'undefined'` so the webview can still run under `nuxt dev` for local development.
