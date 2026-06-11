import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'

const TOKEN_KEY = 'hermes.auth.token'
const HOST_KEY = 'hermes.host'

interface MeResponse {
  user_id: number
  role: string
  email: string | null
  bootstrap_completed: boolean
}

export const useAuthStore = defineStore('auth', () => {
  const token = useLocalStorage<string>(TOKEN_KEY, '')
  const host = useLocalStorage<string>(HOST_KEY, '')

  // Identity is derived from the token (re-fetched via /api/auth/me), so it
  // is plain reactive state — not persisted to localStorage.
  const userId = ref<number | null>(null)
  const role = ref<string | null>(null)

  const isAuthenticated = computed(() => token.value.length > 0)
  const isAdmin = computed(() => role.value === 'admin')
  // baseUrl: empty string → relative paths (frontend dev-proxy / same-origin).
  // Webview seeds `host` via postMessage from extension → absolute URLs.
  const baseUrl = computed(() => host.value)

  function setToken(value: string) { token.value = value.trim() }
  function setHost(value: string) { host.value = value.replace(/\/$/, '') }
  function clear() {
    token.value = ''
    host.value = ''
    userId.value = null
    role.value = null
  }

  // Call the API directly via Nuxt's `$fetch` global (rather than useApi) to
  // avoid a circular dependency — useApi imports this store. Read `$fetch`
  // lazily inside each call (matching useApi) so we use the live global.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetcher = () => $fetch as any

  /**
   * Fetch the logged-in user's identity from /api/auth/me. No-op without a
   * token. A 401 means the token is stale/invalid → clear it. Network errors
   * are swallowed so boot doesn't crash; identity simply stays null.
   */
  async function loadIdentity() {
    if (!token.value) return
    try {
      const me = (await fetcher()(`${baseUrl.value}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token.value}` },
      })) as MeResponse
      userId.value = me.user_id
      role.value = me.role
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode
      if (status === 401) {
        clear()
      }
    }
  }

  /**
   * Delete the server-side session backing the bearer, then clear local auth
   * state. The logout request is best-effort — local state is cleared even if
   * the network call fails.
   */
  async function logout() {
    if (token.value) {
      try {
        await fetcher()(`${baseUrl.value}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token.value}` },
        })
      } catch {
        // best-effort: clear local state regardless
      }
    }
    clear()
  }

  return {
    token,
    host,
    userId,
    role,
    baseUrl,
    isAuthenticated,
    isAdmin,
    setToken,
    setHost,
    clear,
    loadIdentity,
    logout,
  }
})
