import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'

const TOKEN_KEY = 'hermes.auth.token'
const HOST_KEY = 'hermes.host'

export const useAuthStore = defineStore('auth', () => {
  const token = useLocalStorage<string>(TOKEN_KEY, '')
  const host = useLocalStorage<string>(HOST_KEY, '')

  const isAuthenticated = computed(() => token.value.length > 0)
  // baseUrl: empty string → relative paths (frontend dev-proxy / same-origin).
  // Webview seeds `host` via postMessage from extension → absolute URLs.
  const baseUrl = computed(() => host.value)

  function setToken(value: string) { token.value = value.trim() }
  function setHost(value: string) { host.value = value.replace(/\/$/, '') }
  function clear() { token.value = ''; host.value = '' }

  return { token, host, baseUrl, isAuthenticated, setToken, setHost, clear }
})
