import { describe, expect, it } from 'vitest'
import { useAuthStore } from '~/stores/auth'

describe('useAuthStore', () => {
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
})
