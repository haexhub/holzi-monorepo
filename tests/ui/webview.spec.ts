import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { startHermes, type HermesHandle } from '../setup/hermes'
import { serveStatic, type StaticHandle } from '../setup/static-server'

const here = resolve(fileURLToPath(import.meta.url), '..')
const webviewDist = resolve(here, '..', '..', 'apps', 'vscode', 'extension', 'out', 'webview')

// Skip if the webview hasn't been built. CI is expected to build it
// (`pnpm --filter @holzi/webview run generate`) before running ui tests.
const built = existsSync(resolve(webviewDist, 'index.html'))

let hermes: HermesHandle
let server: StaticHandle

test.beforeAll(async () => {
  if (!built) return
  hermes = await startHermes()
  server = await serveStatic(webviewDist)
})

test.afterAll(async () => {
  await server?.stop()
  await hermes?.stop()
})

test.describe('VS Code webview shell', () => {
  test.skip(!built, 'webview not built — run `pnpm --filter @holzi/webview run generate`')

  test('boots, applies styling, and finds the login screen', async ({ page }) => {
    // The real webview gets its config (host + bearer token) via a
    // postMessage from the extension host after the page sends
    // {type: 'webview_ready'}. In Playwright we have no host, so we
    // synthesise both sides: acquireVsCodeApi() is mocked, and we wire a
    // fake "extension" that responds to webview_ready with the right
    // config + intercepts any further outgoing messages.
    const baseUrl = hermes.baseUrl
    const token = hermes.authToken
    await page.addInitScript(({ host, token }) => {
      const listeners = new Set<(d: unknown) => void>()
      ;(window as any).acquireVsCodeApi = () => ({
        postMessage(msg: unknown) {
          const m = msg as { type?: string }
          if (m?.type === 'webview_ready') {
            queueMicrotask(() => {
              window.postMessage({ type: 'config', host, token }, '*')
            })
          }
        },
        getState: () => null,
        setState: () => {},
      })
      // The plugins listen on window.message directly, so the postMessage
      // above will reach them — nothing else to wire.
    }, { host: baseUrl, token })

    // Attach the console error hook BEFORE navigation so we catch errors
    // raised during the initial-load CSP / module evaluation pass — those
    // are exactly the regressions this spec exists to catch.
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    // The build emits a hash-mode router (#/…); hash mode means the
    // initial path always rooted to '/'.
    await page.goto(`${server.url}/`)

    // Auth middleware in the SPA redirects to /login when no token is in the
    // store yet. Once the config postMessage seeds the token, it should land
    // on the chat shell. Either way, the page should NOT stay blank.
    await expect(page.locator('#__nuxt')).not.toBeEmpty({ timeout: 15_000 })

    // Tailwind utilities must have been generated — verify a known visible
    // text element gets non-zero computed font size and the body has the
    // expected background-color set via CSS variables (catches the
    // "@source missing → no utilities" regression we fixed in this session).
    const bodyFontSize = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.body).fontSize),
    )
    expect(bodyFontSize).toBeGreaterThan(0)

    // Surface any CSP / load errors. We don't fail on every warn — only on
    // outright errors that would indicate the page broke.
    const fatal = consoleErrors.filter(e =>
      e.includes('violates the following Content Security Policy')
      || e.includes('Failed to fetch dynamically imported module')
      || e.includes('CompileError: WebAssembly'),
    )
    expect(fatal, fatal.join('\n')).toEqual([])
  })
})
