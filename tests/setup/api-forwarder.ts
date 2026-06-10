import type { Page } from '@playwright/test'

/**
 * Forward all `/api/*` requests the served static bundle makes through to
 * the test hermes container. Drop-in replacement for nginx (in prod) or
 * Nuxt's nitro devProxy (in dev) — keeps the page same-origin so the
 * frontend's bare `fetch('/api/...')` calls work without CORS gymnastics.
 *
 * Header hygiene matters: undici (Node fetch) decompresses the response,
 * so we must strip accept-encoding from the outgoing request AND
 * content-encoding/content-length/transfer-encoding from the response —
 * otherwise route.fulfill ships a decoded body with stale headers that
 * Chromium refuses.
 */
export function setupApiForwarder(page: Page, baseUrl: string) {
  return page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const target = `${baseUrl}${url.pathname}${url.search}`
    const headers = { ...route.request().headers() }
    delete headers.host
    delete headers['accept-encoding']
    try {
      const resp = await fetch(target, {
        method: route.request().method(),
        headers,
        body: route.request().postData() ?? undefined,
      })
      const body = Buffer.from(await resp.arrayBuffer())
      const respHeaders = Object.fromEntries(resp.headers.entries())
      delete respHeaders['content-encoding']
      delete respHeaders['content-length']
      delete respHeaders['transfer-encoding']
      await route.fulfill({ status: resp.status, headers: respHeaders, body })
    } catch {
      // Network error to hermes — abort the request so Playwright surfaces
      // a clear 'failed' rather than a hung route.
      await route.abort()
    }
  })
}
