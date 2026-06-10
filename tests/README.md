# Holzi end-to-end tests

Tests the Holzi stack against a real, containerized Hermes backend — no
mocks, no stubs. Each `*.test.ts` (vitest) / `*.spec.ts` (Playwright) boots
its own fresh hermes container on a random port so suites are isolated.

## Layout

| Path | What | Cost | Runner |
|------|------|------|--------|
| `unit/` | Pure-function tests (markdown renderer: Shiki, KaTeX, Mermaid, DOMPurify) | free | vitest |
| `api/` | Backend HTTP contracts (REST, CORS, auth, WS protocol) | free | vitest |
| `agent/` | End-to-end agent flow with a real (cheap) LLM | tokens | vitest |
| `ui/` | Browser flows (webview shell, frontend login, settings cards, mermaid SVG) | free | playwright |
| `setup/` | Shared helpers: `startHermes()`, typed API client, static server, env loader | — | — |

## Requirements

- **podman-compose** on PATH (default). Override with
  `HOLZI_TEST_COMPOSE_CMD='docker compose'` if you use Docker.
- **hermes-server image** built locally — `cd ../../Holzi && podman build -t localhost/hermes-server:dev .`
- **Built apps for UI tests:**
  - `pnpm --filter @holzi/webview run generate`
  - `pnpm --filter @holzi/frontend run generate`
- **Agent tests** additionally need `HOLZI_TEST_LLM_API_KEY` (skipped without it).

## Run

```bash
pnpm run test:unit       # 16 markdown-renderer tests, ~1s
pnpm run test:api        # 18 API contract tests, ~20s
pnpm run test:agent      # 1 agent test, skipped unless LLM key set
pnpm run test:ui         # 4 Playwright specs, ~22s
pnpm test                # all of the above (~50s end-to-end)
```

## Agent tests with a real LLM

```bash
# Cheapest path: an OpenRouter key, defaulting to openai/gpt-4o-mini.
HOLZI_TEST_LLM_API_KEY=sk-or-... pnpm run test:agent

# Override provider / model:
HOLZI_TEST_LLM_API_KEY=sk-... \
HOLZI_TEST_LLM_PROVIDER=openai \
HOLZI_TEST_LLM_MODEL=gpt-4o-mini \
  pnpm run test:agent
```

The agent test seeds the credential into the throwaway hermes via the
public `/api/llm/credentials` endpoint, so the container never receives
your key via env — it only sees the AES-encrypted blob in its ephemeral
DB, which dies with the container.

## What each test layer pins

**`api/health-and-auth.test.ts` (6 tests)**
- `/healthz` is public; `/api/*` 401s without / with wrong token, 200s with valid token.
- OPTIONS preflight from `vscode-webview://*` origins returns CORS headers; from foreign origins does not.

**`api/conversations.test.ts` (8 tests)**
- `/api/conversations`, `/api/llm/credentials`, `/api/personas`, `/api/skills` shapes (bare arrays vs `{ items: [] }` envelopes).
- 404 on unknown ids for GET/PATCH/DELETE — the contract the extension depends on.

**`api/ws-protocol.test.ts` (4 tests)**
- `/ws/agent` close-code-4001 without / with wrong token.
- Header bearer + `?token=` query param both accepted.

**`agent/basic-chat.test.ts` (1 test, LLM-gated)**
- POST `/api/chat` with a trivial prompt, parse SSE: `session` → `run` → `text*` → `done`.
- Conversation persists with both user and assistant messages.

**`unit/markdown.test.ts` (16 tests)**
- Pure-function tests of `renderMarkdown` from `@holzi/ui`. Covers: HTML escaping, DOMPurify sanitisation, headings/paragraphs/linkify/breaks, code blocks via Shiki (JS/TS/Python/unknown-language fallback), copy-button wrapper + `data-code` attribute, mermaid fence extraction (NOT run through Shiki), KaTeX inline + block math, plain `$` not eaten as math, shiki CSS-var inline styles surviving DOMPurify.

**`ui/webview.spec.ts` (1 test)**
- Webview boots into Nuxt with mocked `acquireVsCodeApi`; CSP doesn't block module / WASM; Tailwind utilities are present (catches the regressions from the session that built this suite).

**`ui/frontend.spec.ts` (1 test)**
- Web frontend's auth-middleware redirect to `/login`, token submission against the test backend, post-login navigation away from `/login`.

**`ui/settings-cards.spec.ts` (1 test)**
- LLM credentials settings page: seed an inactive credential → page renders the row → click Activate → row toggles to active (verified against `/api/llm/credentials`, not just DOM).

**`ui/mermaid-render.spec.ts` (1 test)**
- The `.mermaid-block` fallback structure that `renderMarkdown` emits is actually upgradeable: mermaid lib is loaded in a real browser, runs the upgrade routine `RenderedMarkdown.vue` uses, and produces an inline SVG containing the source's text labels.

## Adding a test

API contract pattern (most tests):

```ts
let hermes: HermesHandle
let api: ApiClient

beforeAll(async () => {
  hermes = await startHermes()
  api = makeClient(hermes)
}, 120_000)

afterAll(() => hermes?.stop())

test('something', async () => {
  const res = await api.get('/api/whatever')
  expect(res).toEqual(...)
})
```

UI pattern: see `ui/webview.spec.ts` (postMessage-mocked) or
`ui/frontend.spec.ts` (page.route forwarder).
