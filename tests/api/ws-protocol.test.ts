import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { WebSocket } from 'ws'
import { startHermes, type HermesHandle } from '../setup/hermes'

let hermes: HermesHandle

beforeAll(async () => {
  hermes = await startHermes()
}, 120_000)

afterAll(async () => {
  await hermes?.stop()
})

function wsUrl(handle: HermesHandle) {
  return handle.baseUrl.replace(/^http/, 'ws') + '/ws/agent'
}

/** Open a WS and resolve once it's either open or closed by the server. */
function waitForOpenOrClose(ws: WebSocket): Promise<{ opened: boolean; closeCode?: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('ws never opened or closed')), 10_000)
    ws.once('open', () => {
      clearTimeout(timeout)
      resolve({ opened: true })
    })
    ws.once('close', (code) => {
      clearTimeout(timeout)
      resolve({ opened: false, closeCode: code })
    })
    ws.once('error', () => {
      // Some servers close before emitting open; let the close handler resolve.
    })
  })
}

describe('/ws/agent auth gating', () => {
  test('rejects with close code 4001 when no token is provided', async () => {
    const ws = new WebSocket(wsUrl(hermes))
    const result = await waitForOpenOrClose(ws)
    // The server accepts then closes with 4001 — both 'opened then closed'
    // and 'never opened' are valid client observations here. What matters:
    // we never got to send a payload.
    if (result.opened) {
      // Closed shortly after open with the documented code.
      const close = await new Promise<number>((resolve) => ws.once('close', resolve))
      expect(close).toBe(4001)
    } else {
      expect(result.closeCode).toBe(4001)
    }
  })

  test('rejects wrong bearer token (close 4001)', async () => {
    const ws = new WebSocket(wsUrl(hermes), {
      headers: { Authorization: 'Bearer not-the-real-token' },
    })
    const result = await waitForOpenOrClose(ws)
    if (result.opened) {
      const close = await new Promise<number>((resolve) => ws.once('close', resolve))
      expect(close).toBe(4001)
    } else {
      expect(result.closeCode).toBe(4001)
    }
  })

  test('accepts correct bearer token (header)', async () => {
    const ws = new WebSocket(wsUrl(hermes), {
      headers: { Authorization: `Bearer ${hermes.authToken}` },
    })
    const result = await waitForOpenOrClose(ws)
    expect(result.opened).toBe(true)
    ws.close()
  })

  test('accepts correct token (query param fallback)', async () => {
    // The endpoint accepts ?token=… so VS Code's WebSocket client (which
    // can't easily set custom headers in browser contexts) can still auth.
    const ws = new WebSocket(`${wsUrl(hermes)}?token=${encodeURIComponent(hermes.authToken)}`)
    const result = await waitForOpenOrClose(ws)
    expect(result.opened).toBe(true)
    ws.close()
  })
})
