import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHermes, type HermesHandle } from '../setup/hermes'
import { makeClient, type ApiClient } from '../setup/client'

let hermes: HermesHandle
let api: ApiClient

beforeAll(async () => {
  hermes = await startHermes()
  api = makeClient(hermes)
}, 120_000)

afterAll(async () => {
  await hermes?.stop()
})

interface Conversation {
  id: number
  title: string | null
  channel: string
  updated_at: number
}

interface ConversationDetail extends Conversation {
  messages: Array<{ id: number; role: string; content?: unknown }>
}

describe('/api/conversations', () => {
  test('starts empty', async () => {
    const list = await api.get<Conversation[]>('/api/conversations')
    expect(list).toEqual([])
  })

  test('PATCH on unknown id → 404', async () => {
    const res = await api.raw('/api/conversations/999999', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'nope' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(404)
  })

  test('GET detail on unknown id → 404', async () => {
    const res = await api.raw('/api/conversations/999999')
    expect(res.status).toBe(404)
  })

  test('DELETE on unknown id → 404 (idempotent semantics are caller-side)', async () => {
    // The extension treats 404 as success ("already gone"); the server still
    // returns 404. This test pins that contract so the extension's branch
    // doesn't silently rot.
    const res = await api.raw('/api/conversations/999999', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })

  test('list response shape', async () => {
    // Even an empty list pins the array shape; once we have agent tests
    // creating conversations, this gets richer.
    const list = await api.get<Conversation[]>('/api/conversations')
    expect(Array.isArray(list)).toBe(true)
    for (const c of list) {
      expect(typeof c.id).toBe('number')
      expect(typeof c.updated_at).toBe('number')
      expect(['cline', 'web', 'task']).toContain(c.channel)
    }
  })
})

describe('/api/llm/credentials', () => {
  test('starts empty', async () => {
    const list = await api.get<unknown[]>('/api/llm/credentials')
    expect(list).toEqual([])
  })
})

describe('/api/personas', () => {
  test('list returns { personas: [] } shape', async () => {
    const body = await api.get<{ personas: unknown[] }>('/api/personas')
    expect(Array.isArray(body.personas)).toBe(true)
  })
})

describe('/api/skills', () => {
  test('list returns { skills: [] } shape', async () => {
    const body = await api.get<{ skills: unknown[] }>('/api/skills')
    expect(Array.isArray(body.skills)).toBe(true)
  })
})
