import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { startHermes, type HermesHandle } from '../setup/hermes'
import { serveStatic, type StaticHandle } from '../setup/static-server'
import { setupApiForwarder } from '../setup/api-forwarder'
import { makeClient } from '../setup/client'

const here = resolve(fileURLToPath(import.meta.url), '..')
const frontendDist = resolve(here, '..', '..', 'apps', 'frontend', '.output', 'public')
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

test.describe('settings — LLM credential card', () => {
  test.skip(!built, 'frontend not built — run `pnpm --filter @holzi/frontend run generate`')

  test('seeded credential renders and the Activate button toggles is_active', async ({ page }) => {
    // Seed one inactive credential. Real keys aren't needed — we test the
    // UI state-management flow, not whether the upstream call works.
    const api = makeClient(hermes)
    const cred = await api.post<{ id: number, display_name: string, is_active: boolean }>(
      '/api/llm/credentials',
      { provider: 'openai', display_name: 'cred-under-test', api_key: 'sk-fake' },
    )
    expect(cred.is_active).toBe(false)

    await setupApiForwarder(page, hermes.baseUrl)

    // Seed auth token — VueUse's useLocalStorage with string serializer stores
    // the value un-quoted (not JSON-encoded).
    await page.goto(`${server.url}/`)
    await page.evaluate((token) => {
      localStorage.setItem('hermes.auth.token', token)
    }, hermes.authToken)

    // Navigate via the English locale prefix so button text is stable across
    // the de/en strategy='prefix_except_default' setup.
    await page.goto(`${server.url}/en/settings/llm`)

    // The credential row renders with its display name.
    const displayName = page.getByText('cred-under-test', { exact: true })
    await expect(displayName).toBeVisible({ timeout: 15_000 })

    // Activate button is present while the row is inactive.
    const activateBtn = page.getByRole('button', { name: /^(activate|aktivieren)$/i })
    await expect(activateBtn).toBeVisible()

    await activateBtn.click()

    // Verify activation against the API source of truth — catches the case
    // where the UI optimistically updates but the backend never did.
    await expect.poll(async () => {
      const list = await api.get<Array<{ id: number, is_active: boolean }>>('/api/llm/credentials')
      return list.find(c => c.id === cred.id)?.is_active
    }, { timeout: 10_000 }).toBe(true)

    // After activation, the Activate button for that row disappears (the
    // v-if drops it once is_active flips true).
    await expect(activateBtn).toBeHidden({ timeout: 5_000 })
  })
})
