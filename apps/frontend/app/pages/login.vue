<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n({ useScope: 'global' })

const token = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

definePageMeta({ layout: 'default' })

async function submit() {
  if (!token.value.trim()) {
    error.value = t('pages.login.errors.tokenRequired')
    return
  }
  submitting.value = true
  error.value = null
  try {
    // Probe the API once to validate the token before storing it.
    const res = await fetch('/api/ping', {
      headers: { Authorization: `Bearer ${token.value.trim()}` },
    })
    if (res.status === 401) {
      error.value = t('pages.login.errors.tokenInvalid')
      return
    }
    if (!res.ok) {
      error.value = t('pages.login.errors.serverError', { status: res.status })
      return
    }
    auth.setToken(token.value)
    await router.replace('/')
  } catch {
    // We deliberately ignore the underlying `err.message` here — fetch
    // failures in this branch are network/DNS issues whose message is
    // never user-friendly, and the translated copy is enough context.
    error.value = t('pages.login.errors.network')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  if (auth.isAuthenticated) {
    router.replace('/')
  }
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-4">
    <UiCard class="w-full max-w-md">
      <UiCardHeader>
        <UiCardTitle>{{ $t('pages.login.title') }}</UiCardTitle>
        <UiCardDescription>
          {{ $t('pages.login.description') }}
        </UiCardDescription>
      </UiCardHeader>
      <UiCardContent>
        <form class="space-y-4" @submit.prevent="submit">
          <div class="space-y-2">
            <UiLabel for="token">{{ $t('pages.login.tokenLabel') }}</UiLabel>
            <UiInput
              id="token"
              v-model="token"
              type="password"
              :placeholder="$t('pages.login.tokenPlaceholder')"
              autocomplete="current-password"
              autofocus
            />
          </div>
          <p v-if="error" class="text-sm text-destructive">
            {{ error }}
          </p>
          <UiButton type="submit" :disabled="submitting" class="w-full">
            {{ submitting ? $t('pages.login.submitting') : $t('pages.login.submit') }}
          </UiButton>
        </form>
      </UiCardContent>
    </UiCard>
  </div>
</template>
