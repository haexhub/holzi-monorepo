import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHermes, type HermesHandle } from '../setup/hermes'
import { makeClient } from '../setup/client'

let hermes: HermesHandle

beforeAll(async () => {
  hermes = await startHermes()
}, 120_000)

afterAll(async () => {
  await hermes?.stop()
})

describe('health + auth', () => {
  test('GET /healthz is public', async () => {
    const res = await fetch(`${hermes.baseUrl}/healthz`)
    expect(res.ok).toBe(true)
  })

  test('protected endpoint without token → 401', async () => {
    const res = await fetch(`${hermes.baseUrl}/api/conversations`)
    expect(res.status).toBe(401)
  })

  test('protected endpoint with wrong token → 401', async () => {
    const res = await fetch(`${hermes.baseUrl}/api/conversations`, {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(res.status).toBe(401)
  })

  test('protected endpoint with correct token → 200', async () => {
    const api = makeClient(hermes)
    const conversations = await api.get<unknown[]>('/api/conversations')
    expect(Array.isArray(conversations)).toBe(true)
  })
})

describe('CORS for vscode-webview origin', () => {
  test('OPTIONS preflight from webview origin is allowed', async () => {
    const res = await fetch(`${hermes.baseUrl}/api/conversations`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'vscode-webview://test-uuid',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    })
    expect(res.status).toBeLessThan(400)
    expect(res.headers.get('access-control-allow-origin')).toBe('vscode-webview://test-uuid')
    expect((res.headers.get('access-control-allow-headers') ?? '').toLowerCase()).toContain('authorization')
  })

  test('OPTIONS preflight from foreign origin is NOT echoed back', async () => {
    const res = await fetch(`${hermes.baseUrl}/api/conversations`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
