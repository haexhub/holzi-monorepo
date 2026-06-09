import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLlmCredentials } from '~/composables/useLlmCredentials'
import { useAuthStore } from '~/stores/auth'

function stubFetch(impl: (path: string, opts: Record<string, unknown>) => unknown) {
  const fn = vi.fn(impl)
  vi.stubGlobal('$fetch', fn)
  return fn
}

describe('useLlmCredentials', () => {
  beforeEach(() => {
    useAuthStore().setToken('test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('GETs the list endpoint', async () => {
    const spy = stubFetch(() => [])
    await useLlmCredentials().list()
    expect(spy).toHaveBeenCalledWith(
      '/api/llm/credentials',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('POSTs a new api-key credential with the body verbatim', async () => {
    const spy = stubFetch(() => ({ id: 1 }))
    await useLlmCredentials().createApiKey({
      provider: 'openai',
      display_name: 'mine',
      api_key: 'sk-x',
      base_url: null,
    })
    expect(spy).toHaveBeenCalledWith(
      '/api/llm/credentials',
      expect.objectContaining({
        method: 'POST',
        body: {
          provider: 'openai',
          display_name: 'mine',
          api_key: 'sk-x',
          base_url: null,
        },
      }),
    )
  })

  it('PATCHes activate with no body', async () => {
    const spy = stubFetch(() => ({ id: 42, is_active: true }))
    await useLlmCredentials().activate(42)
    expect(spy).toHaveBeenCalledWith(
      '/api/llm/credentials/42/activate',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('DELETEs by id', async () => {
    const spy = stubFetch(() => undefined)
    await useLlmCredentials().delete(7)
    expect(spy).toHaveBeenCalledWith(
      '/api/llm/credentials/7',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('PATCHes model with the value in body', async () => {
    const spy = stubFetch(() => ({ id: 1, model: 'gpt-5' }))
    await useLlmCredentials().setModel(1, 'gpt-5')
    expect(spy).toHaveBeenCalledWith(
      '/api/llm/credentials/1/model',
      expect.objectContaining({
        method: 'PATCH',
        body: { model: 'gpt-5' },
      }),
    )
  })

  it('PATCHes model with null to clear', async () => {
    const spy = stubFetch(() => ({ id: 1, model: null }))
    await useLlmCredentials().setModel(1, null)
    expect(spy).toHaveBeenCalledWith(
      '/api/llm/credentials/1/model',
      expect.objectContaining({
        method: 'PATCH',
        body: { model: null },
      }),
    )
  })

  it('GETs the per-credential models list', async () => {
    const spy = stubFetch(() => ({
      models: [{ id: 'gpt-5', label: 'GPT-5 (gpt-5)' }],
    }))
    const r = await useLlmCredentials().listModels(42)
    expect(spy).toHaveBeenCalledWith(
      '/api/llm/credentials/42/models',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(r.models[0].id).toBe('gpt-5')
  })

  it('POSTs oauth start', async () => {
    const spy = stubFetch(() => ({ id: 1, url: 'https://claude.com/cai/oauth/x' }))
    const result = await useLlmCredentials().oauthStart()
    expect(spy).toHaveBeenCalledWith(
      '/api/llm/credentials/oauth/start',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.url).toMatch(/^https:\/\/claude\.com\//)
  })

  it('POSTs oauth code with the code in body', async () => {
    const spy = stubFetch(() => ({ id: 1, oauth_status: 'authorized' }))
    await useLlmCredentials().oauthSubmitCode(99, 'abc-123')
    expect(spy).toHaveBeenCalledWith(
      '/api/llm/credentials/oauth/99/code',
      expect.objectContaining({
        method: 'POST',
        body: { code: 'abc-123' },
      }),
    )
  })

  it('GETs oauth status', async () => {
    const spy = stubFetch(() => ({ id: 5, status: 'pending' }))
    const result = await useLlmCredentials().oauthStatus(5)
    expect(spy).toHaveBeenCalledWith(
      '/api/llm/credentials/oauth/5/status',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(result.status).toBe('pending')
  })

  it('POSTs oauth cancel', async () => {
    const spy = stubFetch(() => undefined)
    await useLlmCredentials().oauthCancel(5)
    expect(spy).toHaveBeenCalledWith(
      '/api/llm/credentials/oauth/5/cancel',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
