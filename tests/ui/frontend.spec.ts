import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { startHermes, type HermesHandle } from '../setup/hermes'
import { serveStatic, type StaticHandle } from '../setup/static-server'

const here = resolve(fileURLToPath(import.meta.url), '..')
const frontendDist = resolve(here, '..', '..', 'apps', 'frontend', '.output', 'public')

// Skip if no static build is present. CI builds the frontend first:
// `pnpm --filter @holzi/frontend run generate`.
const built = existsSync(resolve(frontendDist, 'index.html'))

let hermes: HermesHandle
let server: StaticHandle

test.beforeAll(async () => {
  if (!built) return
  hermes = await startHermes()
  server = await serveStatic(frontendDist)
})

test.afterAll(async () => {
  await server?.stop()
  await hermes?.stop()
})

test.describe('web frontend shell', () => {
  test.skip(!built, 'frontend not built — run `pnpm --filter @holzi/frontend run generate`')

  test('renders login screen, accepts valid token, lands on home', async ({ page }) => {
    // The frontend lives on http://127.0.0.1:RANDOM/. Its /api/* calls are
    // same-origin (the login does `fetch('/api/ping')`). In production nginx
    // proxies these to hermes; in dev a Nitro devProxy does. Here we let
    // Playwright intercept and forward to the test container.
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url())
      const target = `${hermes.baseUrl}${url.pathname}${url.search}`
      const headers = { ...route.request().headers() }
      // Strip host so undici doesn't reject mismatching authority.
      delete headers.host
      const resp = await fetch(target, {
        method: route.request().method(),
        headers,
        body: route.request().postData() ?? undefined,
      })
      const body = Buffer.from(await resp.arrayBuffer())
      await route.fulfill({
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        body,
      })
    })

    await page.goto(`${server.url}/`)

    // Auth middleware should send us to /login since no token in localStorage.
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })

    // Token input + submit. We accept any visible password-like field rather
    // than coupling to specific test-ids that don't exist yet — the login
    // form has one secret field.
    const tokenInput = page.locator('input[type="password"]').first()
    await expect(tokenInput).toBeVisible({ timeout: 10_000 })
    await tokenInput.fill(hermes.authToken)
    await page.locator('button[type="submit"]').first().click()

    // On success the auth store stores the token and replaces the route to
    // home — should leave /login.
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
  })
})
