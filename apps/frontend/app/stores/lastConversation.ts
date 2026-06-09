import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'

// Plan 26: deep-link state — the most recently active conversation id
// survives reloads so `/` can redirect back to `/chat/<id>`. Modelled
// after `auth.ts` so the storage pattern stays consistent (Pinia store
// wrapping a VueUse `useLocalStorage` ref). `null` means "no last
// conversation" — the empty hub renders.
const KEY = 'holzi.lastConversationId'

// Custom serializer: VueUse's built-in number serializer falls back to
// NaN for unparseable strings, which then bypasses our `=== null` guard
// at call sites. We normalise garbage (legacy values, hand-edited
// localStorage, NaN) to `null` on read so downstream code can rely on
// the type contract `number | null` literally.
const serializer = {
  read(raw: string): number | null {
    const n = Number(raw)
    return Number.isInteger(n) && n > 0 ? n : null
  },
  write(value: number | null): string {
    return value === null ? '' : String(value)
  },
}

export const useLastConversationStore = defineStore('lastConversation', () => {
  const id = useLocalStorage<number | null>(KEY, null, { serializer })

  function remember(value: number | null) {
    id.value = value
  }

  function clear() {
    id.value = null
  }

  return { id, remember, clear }
})
