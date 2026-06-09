<script setup lang="ts">
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Wrench,
} from 'lucide-vue-next'

// Accepts both the persisted ToolCallView (status success|error) and the
// in-flight card the page assembles while streaming (status running), so the
// same component renders live and on reload.
const props = defineProps<{
  toolCall: {
    name: string
    arguments?: Record<string, unknown> | null
    status: 'running' | 'success' | 'error'
    result?: string | null
    error?: string | null
  }
}>()

const { t } = useI18n({ useScope: 'global' })

const expanded = ref(false)

const hasArguments = computed(() => {
  const a = props.toolCall.arguments
  return a != null && Object.keys(a).length > 0
})

const prettyArguments = computed(() =>
  hasArguments.value ? JSON.stringify(props.toolCall.arguments, null, 2) : '',
)

// Result text on success, error text on failure — whichever is populated.
const output = computed(() => {
  const tc = props.toolCall
  return tc.status === 'error' ? (tc.error ?? '') : (tc.result ?? '')
})

const hasDetails = computed(() => hasArguments.value || !!output.value)

const statusLabel = computed(() => {
  switch (props.toolCall.status) {
    case 'running':
      return t('components.toolCallCard.status.running')
    case 'success':
      return t('components.toolCallCard.status.success')
    case 'error':
      return t('components.toolCallCard.status.error')
    default:
      return ''
  }
})

function toggle() {
  if (hasDetails.value) expanded.value = !expanded.value
}
</script>

<template>
  <div class="w-full max-w-[80%] overflow-hidden rounded-xl border text-xs">
    <!-- Collapsed summary: tool name + status. Click to expand. -->
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
      :class="{
        'bg-muted/60 text-muted-foreground': toolCall.status === 'running',
        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300': toolCall.status === 'success',
        'bg-destructive/10 text-destructive': toolCall.status === 'error',
        'cursor-default': !hasDetails,
        'hover:opacity-80': hasDetails,
      }"
      :aria-expanded="expanded"
      :disabled="!hasDetails"
      @click="toggle"
    >
      <Wrench class="size-3.5 shrink-0" />
      <span class="font-mono font-medium">{{ toolCall.name }}</span>
      <span class="ml-auto inline-flex items-center gap-1">
        <Loader2 v-if="toolCall.status === 'running'" class="size-3.5 animate-spin" />
        <Check v-else-if="toolCall.status === 'success'" class="size-3.5" />
        <AlertTriangle v-else class="size-3.5" />
        <span>{{ statusLabel }}</span>
        <component
          :is="expanded ? ChevronDown : ChevronRight"
          v-if="hasDetails"
          class="size-3.5"
        />
      </span>
    </button>

    <!-- Expanded details: arguments + result/error. -->
    <div v-if="expanded && hasDetails" class="space-y-2 border-t bg-background px-3 py-2">
      <div v-if="hasArguments">
        <p class="mb-1 font-medium text-muted-foreground">{{ $t('components.toolCallCard.arguments') }}</p>
        <pre class="max-h-48 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap break-words">{{ prettyArguments }}</pre>
      </div>
      <div v-if="output">
        <p
          class="mb-1 font-medium"
          :class="toolCall.status === 'error' ? 'text-destructive' : 'text-muted-foreground'"
        >
          {{ toolCall.status === 'error' ? $t('components.toolCallCard.status.error') : $t('components.toolCallCard.result') }}
        </p>
        <pre
          class="max-h-64 overflow-auto rounded p-2 font-mono whitespace-pre-wrap break-words"
          :class="toolCall.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted'"
        >{{ output }}</pre>
      </div>
    </div>
  </div>
</template>
