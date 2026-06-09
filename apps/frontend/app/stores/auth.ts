import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'

const TOKEN_KEY = 'hermes.auth.token'

export const useAuthStore = defineStore('auth', () => {
  // useLocalStorage gives us a ref that is automatically persisted.
  const token = useLocalStorage<string>(TOKEN_KEY, '')

  const isAuthenticated = computed(() => token.value.length > 0)

  function setToken(value: string) {
    token.value = value.trim()
  }

  function clear() {
    token.value = ''
  }

  return { token, isAuthenticated, setToken, clear }
})
