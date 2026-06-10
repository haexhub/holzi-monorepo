# Holzi end-to-end tests

Tests the Holzi stack against a real, containerized Hermes backend — no
mocks, no stubs. Each `*.test.ts` file boots its own fresh hermes container
(SQLite on tmpfs, random auth token, random port) so suites are isolated.

## Layout

| Path | What | Runner |
|------|------|--------|
| `api/` | Backend HTTP contracts (REST, CORS, auth gating) — no LLM. | vitest |
| `agent/` | End-to-end agent flow with a real (cheap) LLM. | vitest |
| `ui/` | Browser-driven flows for the Web app + VS Code webview. | playwright |
| `setup/` | Shared helpers: `startHermes()`, typed API client. | — |

## Requirements

- **podman-compose** on PATH (default; override with `HOLZI_TEST_COMPOSE_CMD='docker compose'`).
- **hermes-server image** built locally — `cd ../../Holzi && podman build -t localhost/hermes-server:dev .`
- **Agent tests** additionally need an LLM API key in `.env.test` (gitignored).

## Run

```bash
pnpm run test:api        # API contracts, no LLM
pnpm run test:agent      # Agent flow with real LLM
pnpm run test:ui         # Playwright UI tests
pnpm test                # all of the above
```

## Adding a test

Most tests follow the pattern in `api/conversations.test.ts`:

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

`startHermes()` returns a fresh, isolated backend. The handle's `stop()` is
idempotent — call it in `afterAll`. Random ports let suites run in parallel.
