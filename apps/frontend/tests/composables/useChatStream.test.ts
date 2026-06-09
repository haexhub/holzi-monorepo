import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelChatRun,
  ChatStreamError,
  editAndRegenerate,
  friendlyChatError,
  retryLastResponse,
  sendChatMessage,
} from '~/composables/useChatStream'
import { useAuthStore } from '~/stores/auth'

// Mirrors the real wire format: the SSE `event:` line carries the event name
// and the `data:` line is the full versioned envelope `{ event, version, data }`.
function sseBody(events: { event: string; data: unknown }[]): string {
  return events
    .map((e) => {
      const envelope = { event: e.event, version: 1, data: e.data }
      return `event: ${e.event}\ndata: ${JSON.stringify(envelope)}\n\n`
    })
    .join('')
}

function mockFetch(response: Response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
}

describe('sendChatMessage', () => {
  beforeEach(() => {
    const auth = useAuthStore()
    auth.setToken('test-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when no auth token is set', async () => {
    const auth = useAuthStore()
    auth.clear()
    await expect(sendChatMessage({ message: 'hi' })).rejects.toThrow('not authenticated')
  })

  it('sends the Bearer header on the request', async () => {
    const spy = mockFetch(
      new Response(sseBody([{ event: 'session', data: { conversation_id: 1 } }, { event: 'done', data: {} }])),
    )
    await sendChatMessage({ message: 'hi' })
    expect(spy).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      }),
    )
    const callBody = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)
    expect(callBody).toEqual({ message: 'hi' })
  })

  it('fires onSession with the conversation_id from the session event', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 42 } },
        { event: 'text', data: { content: 'hi' } },
        { event: 'done', data: {} },
      ])),
    )
    const seenSessions: number[] = []
    const result = await sendChatMessage(
      { message: 'hi' },
      { onSession: (id) => seenSessions.push(id) },
    )
    expect(seenSessions).toEqual([42])
    expect(result.conversationId).toBe(42)
  })

  it('concatenates multiple text events and fires onText per chunk', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 7 } },
        { event: 'text', data: { content: 'Hello' } },
        { event: 'text', data: { content: ' ' } },
        { event: 'text', data: { content: 'world' } },
        { event: 'done', data: {} },
      ])),
    )
    const chunks: string[] = []
    const result = await sendChatMessage(
      { message: 'go' },
      { onText: (c) => chunks.push(c) },
    )
    expect(chunks).toEqual(['Hello', ' ', 'world'])
    expect(result.text).toBe('Hello world')
  })

  it('throws when the stream contains an error event', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 1 } },
        { event: 'error', data: { message: 'agent exploded' } },
      ])),
    )
    await expect(sendChatMessage({ message: 'hi' })).rejects.toThrow('agent exploded')
  })

  it('surfaces code + status_code from the SSE error event', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 1 } },
        {
          event: 'error',
          data: { code: 'upstream_timeout', status_code: 504, message: 'upstream timed out' },
        },
      ])),
    )
    await expect(sendChatMessage({ message: 'hi' })).rejects.toMatchObject({
      name: 'ChatStreamError',
      code: 'upstream_timeout',
      statusCode: 504,
      message: 'upstream timed out',
    })
  })

  it('treats error as terminal — events after it are ignored', async () => {
    // The first error event is the authoritative failure; anything the
    // backend emits afterwards (it shouldn't) must not overwrite it or
    // produce text the caller renders as a successful turn.
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 1 } },
        { event: 'error', data: { code: 'agent_error', message: 'boom' } },
        { event: 'text', data: { content: 'too late' } },
        { event: 'done', data: {} },
      ])),
    )
    const chunks: string[] = []
    await expect(
      sendChatMessage({ message: 'hi' }, { onText: (c) => chunks.push(c) }),
    ).rejects.toMatchObject({ code: 'agent_error', message: 'boom' })
    expect(chunks).toEqual([])
  })

  it('rejects when the stream reader fails mid-flight (dropped connection)', async () => {
    // Simulate a network drop after the session event: the body delivers
    // one block, then the stream errors. The reader rejection must surface
    // as a terminal failure so the page can show a failed state.
    const enc = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode('event: session\ndata: {"conversation_id":1}\n\n'))
        controller.error(new Error('network dropped'))
      },
    })
    mockFetch(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    await expect(sendChatMessage({ message: 'hi' })).rejects.toThrow('network dropped')
  })

  it('throws when the stream ends without a session event', async () => {
    mockFetch(new Response(sseBody([{ event: 'done', data: {} }])))
    await expect(sendChatMessage({ message: 'hi' })).rejects.toThrow(/without a session event/)
  })

  it('clears the auth token on 401 and throws', async () => {
    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(true)
    mockFetch(new Response('', { status: 401 }))
    await expect(sendChatMessage({ message: 'hi' })).rejects.toThrow('unauthorized')
    expect(auth.isAuthenticated).toBe(false)
  })

  it('parses SSE blocks split across multiple chunks', async () => {
    // Build a ReadableStream that delivers the SSE bytes in awkward fragments
    // to mimic real network behaviour (block boundaries mid-line).
    const enc = new TextEncoder()
    const full = sseBody([
      { event: 'session', data: { conversation_id: 3 } },
      { event: 'text', data: { content: 'hel' } },
      { event: 'text', data: { content: 'lo' } },
      { event: 'done', data: {} },
    ])
    const stream = new ReadableStream({
      start(controller) {
        const piece = 40
        for (let i = 0; i < full.length; i += piece) {
          controller.enqueue(enc.encode(full.slice(i, i + piece)))
        }
        controller.close()
      },
    })
    mockFetch(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    const result = await sendChatMessage({ message: 'hi' })
    expect(result.conversationId).toBe(3)
    expect(result.text).toBe('hello')
  })

  it('fires onRun with the run_id from the run event', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 1 } },
        { event: 'run', data: { run_id: 'run-abc-123' } },
        { event: 'text', data: { content: 'hi' } },
        { event: 'done', data: {} },
      ])),
    )
    const seenRuns: string[] = []
    const result = await sendChatMessage(
      { message: 'hi' },
      { onRun: (id) => seenRuns.push(id) },
    )
    expect(seenRuns).toEqual(['run-abc-123'])
    expect(result.runId).toBe('run-abc-123')
    expect(result.cancelled).toBe(false)
  })

  it('returns cancelled=true and exits cleanly on a cancelled event', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 1 } },
        { event: 'run', data: { run_id: 'r1' } },
        { event: 'text', data: { content: 'partial' } },
        { event: 'cancelled', data: {} },
      ])),
    )
    const result = await sendChatMessage({ message: 'hi' })
    expect(result.cancelled).toBe(true)
    expect(result.conversationId).toBe(1)
    expect(result.runId).toBe('r1')
    // Partial text is surfaced so the caller can render what arrived
    // before the cancel, but the caller decides whether to persist it.
    expect(result.text).toBe('partial')
  })

  it('treats cancelled as terminal — anything after it is ignored', async () => {
    // Defensive: even if the backend ever followed `cancelled` with stale
    // events (it shouldn't), the composable must not append them.
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 1 } },
        { event: 'run', data: { run_id: 'r1' } },
        { event: 'cancelled', data: {} },
        { event: 'text', data: { content: 'too late' } },
        { event: 'done', data: {} },
      ])),
    )
    const chunks: string[] = []
    const result = await sendChatMessage(
      { message: 'hi' },
      { onText: (c) => chunks.push(c) },
    )
    expect(result.cancelled).toBe(true)
    expect(result.text).toBe('')
    expect(chunks).toEqual([])
  })

  it('fires onToolCall and onToolResult with the envelope payloads', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 5 } },
        { event: 'run', data: { run_id: 'r1' } },
        {
          event: 'tool_call',
          data: {
            call_id: 'call_1',
            name: 'notes.find',
            arguments: { query: 'status' },
            status: 'running',
          },
        },
        {
          event: 'tool_result',
          data: { call_id: 'call_1', status: 'success', result: 'found 3', error: null },
        },
        { event: 'text', data: { content: 'here you go' } },
        { event: 'done', data: {} },
      ])),
    )
    const calls: unknown[] = []
    const results: unknown[] = []
    const result = await sendChatMessage(
      { message: 'go' },
      {
        onToolCall: (c) => calls.push(c),
        onToolResult: (r) => results.push(r),
      },
    )
    expect(calls).toEqual([
      { call_id: 'call_1', name: 'notes.find', arguments: { query: 'status' }, status: 'running' },
    ])
    expect(results).toEqual([
      { call_id: 'call_1', status: 'success', result: 'found 3', error: null },
    ])
    expect(result.text).toBe('here you go')
  })

  it('ignores an unrecognised event without breaking the stream', async () => {
    // Forward compatibility: a newer backend may add event types we don't
    // know yet. They must fall through harmlessly, not abort the turn.
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 1 } },
        { event: 'reasoning', data: { thought: 'hmm' } },
        { event: 'text', data: { content: 'answer' } },
        { event: 'done', data: {} },
      ])),
    )
    const result = await sendChatMessage({ message: 'hi' })
    expect(result.text).toBe('answer')
    expect(result.conversationId).toBe(1)
  })

  it('passes conversation_id in the request body when provided', async () => {
    const spy = mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 99 } },
        { event: 'done', data: {} },
      ])),
    )
    await sendChatMessage({ message: 'hi', conversation_id: 99 })
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.conversation_id).toBe(99)
  })
})

describe('retryLastResponse', () => {
  beforeEach(() => {
    const auth = useAuthStore()
    auth.setToken('test-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to the conversation retry endpoint with no body', async () => {
    const spy = mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 42 } },
        { event: 'done', data: {} },
      ])),
    )
    await retryLastResponse(42)
    expect(spy).toHaveBeenCalledWith(
      '/api/conversations/42/retry',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    )
    // Retry carries no payload — the backend derives everything from state.
    expect((spy.mock.calls[0][1] as RequestInit).body).toBeUndefined()
  })

  it('streams text and returns the regenerated result like a normal send', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 7 } },
        { event: 'run', data: { run_id: 'retry-run' } },
        { event: 'text', data: { content: 'fresh ' } },
        { event: 'text', data: { content: 'answer' } },
        { event: 'done', data: {} },
      ])),
    )
    const chunks: string[] = []
    const result = await retryLastResponse(7, { onText: (c) => chunks.push(c) })
    expect(chunks).toEqual(['fresh ', 'answer'])
    expect(result.conversationId).toBe(7)
    expect(result.runId).toBe('retry-run')
    expect(result.text).toBe('fresh answer')
    expect(result.cancelled).toBe(false)
  })

  it('throws when no auth token is set', async () => {
    const auth = useAuthStore()
    auth.clear()
    await expect(retryLastResponse(1)).rejects.toThrow('not authenticated')
  })

  it('clears the auth token on 401 and throws', async () => {
    const auth = useAuthStore()
    mockFetch(new Response('', { status: 401 }))
    await expect(retryLastResponse(1)).rejects.toThrow('unauthorized')
    expect(auth.isAuthenticated).toBe(false)
  })
})

describe('editAndRegenerate', () => {
  beforeEach(() => {
    const auth = useAuthStore()
    auth.setToken('test-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs the new content to the edit-and-regenerate endpoint', async () => {
    const spy = mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 42 } },
        { event: 'done', data: {} },
      ])),
    )
    await editAndRegenerate(42, 99, 'corrected text')
    expect(spy).toHaveBeenCalledWith(
      '/api/conversations/42/messages/99/edit-and-regenerate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    )
    expect((spy.mock.calls[0][1] as RequestInit).body).toBe(
      JSON.stringify({ content: 'corrected text' }),
    )
  })

  it('streams text and returns the regenerated result like a normal send', async () => {
    mockFetch(
      new Response(sseBody([
        { event: 'session', data: { conversation_id: 7 } },
        { event: 'run', data: { run_id: 'edit-run' } },
        { event: 'text', data: { content: 'edited ' } },
        { event: 'text', data: { content: 'answer' } },
        { event: 'done', data: {} },
      ])),
    )
    const chunks: string[] = []
    const result = await editAndRegenerate(7, 3, 'new prompt', {
      onText: (c) => chunks.push(c),
    })
    expect(chunks).toEqual(['edited ', 'answer'])
    expect(result.conversationId).toBe(7)
    expect(result.runId).toBe('edit-run')
    expect(result.text).toBe('edited answer')
    expect(result.cancelled).toBe(false)
  })

  it('throws when no auth token is set', async () => {
    const auth = useAuthStore()
    auth.clear()
    await expect(editAndRegenerate(1, 1, 'x')).rejects.toThrow('not authenticated')
  })

  it('clears the auth token on 401 and throws', async () => {
    const auth = useAuthStore()
    mockFetch(new Response('', { status: 401 }))
    await expect(editAndRegenerate(1, 1, 'x')).rejects.toThrow('unauthorized')
    expect(auth.isAuthenticated).toBe(false)
  })
})

describe('cancelChatRun', () => {
  beforeEach(() => {
    const auth = useAuthStore()
    auth.setToken('test-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to /api/chat/runs/{id}/cancel with the bearer token', async () => {
    const spy = mockFetch(new Response(null, { status: 204 }))
    await cancelChatRun('run-xyz')
    expect(spy).toHaveBeenCalledWith(
      '/api/chat/runs/run-xyz/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    )
  })

  it('resolves silently on 404 (the run already finished)', async () => {
    // The race between "user clicks Stop" and "stream ends" is normal;
    // a 404 here just means the run already cleaned itself up.
    mockFetch(new Response('', { status: 404 }))
    await expect(cancelChatRun('gone')).resolves.toBeUndefined()
  })

  it('throws on other non-2xx responses', async () => {
    mockFetch(new Response('', { status: 500 }))
    await expect(cancelChatRun('boom')).rejects.toThrow()
  })

  it('throws a ChatStreamError with code=unauthorized when no token is set', async () => {
    const auth = useAuthStore()
    auth.clear()
    await expect(cancelChatRun('r1')).rejects.toMatchObject({
      name: 'ChatStreamError',
      code: 'unauthorized',
      statusCode: 401,
    })
  })

  it('clears the token and throws unauthorized on a 401 response', async () => {
    const auth = useAuthStore()
    mockFetch(new Response('', { status: 401 }))
    await expect(cancelChatRun('r1')).rejects.toMatchObject({
      name: 'ChatStreamError',
      code: 'unauthorized',
      statusCode: 401,
    })
    expect(auth.isAuthenticated).toBe(false)
  })
})

describe('friendlyChatError', () => {
  // Pass-through `$t` — the helper hands us back the i18n key + params,
  // which is all this test needs to verify (the locale files own the
  // actual copy; tests/i18n/keys.test.ts pins their completeness).
  const t = (key: string, params?: Record<string, unknown>) => {
    if (params && Object.keys(params).length > 0) {
      return `${key}|${JSON.stringify(params)}`
    }
    return key
  }

  it('falls back to errors.chat.unknown for unknown ChatStreamError codes', () => {
    const err = new ChatStreamError('internal backend detail', { code: 'future_new_code' })
    expect(friendlyChatError(err, t)).toBe('errors.chat.unknown')
  })

  it('maps upstream_timeout to its i18n key', () => {
    const err = new ChatStreamError('upstream timed out', { code: 'upstream_timeout' })
    expect(friendlyChatError(err, t)).toContain('errors.chat.upstream_timeout')
  })

  it('maps upstream_unreachable to its i18n key', () => {
    const err = new ChatStreamError('boom', { code: 'upstream_unreachable' })
    expect(friendlyChatError(err, t)).toContain('errors.chat.upstream_unreachable')
  })

  it('surfaces the upstream status code in the params for upstream_http_error', () => {
    const err = new ChatStreamError('upstream returned 500', {
      code: 'upstream_http_error',
      statusCode: 500,
    })
    const rendered = friendlyChatError(err, t)
    expect(rendered).toContain('errors.chat.upstream_http_error')
    expect(rendered).toContain('500')
  })

  it('passes the raw message through params for agent_error', () => {
    const err = new ChatStreamError('tool catalog blew up', { code: 'agent_error' })
    const rendered = friendlyChatError(err, t)
    expect(rendered).toContain('errors.chat.agent_error')
    expect(rendered).toContain('tool catalog blew up')
  })

  it('falls back to errors.chat.unknown for plain Errors', () => {
    expect(friendlyChatError(new Error('nope'), t)).toBe('errors.chat.unknown')
  })

  it('falls back to errors.chat.unknown for non-Error values', () => {
    expect(friendlyChatError('weird', t)).toBe('errors.chat.unknown')
  })
})

