<script setup lang="ts">
import { AlertCircle, X } from 'lucide-vue-next'
import type { ChatStreamError } from '~/composables/useChatStream'

const props = defineProps<{
  error: ChatStreamError
}>()
const emit = defineEmits<{ dismiss: [] }>()
const { t } = useI18n({ useScope: 'global' })
const localePath = useLocalePath()

// Show the model-switch hint for provider-side errors where changing the
// model is the most actionable response. Not for network/auth errors.
const HINT_CODES = new Set([
  'upstream_rate_limited',
  'upstream_http_error',
  'upstream_timeout',
])

const showHint = computed(() => HINT_CODES.has(props.error.code))

const statusSuffix = computed(() =>
  props.error.statusCode ? ` (${props.error.statusCode})` : '',
)

const heading = computed(() =>
  t(`errors.chat.${props.error.code}`, {
    message: props.error.message,
    statusSuffix: statusSuffix.value,
  }),
)
</script>

<template>
  <div
    role="alert"
    class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
  >
    <AlertCircle class="mt-0.5 size-4 shrink-0" />
    <div class="flex-1 space-y-2">
      <p class="font-medium">{{ heading }}</p>
      <div v-if="showHint" class="text-xs text-destructive/80">
        <p>{{ t('errors.chat.hintModelSwitch') }}</p>
        <ul class="mt-1 list-disc pl-4 space-y-0.5">
          <li><code class="font-mono">{{ t('errors.chat.hintModelSwitchCommand') }}</code></li>
          <li>
            <NuxtLink
              :to="localePath('/settings/preferences')"
              class="underline underline-offset-2 hover:opacity-80"
            >
              {{ t('errors.chat.hintModelSwitchLink') }}
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>
    <button
      type="button"
      class="rounded p-0.5 text-destructive/70 hover:text-destructive"
      :aria-label="$t('common.close')"
      @click="emit('dismiss')"
    >
      <X class="size-3.5" />
    </button>
  </div>
</template>
