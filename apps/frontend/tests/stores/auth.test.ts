import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '~/stores/auth'

// The store calls Nuxt's $fetch global for /api/auth/me + /api/auth/logout.
// In a plain Vitest env we stub it per test (same pattern as useApi.test.ts).
function stubFetch(impl: (path: string, opts: Record<string, unknown>) => unknown) {
  const fn = vi.fn(impl)
  vi.stubGlobal('$fetch', fn)
  return fn
}

describe('useAuthStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts unauthenticated', () => {
    const auth = useAuthStore()
    expect(auth.token).toBe('')
    expect(auth.isAuthenticated).toBe(false)
  })

  it('setToken trims whitespace and persists to localStorage', async () => {
    const auth = useAuthStore()
    auth.setToken('  abc123  ')
    expect(auth.token).toBe('abc123')
    expect(auth.isAuthenticated).toBe(true)
    // VueUse's useLocalStorage flushes via a watcher — wait one tick.
    await nextTick()
    expect(localStorage.getItem('hermes.auth.token')).toBe('abc123')
  })

  it('clear empties the token', () => {
    const auth = useAuthStore()
    auth.setToken('abc')
    auth.clear()
    expect(auth.token).toBe('')
    expect(auth.isAuthenticated).toBe(false)
  })

  it('reads existing token from localStorage', () => {
    localStorage.setItem('hermes.auth.token', 'persisted')
    const auth = useAuthStore()
    expect(auth.token).toBe('persisted')
    expect(auth.isAuthenticated).toBe(true)
  })

  it('starts with null identity and isAdmin false', () => {
    const auth = useAuthStore()
    expect(auth.userId).toBeNull()
    expect(auth.role).toBeNull()
    expect(auth.isAdmin).toBe(false)
  })

  it('loadIdentity is a no-op without a token', async () => {
    const spy = stubFetch(() => ({}))
    const auth = useAuthStore()
    await auth.loadIdentity()
    expect(spy).not.toHaveBeenCalled()
    expect(auth.userId).toBeNull()
    expect(auth.role).toBeNull()
  })

  it('loadIdentity sets userId/role from /api/auth/me', async () => {
    const spy = stubFetch(() => ({
      user_id: 7,
      role: 'admin',
      email: 'a@b.c',
      bootstrap_completed: true,
    }))
    const auth = useAuthStore()
    auth.setToken('test-token')
    await auth.loadIdentity()
    expect(spy).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
    expect(auth.userId).toBe(7)
    expect(auth.role).toBe('admin')
    expect(auth.isAdmin).toBe(true)
  })

  it('loadIdentity leaves isAdmin false for non-admin roles', async () => {
    stubFetch(() => ({
      user_id: 3,
      role: 'member',
      email: null,
      bootstrap_completed: true,
    }))
    const auth = useAuthStore()
    auth.setToken('test-token')
    await auth.loadIdentity()
    expect(auth.role).toBe('member')
    expect(auth.isAdmin).toBe(false)
  })

  it('loadIdentity clears the store when /api/auth/me returns 401', async () => {
    stubFetch(() => {
      const err = new Error('Unauthorized') as Error & { statusCode: number }
      err.statusCode = 401
      throw err
    })
    const auth = useAuthStore()
    auth.setToken('stale-token')
    await auth.loadIdentity()
    expect(auth.token).toBe('')
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.userId).toBeNull()
    expect(auth.role).toBeNull()
  })

  it('loadIdentity stays resilient on network error (identity null, token kept)', async () => {
    stubFetch(() => {
      throw new Error('network down')
    })
    const auth = useAuthStore()
    auth.setToken('test-token')
    await auth.loadIdentity()
    expect(auth.token).toBe('test-token')
    expect(auth.userId).toBeNull()
    expect(auth.role).toBeNull()
  })

  it('logout posts to /api/auth/logout and clears token + identity', async () => {
    const spy = stubFetch(() => ({ ok: true }))
    const auth = useAuthStore()
    auth.setToken('test-token')
    auth.userId = 7
    auth.role = 'admin'
    await auth.logout()
    expect(spy).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
    expect(auth.token).toBe('')
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.userId).toBeNull()
    expect(auth.role).toBeNull()
  })

  it('logout without a token does not call the API but still clears', async () => {
    const spy = stubFetch(() => ({ ok: true }))
    const auth = useAuthStore()
    await auth.logout()
    expect(spy).not.toHaveBeenCalled()
    expect(auth.token).toBe('')
    expect(auth.userId).toBeNull()
  })
})
