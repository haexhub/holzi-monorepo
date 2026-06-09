# Holzi Monorepo Phase 2: Webview = Frontend Unification

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Webview wird ein statisch generiertes Nuxt-SPA, gebaut aus exakt derselben Quelle wie das Web-Frontend. Beide reden direkt mit Hermes. Die VS-Code-Extension reduziert sich auf Token-Injection + Bridge für VS-Code-native Tools.

**Architecture:** Das Nuxt-Layer-Package `packages/holzi-ui/` wird zur kompletten App (Komponenten, Composables, Stores, Pages, Middleware, Layouts, i18n, Assets). `apps/frontend/` und `apps/vscode/webview/` sind dünne Shells (nuxt.config + package.json + Boot-Plugins). Webview hat zwei zusätzliche Plugins: Auth-Bootstrap (Token vom Extension Host per postMessage) und Tool-Bridge (lokale VS-Code-Tools per postMessage delegieren). Die Extension liefert nur noch Config + Tool-Ausführung — kein WebSocket, kein Chat-State.

**Tech Stack:** Nuxt 4 Layers, Vue 3, Pinia, Tailwind CSS v4, TypeScript, `nuxt generate` für statisches Webview-Bundle, VS Code Webview API für Extension-Bridge.

---

## Vor Beginn — aktueller Stand

**Was bereits existiert** (aus Phase 1, Tasks 1–5):
- `packages/holzi-ui/` enthält:
  - 14 Chat-Komponenten unter `components/chat/`
  - 10 UI-Primitive unter `components/ui/`
  - `utils/markdown.ts`, `lib/utils.ts`, `types/api.ts`
  - 5 pure Composables: `useToast`, `useConfirm`, `usePromptDialog`, `useChatQueue`, `useReasoningPreference`
- `apps/frontend/` extends den Layer, Dev-Server läuft auf Port 3001
- Working tree clean, 5 Commits in `/home/haex/Projekte/holzi/`

**Was noch in `apps/frontend/app/` steckt** (muss in den Layer wandern):
- 14 HTTP-gekoppelte Composables (`useApi`, `useChatStream`, `useModels`, …)
- 2 Stores (`auth.ts`, `lastConversation.ts`)
- 3 Lib-Module (`errorMessages.ts`, `pricing.ts`, `settingsNav.ts`)
- Pages (`pages/chat/`, `pages/settings/`, `pages/index.vue`, `pages/login.vue`, `pages/settings.vue`)
- Middleware (`auth.global.ts`)
- Layout (`default.vue`)
- Assets (`assets/css/`)
- `i18n/locales/{de,en}.json` + i18n-Konfig in `nuxt.config.ts`
- App-Root: `app.vue`
- Restliche Komponenten: `ChatHub.vue`, `AppConfirmHost.vue`, `ThemeToggle.vue`, `panels/*`, `settings/*`, `chat/ConversationList.vue`

---

## Task 1: Move HTTP composables + stores + lib + i18n module config

**Goal:** Alle HTTP-gekoppelten Composables, beide Stores, drei Lib-Module und die i18n-Modulregistrierung wandern in den Layer. Frontend importiert weiter dieselben Pfade — `~/composables/useApi` löst dann auf den Layer auf.

**Files moved:**

```
apps/frontend/app/composables/{useApi,useChannels,useChatStream,useDiagnostics,useInsights,useLlmCredentials,useLogs,useMcpHealth,useMcpServers,useModels,usePersonas,useSkills,useTasks,useTools}.ts
→ packages/holzi-ui/composables/

apps/frontend/app/stores/{auth,lastConversation}.ts
→ packages/holzi-ui/stores/

apps/frontend/app/lib/{errorMessages,pricing,settingsNav}.ts
→ packages/holzi-ui/lib/
```

**Files modified:**
- `packages/holzi-ui/nuxt.config.ts` — register `@pinia/nuxt`, `@vueuse/nuxt`, `@nuxtjs/i18n` modules
- `packages/holzi-ui/package.json` — add `@pinia/nuxt`, `@vueuse/nuxt`, `@nuxtjs/i18n`, `pinia` deps (some already there)
- `apps/frontend/nuxt.config.ts` — REMOVE `modules: [...]` and `i18n: {...}` blocks (now provided by layer)
- `packages/holzi-ui/i18n/` — copy from `apps/frontend/i18n/`

**Step 1: Move files with git mv**

```bash
cd /home/haex/Projekte/holzi
for f in useApi useChannels useChatStream useDiagnostics useInsights useLlmCredentials useLogs useMcpHealth useMcpServers useModels usePersonas useSkills useTasks useTools; do
  git mv apps/frontend/app/composables/${f}.ts packages/holzi-ui/composables/
done

mkdir -p packages/holzi-ui/stores packages/holzi-ui/lib
git mv apps/frontend/app/stores/auth.ts packages/holzi-ui/stores/
git mv apps/frontend/app/stores/lastConversation.ts packages/holzi-ui/stores/
git mv apps/frontend/app/lib/errorMessages.ts packages/holzi-ui/lib/
git mv apps/frontend/app/lib/pricing.ts packages/holzi-ui/lib/
git mv apps/frontend/app/lib/settingsNav.ts packages/holzi-ui/lib/
```

**Step 2: Move i18n locales + config**

```bash
mkdir -p packages/holzi-ui/i18n
git mv apps/frontend/i18n/locales packages/holzi-ui/i18n/
```

**Step 3: Update `packages/holzi-ui/nuxt.config.ts`**

```typescript
export default defineNuxtConfig({
  modules: ['@pinia/nuxt', '@vueuse/nuxt', '@nuxtjs/i18n'],

  components: [
    { path: './components/chat', prefix: 'Chat', pathPrefix: false, extensions: ['.vue'], global: true },
    { path: './components/ui', prefix: 'Ui', pathPrefix: false, extensions: ['.vue'], global: true },
  ],

  imports: {
    dirs: ['utils', 'composables', 'stores', 'lib'],
  },

  i18n: {
    strategy: 'prefix_except_default',
    defaultLocale: 'de',
    locales: [
      { code: 'de', name: 'Deutsch', file: 'de.json' },
      { code: 'en', name: 'English', file: 'en.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_locale',
      redirectOn: 'root',
    },
  },
})
```

**Step 4: Update `packages/holzi-ui/package.json`**

Add to `dependencies` (versions matching `apps/frontend/package.json`):
- `@pinia/nuxt`: `^0.11.3`
- `@vueuse/nuxt`: `^14.3.0`
- `@nuxtjs/i18n`: `^10.4.0`

(`pinia` is already present.)

**Step 5: Update `apps/frontend/nuxt.config.ts`**

Remove the now-redundant blocks: `modules: [...]`, `i18n: {...}`. Layer provides them.
The `extends: ['../../packages/holzi-ui']` stays at the top.
Keep `vite.plugins`, `devServer`, `nitro.devProxy` — those are frontend-specific.

**Step 6: Remove empty frontend i18n dir**

```bash
rmdir apps/frontend/i18n 2>/dev/null || true
```

**Step 7: Install + verify frontend dev server**

```bash
cd /home/haex/Projekte/holzi && pnpm install
cd apps/frontend && timeout 30 pnpm dev 2>&1 | tail -40 || true
```

Expected: clean startup on port 3001, no resolve errors. Routes like `/chat`, `/settings/preferences` should still work — they reach the Hermes backend via the dev proxy as before.

**Step 8: Commit**

```bash
cd /home/haex/Projekte/holzi
git add -A
git commit -m "feat: move HTTP composables, stores, lib, i18n into holzi-ui layer"
```

---

## Task 2: Move pages, middleware, layouts, assets into layer

**Goal:** Alle Routen werden Teil des Layers. Beide Apps zeigen automatisch dieselben Pages.

**Files moved:**
- `apps/frontend/app/pages/` → `packages/holzi-ui/pages/`
- `apps/frontend/app/middleware/` → `packages/holzi-ui/middleware/`
- `apps/frontend/app/layouts/` → `packages/holzi-ui/layouts/`
- `apps/frontend/app/assets/` → `packages/holzi-ui/assets/`
- `apps/frontend/app/app.vue` → `packages/holzi-ui/app.vue`

**Files modified:**
- `apps/frontend/nuxt.config.ts` — entferne `css: [...]` block (Layer liefert)

**Step 1: Move directories**

```bash
cd /home/haex/Projekte/holzi
git mv apps/frontend/app/pages packages/holzi-ui/pages
git mv apps/frontend/app/middleware packages/holzi-ui/middleware
git mv apps/frontend/app/layouts packages/holzi-ui/layouts
git mv apps/frontend/app/assets packages/holzi-ui/assets
git mv apps/frontend/app/app.vue packages/holzi-ui/app.vue
```

**Step 2: Update `packages/holzi-ui/nuxt.config.ts`**

Add `css: ['~/assets/css/tailwind.css', 'katex/dist/katex.min.css']` to the layer's config. Also add Tailwind via `vite.plugins` if not already present:

```typescript
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  // ... existing modules, components, imports, i18n ...
  css: ['~/assets/css/tailwind.css', 'katex/dist/katex.min.css'],
  vite: {
    plugins: [tailwindcss()],
  },
})
```

**Step 3: Update layer `package.json`**

Add `@tailwindcss/vite`, `tailwindcss`, `tw-animate-css` to dependencies (copy versions from frontend's package.json).

**Step 4: Update `apps/frontend/nuxt.config.ts`**

Entferne `css: [...]` und `vite.plugins` (Layer liefert beides). Behalte `devServer.port`, `nitro.devProxy`, `compatibilityDate`.

**Step 5: Tailwind config**

Check ob `apps/frontend/` einen `tailwind.config.ts` o.ä. hat (Tailwind v4 nutzt CSS-Konfiguration im `tailwind.css`). Falls eine externe Config existiert: verschiebe sie in den Layer.

**Step 6: Verify frontend**

```bash
cd /home/haex/Projekte/holzi/apps/frontend && timeout 30 pnpm dev 2>&1 | tail -40 || true
```

Lade `http://localhost:3001/`, `http://localhost:3001/chat`, `http://localhost:3001/settings/preferences` im Browser. Alle drei sollten rendern.

**Step 7: Commit**

```bash
cd /home/haex/Projekte/holzi
git add -A
git commit -m "feat: move pages, middleware, layouts, assets, app.vue into holzi-ui layer"
```

---

## Task 3: Move remaining shared components into layer

**Goal:** Auch die noch app-residenten Komponenten (`ChatHub`, `ConversationList`, `AppConfirmHost`, `ThemeToggle`, `panels/*`, `settings/*`) ziehen um.

**Files moved:**
- `apps/frontend/app/components/ChatHub.vue` → `packages/holzi-ui/components/chat/Hub.vue`
- `apps/frontend/app/components/chat/ConversationList.vue` → `packages/holzi-ui/components/chat/ConversationList.vue`
- `apps/frontend/app/components/AppConfirmHost.vue` → `packages/holzi-ui/components/AppConfirmHost.vue`
- `apps/frontend/app/components/ThemeToggle.vue` → `packages/holzi-ui/components/ThemeToggle.vue`
- `apps/frontend/app/components/panels/` → `packages/holzi-ui/components/panels/`
- `apps/frontend/app/components/settings/` → `packages/holzi-ui/components/settings/`

**Hinweis zu Naming:** `ChatHub.vue` → unter `components/chat/Hub.vue` mit `prefix: 'Chat'` wird das im Template `<ChatHub>` — semantisch identisch zu vorher. Falls das nicht so funktioniert (z.B. weil bereits ein `<ChatHub>` im Layer-Scan vorkommt), behalte den Namen `ChatHub.vue` außerhalb von `components/chat/` und registriere unter dem Root-`components/`-Path im Layer.

**Step 1: Verify naming/scan strategy**

Check Layer `nuxt.config.ts` — wenn der `prefix: 'Chat'` zusammen mit `pathPrefix: false` für `components/chat/` greift, wird `Hub.vue` zu `<ChatHub>`. Das passt.

Falls Konflikte: Layer um einen zusätzlichen Scan-Eintrag für `components/` (kein Prefix) erweitern.

**Step 2: Move files**

```bash
cd /home/haex/Projekte/holzi
git mv apps/frontend/app/components/ChatHub.vue packages/holzi-ui/components/chat/Hub.vue
git mv apps/frontend/app/components/chat/ConversationList.vue packages/holzi-ui/components/chat/ConversationList.vue
git mv apps/frontend/app/components/AppConfirmHost.vue packages/holzi-ui/components/AppConfirmHost.vue
git mv apps/frontend/app/components/ThemeToggle.vue packages/holzi-ui/components/ThemeToggle.vue
git mv apps/frontend/app/components/panels packages/holzi-ui/components/panels
git mv apps/frontend/app/components/settings packages/holzi-ui/components/settings
```

**Step 3: Erweitere `packages/holzi-ui/nuxt.config.ts` für die neuen Pfade**

```typescript
components: [
  { path: './components/chat', prefix: 'Chat', pathPrefix: false, extensions: ['.vue'], global: true },
  { path: './components/ui', prefix: 'Ui', pathPrefix: false, extensions: ['.vue'], global: true },
  { path: './components/panels', prefix: 'Panel', pathPrefix: false, extensions: ['.vue'], global: true },
  { path: './components/settings', prefix: 'Settings', pathPrefix: false, extensions: ['.vue'], global: true },
  { path: './components', pathPrefix: false, extensions: ['.vue'], global: true },
],
```

**Step 4: Clean up empty dirs in frontend**

```bash
cd /home/haex/Projekte/holzi
rmdir apps/frontend/app/components/chat 2>/dev/null || true
rmdir apps/frontend/app/components 2>/dev/null || true
```

**Step 5: Verify**

```bash
cd apps/frontend && timeout 30 pnpm dev 2>&1 | tail -40 || true
```

Routes prüfen: `/`, `/chat`, `/settings/preferences`, `/settings/skills`. Alle müssen rendern.

**Step 6: Commit**

```bash
cd /home/haex/Projekte/holzi
git add -A
git commit -m "feat: move remaining shared components (ChatHub, panels, settings) into holzi-ui layer"
```

---

## Task 4: Thin out apps/frontend to a shell + smoke test end-to-end

**Goal:** Frontend besteht jetzt nur noch aus Konfig + Boot. Alles andere ist Layer.

**Was im Frontend bleibt:**
- `nuxt.config.ts` (nur Dev-spezifisches: Port, Proxy)
- `package.json` (Scripts, Frontend-spezifische Deps)
- `tsconfig.json`
- `i18n/` (leer oder weg)
- `app/` sollte LEER sein

**Erwartete `apps/frontend/nuxt.config.ts` (final):**

```typescript
export default defineNuxtConfig({
  extends: ['../../packages/holzi-ui'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  ssr: false,
  devServer: { port: 3001 },
  nitro: {
    devProxy: {
      '/api': {
        target: 'http://localhost:8082/api',
        changeOrigin: true,
      },
    },
  },
})
```

**Step 1: Inventur — was ist noch in `apps/frontend/app/`?**

```bash
find /home/haex/Projekte/holzi/apps/frontend/app -type f
```

Sollte leer sein. Falls Reste:
- Falls reine API-types (`api-generated.ts`): in den Layer (`packages/holzi-ui/types/`) verschieben
- Falls App-spezifisch (z.B. dev-only Tooling): bleiben
- Falls vergessen: noch hinterherziehen

**Step 2: Lösche leere `apps/frontend/app/` Hierarchie**

```bash
find /home/haex/Projekte/holzi/apps/frontend/app -type d -empty -delete
```

**Step 3: Bereinige `apps/frontend/package.json`**

Behalte: Build-Scripts, Type-Check, Test. Entferne UI-spezifische Deps, die jetzt im Layer leben:
- `@vueuse/core`, `@vueuse/nuxt`
- `@nuxtjs/i18n`, `@pinia/nuxt`, `pinia`
- `@shikijs/markdown-it`, `@vscode/markdown-it-katex`, `dompurify`, `katex`, `lucide-vue-next`, `markdown-it`, `mermaid`, `reka-ui`, `tailwind-merge`, `class-variance-authority`, `clsx`
- `@tailwindcss/vite`, `tailwindcss`, `tw-animate-css`
- `vue-sonner`

Behalte: `nuxt`, `vue` (Nuxt selbst braucht's), `vue-router`, evtl. Test-Tools.

Auf `@holzi/ui` dependency umstellen:
```json
"dependencies": {
  "@holzi/ui": "workspace:*",
  "nuxt": "^4.4.6",
  "vue": "^3.5.34",
  "vue-router": "^5.0.7"
}
```

**Step 4: pnpm install + smoke test**

```bash
cd /home/haex/Projekte/holzi && pnpm install
cd apps/frontend && timeout 30 pnpm dev 2>&1 | tail -40 || true
```

Im Browser testen: `/`, `/chat`, `/login`, `/settings/preferences`, `/settings/skills`, `/settings/llm`. Settings-Navigation, ConfirmHost-Modals, Toasts.

**Step 5: Commit**

```bash
cd /home/haex/Projekte/holzi
git add -A
git commit -m "refactor: thin apps/frontend to a layer shell"
```

---

## Task 5: Scaffold apps/vscode/webview as Nuxt SPA

**Goal:** Zweite App, die denselben Layer extends. `ssr: false`, `nuxt generate` → statisches Bundle in `out/webview/`.

**Files created:**
- `apps/vscode/webview/package.json`
- `apps/vscode/webview/nuxt.config.ts`
- `apps/vscode/webview/tsconfig.json`

**Step 1: Schreibe `apps/vscode/webview/package.json`**

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
    "nuxt": "^4.4.6",
    "vue": "^3.5.34",
    "vue-router": "^5.0.7"
  }
}
```

**Step 2: Schreibe `apps/vscode/webview/nuxt.config.ts`**

```typescript
export default defineNuxtConfig({
  extends: ['../../../packages/holzi-ui'],
  compatibilityDate: '2025-07-15',
  ssr: false,
  devServer: { port: 3002 },

  // nuxt generate → static SPA into ../extension/out/webview
  nitro: {
    static: true,
    output: {
      publicDir: '../extension/out/webview',
    },
  },

  app: {
    // VS Code webview lädt assets über vscode-resource-Schema; relative Pfade
    // werden in HolziPanel._buildHtml zu webview.asWebviewUri umgeschrieben.
    baseURL: './',
    buildAssetsDir: '_nuxt/',
  },

  // Webview hat kein eigenes Backend — alle Requests gehen direkt zum
  // konfigurierten Hermes (via auth-store.host, kein Dev-Proxy).
})
```

**Step 3: Schreibe `apps/vscode/webview/tsconfig.json`**

```json
{
  "extends": "./.nuxt/tsconfig.json"
}
```

**Step 4: pnpm install + dev-server test**

```bash
cd /home/haex/Projekte/holzi && pnpm install
cd apps/vscode/webview && timeout 30 pnpm dev 2>&1 | tail -40 || true
```

Erwartung: Dev-Server startet auf Port 3002. Im Browser sollte die App rendern — auf `/login` umgeleitet werden (auth.global.ts blockiert ohne Token). Settings-Page sollte sichtbar werden, wenn man manuell einen Token in localStorage setzt.

**Step 5: Build-test**

```bash
cd /home/haex/Projekte/holzi/apps/vscode/webview && pnpm generate
ls /home/haex/Projekte/holzi/apps/vscode/extension/out/webview/ || ls /home/haex/Projekte/holzi/apps/vscode/webview/.output/public/
```

Erwartet: `index.html`, `_nuxt/` mit gebundelten Assets.

**Step 6: Commit**

```bash
cd /home/haex/Projekte/holzi
git add apps/vscode/webview/
git commit -m "feat: scaffold apps/vscode/webview as Nuxt SPA extending holzi-ui"
```

---

## Task 6: Webview auth bootstrap via postMessage

**Goal:** Im Webview-Kontext muss der Token NICHT per Login-Form rein, sondern beim Boot von der Extension geliefert werden. Dazu ein Nuxt-Plugin, das auf das `config`-Event vom Extension Host hört und den auth-store seedet.

**Files created:**
- `apps/vscode/webview/app/plugins/vscode-auth.client.ts`
- `apps/vscode/webview/app/plugins/vscode-bridge.client.ts` (gemeinsamer postMessage-Singleton)

**Step 1: Bridge plugin** — `apps/vscode/webview/app/plugins/vscode-bridge.client.ts`

```typescript
// Singleton wrapper für vscode.acquireVsCodeApi() — darf nur EINMAL pro Webview
// aufgerufen werden, deshalb hier zentral provided.

interface VsCodeApi {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi
  }
}

export default defineNuxtPlugin(() => {
  const api = window.acquireVsCodeApi?.() ?? null

  // Listener-Registry: mehrere Plugins können Events abonnieren
  const listeners = new Set<(data: any) => void>()
  window.addEventListener('message', (e) => {
    for (const fn of listeners) fn(e.data)
  })

  function post(msg: unknown) {
    api?.postMessage(msg)
  }

  function onMessage(handler: (data: any) => void): () => void {
    listeners.add(handler)
    return () => listeners.delete(handler)
  }

  return {
    provide: {
      vscode: { post, onMessage, available: api !== null },
    },
  }
})
```

**Step 2: Auth bootstrap** — `apps/vscode/webview/app/plugins/vscode-auth.client.ts`

```typescript
import { useAuthStore } from '#imports'

export default defineNuxtPlugin((nuxtApp) => {
  const auth = useAuthStore()
  const { $vscode } = nuxtApp

  // Frage Config beim Mount an
  $vscode.post({ type: 'webview_ready' })

  // Hör auf config-Antwort
  $vscode.onMessage((msg: any) => {
    if (msg?.type === 'config' && typeof msg.token === 'string') {
      auth.setToken(msg.token)
      if (typeof msg.host === 'string') {
        // host wird vom auth-store oder einem dedizierten host-store gehalten —
        // wenn aktuell nicht vorhanden, in Task 1's auth-store ergänzen:
        // const host = useLocalStorage('hermes.host', '')
        // host.value = msg.host
      }
    }
  })
})
```

**Step 3: Erweitere `packages/holzi-ui/stores/auth.ts` um Host-State**

Aktuell hält der Store nur den Token. Für die Webview braucht es eine konfigurierbare Backend-URL (das Frontend nutzt heute relative Pfade + Dev-Proxy; produktiv läuft das hermes auf demselben Origin). Ergänze:

```typescript
const HOST_KEY = 'hermes.host'

export const useAuthStore = defineStore('auth', () => {
  const token = useLocalStorage<string>(TOKEN_KEY, '')
  const host = useLocalStorage<string>(HOST_KEY, '')

  const isAuthenticated = computed(() => token.value.length > 0)
  // baseUrl: wenn host gesetzt, nutze ihn; sonst leer = same-origin
  const baseUrl = computed(() => host.value || '')

  function setToken(value: string) { token.value = value.trim() }
  function setHost(value: string) { host.value = value.replace(/\/$/, '') }
  function clear() { token.value = ''; host.value = '' }

  return { token, host, baseUrl, isAuthenticated, setToken, setHost, clear }
})
```

**Step 4: Update `useApi.ts` für `baseUrl`**

In `packages/holzi-ui/composables/useApi.ts` müssen alle Requests `auth.baseUrl + path` nutzen statt nur `path`. Beispiel:

```typescript
const auth = useAuthStore()
const url = `${auth.baseUrl}${path}`
return $fetch(url as any, { ... })
```

Im Frontend bleibt `auth.baseUrl` leer → relative Pfade → Dev-Proxy → Hermes. Im Webview wird `auth.baseUrl` von Extension gesetzt → absolute URL.

**Step 5: Update `useChatStream.ts` analog**

`useChatStream` baut den SSE-Request via fetch — auch hier `baseUrl` voranstellen.

**Step 6: Test (Webview offline gegen Mock-Server oder echtes Hermes)**

```bash
cd /home/haex/Projekte/holzi/apps/vscode/webview && timeout 30 pnpm dev 2>&1 | tail -40 || true
```

Im Browser auf `http://localhost:3002/` aufrufen. Da `acquireVsCodeApi` im Browser fehlt, sollte:
- $vscode.available false sein
- Plugin kein config-Event auslösen
- App auf /login redirecten (das ist OK für Browser-Mode-Dev)

Um Webview-Flow zu testen: manuell in DevTools `localStorage.setItem('hermes.auth.token', 'test')` setzen und reloaden — App sollte auf /chat landen.

**Step 7: Commit**

```bash
cd /home/haex/Projekte/holzi
git add apps/vscode/webview/ packages/holzi-ui/
git commit -m "feat: webview auth bootstrap via postMessage, add host config to auth store"
```

---

## Task 7: Webview tool bridge for VS-Code-native tools

**Goal:** Wenn Hermes per SSE einen Tool-Call für VS-Code-spezifische Tools (`read_file`, `write_file`, `list_dir`, `run_command`, `get_selection`, `apply_diff`, `open_file`) anfordert, leitet die Webview ihn per postMessage an die Extension, holt das Result, und schickt es per HTTP zurück an Hermes.

**Architektur-Vorausnahme:** Hermes muss bereits einen "client-tools"-Mechanismus haben. Die alte Extension nutzt `HolziSocket` mit Tool-Call-Events. In der neuen Welt empfängt die Webview diese Events über `useChatStream` (SSE) und schickt Results via REST (Endpunkt z.B. `POST /api/chat/tool-result`). Falls der Endpunkt nicht existiert: Backend-Plan separat.

Für diesen Plan: nehmen wir an, der Endpunkt existiert oder wird parallel hinzugefügt.

**Files created:**
- `apps/vscode/webview/app/plugins/vscode-tool-bridge.client.ts`

**Files modified:**
- `packages/holzi-ui/composables/useChatStream.ts` — hookbar machen für Tool-Bridge

**Step 1: Hook-Mechanismus in `useChatStream.ts`**

Aktuell verarbeitet `useChatStream` Tool-Calls und übergibt sie an die UI. Für die Webview wollen wir ABER vor der UI-Anzeige checken, ob es ein VS-Code-Tool ist, und wenn ja, automatisch executen. Lösung: ein optionaler `onToolCall`-Hook, den Plugins registrieren können.

In `useChatStream.ts`:

```typescript
// Top-level oder als globaler Hook:
const toolCallInterceptors = new Set<(call: ToolCallData) => Promise<ToolResultData | null>>()

export function registerToolCallInterceptor(
  fn: (call: ToolCallData) => Promise<ToolResultData | null>
): () => void {
  toolCallInterceptors.add(fn)
  return () => toolCallInterceptors.delete(fn)
}

// Im Tool-Call-Handler von useChatStream:
//   for (const interceptor of toolCallInterceptors) {
//     const result = await interceptor(toolCall)
//     if (result) {
//       // result direkt verwenden, normale UI-Anzeige skip oder simulieren
//       break
//     }
//   }
```

**Step 2: Tool-Bridge plugin** — `apps/vscode/webview/app/plugins/vscode-tool-bridge.client.ts`

```typescript
import { registerToolCallInterceptor } from '#imports'

const LOCAL_TOOLS = new Set([
  'read_file', 'write_file', 'list_dir',
  'run_command',
  'get_selection', 'apply_diff', 'open_file',
])

export default defineNuxtPlugin((nuxtApp) => {
  const { $vscode } = nuxtApp
  if (!$vscode.available) return

  registerToolCallInterceptor(async (toolCall) => {
    if (!LOCAL_TOOLS.has(toolCall.name)) return null

    return new Promise((resolve) => {
      const off = $vscode.onMessage((msg: any) => {
        if (msg?.type === 'tool_result' && msg.call_id === toolCall.call_id) {
          off()
          resolve({
            call_id: toolCall.call_id,
            status: msg.error ? 'error' : 'success',
            result: msg.result,
            error: msg.error,
          })
        }
      })

      $vscode.post({
        type: 'execute_tool',
        call_id: toolCall.call_id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      })
    })
  })
})
```

**Step 3: Backend-Result-POST**

Wenn der Interceptor ein Result liefert, muss `useChatStream` es an Hermes posten:

```typescript
async function sendToolResult(callId: string, result: ToolResultData) {
  const auth = useAuthStore()
  await $fetch(`${auth.baseUrl}/api/chat/tool-result`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}` },
    body: { call_id: callId, ...result },
  })
}
```

Hook das in den interceptor-Flow ein.

**Step 4: Test**

Im VS-Code-Webview-Modus (echte Extension) sollten Tool-Calls für `read_file` etc. transparent ausgeführt werden, sichtbar in den OutputChannel-Logs der Extension.

Im Browser (ohne VS-Code-API) wird `$vscode.available = false` und der Tool-Bridge-Plugin registriert keinen Interceptor — Tools werden wie im Frontend behandelt (Backend lehnt sie wahrscheinlich ab oder zeigt sie als Display).

**Step 5: Commit**

```bash
cd /home/haex/Projekte/holzi
git add apps/vscode/webview/ packages/holzi-ui/
git commit -m "feat: webview tool bridge — relay local tools to extension host"
```

---

## Task 8: Move + slim down extension host

**Goal:** Code aus `holzi-vscode/src/` nach `apps/vscode/extension/src/` verschieben, dabei radikal verschlanken: kein `HolziSocket`, kein `HolziSidebarProvider` (vorerst weg, später re-evaluieren), `HolziPanel` reduziert sich auf Webview-Lifecycle + Tool-Bridge + Config-Injection.

**Was bleibt:**
- `extension.ts` — Activate + Commands
- `HolziPanel.ts` — slim: Webview erstellen, HTML einbetten, Tool-Calls von Webview empfangen + ausführen
- `tools/` — Filesystem/Terminal/Editor unverändert
- `toolNames.ts`
- `config.ts` — Token + Host lesen

**Was wegfällt:**
- `HolziSocket.ts` — WebSocket gegen Backend nicht mehr nötig
- `HolziSidebarProvider.ts` — vorerst weg
- `HolziChatParticipant.ts` — vorerst weg (Chat Participant API ist eine andere Integration; evaluieren wir nach Phase 2)

**Step 1: Copy + bereinigen**

```bash
cd /home/haex/Projekte/holzi
rsync -av --exclude='node_modules' --exclude='out' --exclude='.git' --exclude='.vscode-test' --exclude='*.vsix' --exclude='src/webview' /home/haex/Projekte/holzi-vscode/ apps/vscode/extension/
rm -f apps/vscode/extension/src/HolziSocket.ts
rm -f apps/vscode/extension/src/HolziSidebarProvider.ts
rm -f apps/vscode/extension/src/HolziChatParticipant.ts
rm -rf apps/vscode/extension/.git
rm -f apps/vscode/extension/pnpm-lock.yaml
```

**Step 2: Rewrite `extension.ts` (slim)**

```typescript
import * as vscode from 'vscode'
import { HolziPanel } from './HolziPanel'

export function activate(context: vscode.ExtensionContext): void {
  const logger = vscode.window.createOutputChannel('Holzi')
  context.subscriptions.push(logger)

  context.subscriptions.push(
    vscode.commands.registerCommand('holzi.openChat', async () => {
      await HolziPanel.createOrShow(context, logger)
    }),
    vscode.commands.registerCommand('holzi.configure', async () => {
      const config = vscode.workspace.getConfiguration('holzi')
      const current = config.get<string>('host') ?? 'https://holzi.haex.cloud'
      const value = await vscode.window.showInputBox({
        title: 'Holzi: Configure Server',
        prompt: 'Enter Holzi server URL',
        value: current,
      })
      if (value !== undefined) {
        await config.update('host', value.replace(/\/$/, ''), vscode.ConfigurationTarget.Global)
      }
    }),
    vscode.commands.registerCommand('holzi.login', async () => {
      const token = await vscode.window.showInputBox({
        title: 'Holzi: Login',
        prompt: 'Paste your Holzi API token',
        password: true,
      })
      if (token) {
        await context.secrets.store('holzi.token', token)
      }
    }),
  )
}

export function deactivate(): void {}
```

**Step 3: Rewrite `HolziPanel.ts` (slim — ~150 LoC statt 270)**

Kern-Verantwortung:
1. Webview öffnen, HTML einbetten (Task 9 macht das HTML-Rewriting)
2. Auf `webview_ready` Event von Webview: Config (host + token) schicken
3. Auf `execute_tool` Event von Webview: Tool ausführen, Result zurückschicken

```typescript
import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { ToolRegistry, PermissionMode } from './tools/index'
import { readFile, writeFile, listDir } from './tools/filesystem'
import { runCommand } from './tools/terminal'
import { getSelection, applyDiff, openFile } from './tools/editor'
import { getToken, getHost } from './config'

const VIEW_TYPE = 'holziChat'

export class HolziPanel {
  private static current: HolziPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private readonly registry = new ToolRegistry()
  private readonly context: vscode.ExtensionContext
  private readonly logger: vscode.OutputChannel

  static async createOrShow(context: vscode.ExtensionContext, logger: vscode.OutputChannel) {
    if (HolziPanel.current) { HolziPanel.current.panel.reveal(); return }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Holzi', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
    })
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')
    HolziPanel.current = new HolziPanel(panel, context, logger)
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, logger: vscode.OutputChannel) {
    this.panel = panel
    this.context = context
    this.logger = logger
    this._registerTools()
    this.panel.webview.html = this._buildHtml(context)
    this.panel.webview.onDidReceiveMessage((msg) => this._handleWebviewMessage(msg))
    this.panel.onDidDispose(() => { HolziPanel.current = undefined })
  }

  private _registerTools() {
    this.registry.register('read_file', readFile)
    this.registry.register('write_file', writeFile)
    this.registry.register('list_dir', listDir)
    this.registry.register('run_command', runCommand)
    this.registry.register('get_selection', getSelection)
    this.registry.register('apply_diff', applyDiff)
    this.registry.register('open_file', openFile)
  }

  private async _handleWebviewMessage(msg: any) {
    if (msg?.type === 'webview_ready') {
      const host = getHost() || 'https://holzi.haex.cloud'
      const token = await getToken(this.context)
      this.panel.webview.postMessage({ type: 'config', host, token })
      return
    }
    if (msg?.type === 'execute_tool') {
      try {
        const result = await this.registry.execute(msg.name, msg.arguments)
        this.panel.webview.postMessage({ type: 'tool_result', call_id: msg.call_id, result })
      } catch (e: any) {
        this.panel.webview.postMessage({ type: 'tool_result', call_id: msg.call_id, error: String(e?.message ?? e) })
      }
      return
    }
  }

  private _buildHtml(context: vscode.ExtensionContext): string {
    // Task 9 implementiert das Nuxt-Output-Rewriting
    return '<!DOCTYPE html><html><body>TODO Task 9</body></html>'
  }
}
```

**Step 4: package.json — rename**

```json
{
  "name": "@holzi/extension",
  ...
}
```

Entferne `pnpm-workspace.yaml` falls vorhanden.

**Step 5: tsconfig fix paths**

Wenn `apps/vscode/extension/tsconfig.json` einen `out` outDir hatte (`out/`), funktioniert das weiter — die Extension wird unverändert nach `out/extension.js` kompiliert. Der Webview-Output landet in `out/webview/`.

**Step 6: pnpm install + build**

```bash
cd /home/haex/Projekte/holzi && pnpm install
cd apps/vscode/extension && pnpm build 2>&1 | tail -30
```

Erwartung: TypeScript-Build läuft durch.

**Step 7: Commit**

```bash
cd /home/haex/Projekte/holzi
git add apps/vscode/extension/
git commit -m "feat: move + slim extension host (drop HolziSocket, ChatParticipant, sidebar)"
```

---

## Task 9: Update _buildHtml for Nuxt static output + wire monorepo build + vsix package

**Goal:** Extension lädt das von `nuxt generate` erzeugte `index.html`, schreibt alle `_nuxt/`-Asset-URLs zu `webview.asWebviewUri` um, fügt Nonce an Scripts, setzt CSP korrekt. Root-Build-Pipeline orchestriert alles.

**Files modified:**
- `apps/vscode/extension/src/HolziPanel.ts` — `_buildHtml` ausimplementieren
- `/home/haex/Projekte/holzi/package.json` — Root-Scripts

**Step 1: `_buildHtml` in `HolziPanel.ts` ersetzen**

```typescript
private _buildHtml(context: vscode.ExtensionContext): string {
  const webview = this.panel.webview
  const nonce = Array.from({ length: 32 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]
  ).join('')

  const htmlPath = path.join(context.extensionPath, 'out', 'webview', 'index.html')
  let html = fs.readFileSync(htmlPath, 'utf-8')

  // Rewrite alle "/_nuxt/..." Pfade auf webview-URIs (relative auch erlauben)
  html = html.replace(/(src|href)="(\.?\/_nuxt\/[^"]+)"/g, (_m, attr, p) => {
    const file = p.replace(/^\.?\//, '')
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', ...file.split('/')))
    return `${attr}="${uri}"`
  })

  // Nonce an alle <script>-Tags
  html = html.replace(/<script(\s|>)/g, `<script nonce="${nonce}"$1`)

  // CSP: erlaube webview-Source für Scripts/Styles, plus konfigurierten Backend-Host
  // Für Hermes: connect-src ist DYNAMISCH — wir kennen den Host erst nach Konfig.
  // Lösung: erstmal weit öffnen für https-Endpunkte; falls strenger gewünscht → später.
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource} data:`,
    `img-src ${webview.cspSource} data: https:`,
    `connect-src https: wss:`,
  ].join('; ')

  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, '')
  html = html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`)

  return html
}
```

**Step 2: Root package.json — Build-Scripts**

```json
{
  "scripts": {
    "dev:frontend": "pnpm --filter @holzi/frontend dev",
    "dev:webview": "pnpm --filter @holzi/webview dev",
    "build:frontend": "pnpm --filter @holzi/frontend build",
    "build:webview": "pnpm --filter @holzi/webview generate",
    "build:extension": "pnpm --filter @holzi/extension build",
    "build:vscode": "pnpm run build:webview && pnpm run build:extension",
    "build": "pnpm run build:frontend && pnpm run build:vscode",
    "package:vscode": "pnpm run build:vscode && pnpm --filter @holzi/extension package"
  }
}
```

**Step 3: Full build**

```bash
cd /home/haex/Projekte/holzi
pnpm run build:vscode 2>&1 | tail -40
```

Erwartet:
- `apps/vscode/extension/out/webview/index.html` existiert
- `apps/vscode/extension/out/webview/_nuxt/` mit JS/CSS-Chunks
- `apps/vscode/extension/out/extension.js` existiert

**Step 4: VSIX-Test**

```bash
cd /home/haex/Projekte/holzi
pnpm run package:vscode 2>&1 | tail -20
```

Erwartet: `holzi-vscode-0.1.X.vsix` (oder umbenannt) im `apps/vscode/extension/`. Prüfe Inhalt:

```bash
unzip -l apps/vscode/extension/holzi-vscode-*.vsix | grep -E "(extension.js|webview/index.html|_nuxt/)" | head -10
```

**Step 5: End-to-end Test in VS Code**

```bash
code --install-extension apps/vscode/extension/holzi-vscode-*.vsix
```

In VS Code: Command Palette → "Holzi: Open Chat". Webview öffnet sich. Token via "Holzi: Login" setzen. Chat sollte funktionieren.

Test-Szenarien:
- Settings-Page erreichbar (`/settings/preferences`)
- Login mit Token persistiert (über Reload hinweg)
- Tool-Call (z.B. read_file) wird im OutputChannel "Holzi" geloggt + Result kommt zurück

**Step 6: Commit + tag**

```bash
cd /home/haex/Projekte/holzi
git add -A
git commit -m "feat: complete monorepo build pipeline, vsix package wires Nuxt webview"
git tag phase2-complete
```

---

## Risiken & Notes

- **Hermes-Backend muss `/api/chat/tool-result` (oder Äquivalent) bereitstellen.** Wenn nicht, Task 7 nicht abschließbar — separater Backend-Task nötig.
- **CSP für `connect-src` ist locker (`https: wss:`).** Stricter: nur den konfigurierten Host whitelisten — geht aber erst nach Token-Empfang (CSP ist statisch beim HTML-Build). Falls strikt nötig: Webview reload nach Konfig-Empfang.
- **`acquireVsCodeApi()` darf nur einmal aufgerufen werden** — daher Singleton-Pattern in vscode-bridge.client.ts.
- **Nuxt Layer + Pages**: Pages im Layer werden von beiden Apps automatisch geladen. Falls Webview bestimmte Routes (z.B. `/login`) skippen soll: per Middleware oder per Layer-Override im Webview.
- **i18n strategy `prefix_except_default`**: Webview hat keinen "Server" — alle Routes laufen client-side. Sollte funktionieren, aber testen mit Sprachumschaltung.
- **Tailwind v4**: Konfig sitzt im CSS (`tailwind.css`). Wenn Layer den CSS-File liefert, sollten beide Apps identisch aussehen.
- **`holzi-vscode` Source-Repo nach erfolgreichem Phase 2 archivieren.** Bis dahin als Rollback-Pfad behalten.
