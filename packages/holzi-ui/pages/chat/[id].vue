<script setup lang="ts">
// Plan 26: deep-link route. Parses the id from the URL, validates the
// conversation exists (404 → toast + back to /), and hands the numeric
// id to <ChatHub>. The hub handles all chat state — this page is just
// the URL adapter. `useHead({ title })` updates the browser tab so
// multi-tab workflows don't all show "Neuer Chat".
const route = useRoute()
const api = useApi()
const toast = useToast()
const localePath = useLocalePath()
const { t } = useI18n({ useScope: 'global' })

// Route param is always a string. Bookmarks and copy-paste can land
// here with garbage; reject anything that isn't a positive integer so
// the API gets a clean id (or we redirect away before mounting).
const conversationId = computed<number | null>(() => {
  const raw = route.params.id
  const s = Array.isArray(raw) ? raw[0] : raw
  if (typeof s !== 'string') return null
  const n = Number(s)
  return Number.isInteger(n) && n > 0 ? n : null
})

const valid = ref<boolean | null>(null)

useHead({
  title: () =>
    valid.value && conversationId.value !== null
      ? `Chat ${conversationId.value} · Holzi`
      : 'Holzi',
})

async function validate(id: number | null) {
  if (id === null) {
    toast.error(t('pages.chat.notFound'))
    await navigateTo(localePath('/'), { replace: true })
    return
  }
  try {
    await api.get(`/api/conversations/${id}`)
    valid.value = true
  }
  catch (err: unknown) {
    const status = (err as { statusCode?: number; status?: number })?.statusCode
      ?? (err as { status?: number })?.status
    // Token stale or invalid — the middleware already passed because it only
    // runs on navigation. Clear the token and go to login explicitly so the
    // user isn't left on a blank page.
    if (status === 401) {
      await navigateTo(localePath('/login'), { replace: true })
      return
    }
    valid.value = false
    toast.error(t('pages.chat.notFound'))
    await navigateTo(localePath('/'), { replace: true })
  }
}

// Re-validate when the param changes — covers browser back/forward
// between two different /chat/:id URLs.
watch(conversationId, (id) => { void validate(id) })

onMounted(() => { void validate(conversationId.value) })
</script>

<template>
  <ChatHub v-if="valid && conversationId !== null" :conversation-id="conversationId" />
</template>
