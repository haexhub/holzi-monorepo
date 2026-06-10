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
const allowedProviders = ['openrouter', 'openai', 'anthropic', 'google'] as const
type Provider = typeof allowedProviders[number]
const envProvider = process.env.HOLZI_TEST_LLM_PROVIDER
if (envProvider !== undefined && !allowedProviders.includes(envProvider as Provider)) {
  throw new Error(
    `HOLZI_TEST_LLM_PROVIDER='${envProvider}' is not one of ${allowedProviders.join(', ')}`,
  )
}
const provider: Provider = (envProvider as Provider) ?? 'openrouter'
const defaultModelByProvider: Record<Provider, string> = {
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

  // 1. Seed the credential. Created rows start with is_active=0, so:
  // 2. activate it (without this /api/chat fails with PERSONA_NO_CREDENTIAL),
  // 3. pin the cheap model on it.
  const cred = await api.post<{ id: number }>('/api/llm/credentials', {
    provider,
    display_name: `e2e-test-${provider}`,
    api_key: apiKey,
  })
  await api.patch(`/api/llm/credentials/${cred.id}/activate`)
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

  function parseBlock(block: string) {
    const dataLines = block
      .split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trim())
    if (dataLines.length === 0) return
    try {
      const parsed = JSON.parse(dataLines.join('\n'))
      events.push({ event: parsed.event ?? 'unknown', data: parsed })
    } catch {
      // Ignore non-JSON blocks (heartbeats / comments)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    // SSE spec allows CRLF line endings; normalise to LF so the split below
    // works regardless of which the server emits.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let blockEnd: number
    while ((blockEnd = buffer.indexOf('\n\n')) !== -1) {
      parseBlock(buffer.slice(0, blockEnd))
      buffer = buffer.slice(blockEnd + 2)
    }
  }
  // Flush any final block the server closed without a trailing blank line —
  // we'd otherwise drop the last event (often the `done`).
  if (buffer.trim()) parseBlock(buffer)
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
    if (!resp.ok) {
      const body = await resp.text().catch(() => '<no body>')
      throw new Error(`/api/chat ${resp.status}: ${body}`)
    }
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
    // Envelope shape: { event: 'session', version, data: { conversation_id } }.
    const sessionEvt = events.find(e => e.event === 'session')!.data as { data: { conversation_id: number } }
    const detail = await api.get<{ messages: Array<{ role: string; content: unknown }> }>(
      `/api/conversations/${sessionEvt.data.conversation_id}`,
    )
    const roles = detail.messages.map(m => m.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
  }, 90_000)
})
