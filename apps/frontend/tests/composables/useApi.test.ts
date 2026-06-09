import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApi } from '~/composables/useApi'
import { useAuthStore } from '~/stores/auth'

// useApi uses Nuxt's $fetch global. In a plain Vitest env we stub it per test.
function stubFetch(impl: (path: string, opts: Record<string, unknown>) => unknown) {
  const fn = vi.fn(impl)
  vi.stubGlobal('$fetch', fn)
  return fn
}

describe('useApi', () => {
  beforeEach(() => {
    const auth = useAuthStore()
    auth.setToken('test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('throws when no auth token is set', async () => {
    const auth = useAuthStore()
    auth.clear()
    stubFetch(() => ({}))
    const api = useApi()
    await expect(api.get('/api/notes')).rejects.toThrow('not authenticated')
  })

  it('injects the Bearer header into $fetch calls', async () => {
    const spy = stubFetch(() => [])
    const api = useApi()
    await api.get('/api/notes')
    expect(spy).toHaveBeenCalledWith(
      '/api/notes',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
  })

  it('forwards body on POST', async () => {
    const spy = stubFetch(() => ({ id: 1 }))
    const api = useApi()
    await api.post('/api/notes', { key: 'k', content: 'v', tags: [] })
    expect(spy).toHaveBeenCalledWith(
      '/api/notes',
      expect.objectContaining({
        method: 'POST',
        body: { key: 'k', content: 'v', tags: [] },
      }),
    )
  })

  it('clears the auth token when the server returns 401', async () => {
    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(true)
    stubFetch(() => {
      const err = new Error('Unauthorized') as Error & { statusCode: number }
      err.statusCode = 401
      throw err
    })
    const api = useApi()
    await expect(api.get('/api/notes')).rejects.toThrow('Unauthorized')
    expect(auth.isAuthenticated).toBe(false)
  })

  it('does NOT clear the auth token on non-401 errors', async () => {
    const auth = useAuthStore()
    stubFetch(() => {
      const err = new Error('boom') as Error & { statusCode: number }
      err.statusCode = 500
      throw err
    })
    const api = useApi()
    await expect(api.get('/api/notes')).rejects.toThrow('boom')
    expect(auth.isAuthenticated).toBe(true)
  })

  it('forwards query params on GET', async () => {
    const spy = stubFetch(() => [])
    const api = useApi()
    await api.get('/api/conversations', { channel: 'web', limit: 10 })
    expect(spy).toHaveBeenCalledWith(
      '/api/conversations',
      expect.objectContaining({
        method: 'GET',
        query: { channel: 'web', limit: 10 },
      }),
    )
  })
})
