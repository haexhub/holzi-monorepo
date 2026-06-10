import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHermes, type HermesHandle } from '../setup/hermes'
import { makeClient, type ApiClient } from '../setup/client'

/**
 * Agent end-to-end test against a real LLM.
 *
 * Costs tokens — runs only when HOLZI_TEST_LLM_API_KEY is set in the env.
 * Defaults to the cheapest OpenRouter model; override via env if needed.
 *
 * Required env:
 *   HOLZI_TEST_LLM_API_KEY    e.g. an OpenRouter key
 * Optional env:
 *   HOLZI_TEST_LLM_PROVIDER   "openrouter" (default) | "openai" | "anthropic" | "google"
 *   HOLZI_TEST_LLM_MODEL      provider-specific id, default "openai/gpt-4o-mini"
 *                              for openrouter, "gpt-4o-mini" for openai,
 *                              "claude-haiku-4-5" for anthropic.
 */
const apiKey = process.env.HOLZI_TEST_LLM_API_KEY
const provider = (process.env.HOLZI_TEST_LLM_PROVIDER ?? 'openrouter') as
  | 'openrouter' | 'openai' | 'anthropic' | 'google'
const defaultModelByProvider: Record<typeof provider, string> = {
  openrouter: 'openai/gpt-4o-mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  google: 'gemini-2.0-flash',
}
const model = process.env.HOLZI_TEST_LLM_MODEL ?? defaultModelByProvider[provider]

// describe.skipIf(!apiKey) keeps the file present in the suite output so
// people see "skipped because no key" rather than wondering why nothing ran.
const describeIfKey = apiKey ? describe : describe.skip

let hermes: HermesHandle
let api: ApiClient

beforeAll(async () => {
  if (!apiKey) return
  hermes = await startHermes()
  api = makeClient(hermes)

  // 1. Seed the credential. Hermes activates it for routing automatically.
  const cred = await api.post<{ id: number }>('/api/llm/credentials', {
    provider,
    display_name: `e2e-test-${provider}`,
    api_key: apiKey,
  })
  // 2. Pin the cheap model.
  await api.patch(`/api/llm/credentials/${cred.id}/model`, { model })
}, 120_000)

afterAll(async () => {
  await hermes?.stop()
})

interface SseEvent { event: string; data: unknown }

/**
 * Stream-parse text/event-stream into typed events. Resolves when the
 * server closes the connection.
 */
async function consumeSse(resp: Response): Promise<SseEvent[]> {
  const events: SseEvent[] = []
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE blocks are separated by a blank line. Each block has lines of
    // "event: X" / "data: Y". We only care about the data — every block in
    // hermes' contract carries a JSON envelope with its own `event` field.
    let blockEnd: number
    while ((blockEnd = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, blockEnd)
      buffer = buffer.slice(blockEnd + 2)
      const dataLines = block
        .split('\n')
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).trim())
      if (dataLines.length === 0) continue
      try {
        const parsed = JSON.parse(dataLines.join('\n'))
        events.push({ event: parsed.event ?? 'unknown', data: parsed })
      } catch {
        // Ignore non-JSON blocks (heartbeats / comments)
      }
    }
  }
  return events
}

describeIfKey('agent /api/chat end-to-end', () => {
  test('streams text and persists assistant turn', async () => {
    // Cheap, deterministic-ish prompt. Some models still vary in wording —
    // we only assert on the structural events, not on the exact text.
    const resp = await fetch(`${hermes.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hermes.authToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        message: 'Reply with the single word: ready.',
      }),
    })
    expect(resp.ok).toBe(true)
    expect(resp.headers.get('content-type')).toMatch(/text\/event-stream/)

    const events = await consumeSse(resp)
    const kinds = events.map(e => e.event)

    // Structural contract: session announced, run announced, at least one
    // text delta, and a clean done. Order matters for the first two.
    expect(kinds[0]).toBe('session')
    expect(kinds).toContain('run')
    expect(kinds.filter(k => k === 'text').length).toBeGreaterThan(0)
    expect(kinds.at(-1)).toBe('done')

    // The conversation should now exist + carry both user + assistant.
    const sessionEvt = events.find(e => e.event === 'session')!.data as { conversation_id: number }
    const detail = await api.get<{ messages: Array<{ role: string; content: unknown }> }>(
      `/api/conversations/${sessionEvt.conversation_id}`,
    )
    const roles = detail.messages.map(m => m.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
  }, 90_000)
})
