<script setup lang="ts">
// Plan 26: `/` is a redirect-or-empty-hub shell. On mount we read the
// last-active conversation id from the Pinia store (VueUse
// `useLocalStorage` under the hood) and verify it still exists on the
// server. If so we replace `/` with `/chat/<id>` so reloads land on
// the same chat. Otherwise the empty hub renders. `ready` keeps the
// hub unmounted during the redirect so its onMounted doesn't fire a
// stray fetch we'd immediately throw away.
import { useLastConversationStore } from '~/stores/lastConversation'

const api = useApi()
const lastConv = useLastConversationStore()
const localePath = useLocalePath()

const ready = ref(false)

onMounted(async () => {
  const lastId = lastConv.id
  if (lastId === null) {
    ready.value = true
    return
  }
  try {
    await api.get(`/api/conversations/${lastId}`)
    await navigateTo(localePath(`/chat/${lastId}`), { replace: true })
  }
  catch (err: unknown) {
    const status = (err as { statusCode?: number; status?: number })?.statusCode
      ?? (err as { status?: number })?.status
    if (status === 401) {
      await navigateTo(localePath('/login'), { replace: true })
      return
    }
    // 404 / network — drop the stale pointer, render the empty hub.
    lastConv.clear()
    ready.value = true
  }
})
</script>

<template>
  <ChatHub v-if="ready" />
</template>
