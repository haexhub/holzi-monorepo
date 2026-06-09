<script setup lang="ts">
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-vue-next'

// One subagent's grouped activity: its label, the task it was handed, its
// streamed output, and its final result/error. `status` flips running →
// success/error. Collapsible like the other cards; the page assembles `text`
// from subagent_text deltas and fills result/error on subagent_done.
const props = defineProps<{
  subagent: {
    name: string
    prompt?: string | null
    status: 'running' | 'success' | 'error'
    text?: string
    result?: string | null
    error?: string | null
  }
}>()

const { t } = useI18n({ useScope: 'global' })

const expanded = ref(false)

// Final output on success, error text on failure; falls back to the streamed
// text while still running.
const output = computed(() => {
  const s = props.subagent
  if (s.status === 'error') return s.error ?? s.text ?? ''
  return s.result ?? s.text ?? ''
})

const hasDetails = computed(
  () => !!props.subagent.prompt || !!output.value,
)

const statusLabel = computed(() => {
  switch (props.subagent.status) {
    case 'running':
      return t('components.subagentCard.status.running')
    case 'success':
      return t('components.subagentCard.status.success')
    case 'error':
      return t('components.subagentCard.status.error')
    default:
      return ''
  }
})

function toggle() {
  if (hasDetails.value) expanded.value = !expanded.value
}
</script>

<template>
  <div class="w-full max-w-[80%] overflow-hidden rounded-xl border border-sky-500/30 text-xs">
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
      :class="{
        'bg-sky-500/10 text-sky-700 dark:text-sky-300': subagent.status === 'running',
        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300': subagent.status === 'success',
        'bg-destructive/10 text-destructive': subagent.status === 'error',
        'cursor-default': !hasDetails,
        'hover:opacity-80': hasDetails,
      }"
      :aria-expanded="expanded"
      :disabled="!hasDetails"
      @click="toggle"
    >
      <Bot class="size-3.5 shrink-0" />
      <span class="font-medium">{{ $t('components.subagentCard.label') }}</span>
      <span class="font-mono">{{ subagent.name }}</span>
      <span class="ml-auto inline-flex items-center gap-1">
        <Loader2 v-if="subagent.status === 'running'" class="size-3.5 animate-spin" />
        <Check v-else-if="subagent.status === 'success'" class="size-3.5" />
        <AlertTriangle v-else class="size-3.5" />
        <span>{{ statusLabel }}</span>
        <component
          :is="expanded ? ChevronDown : ChevronRight"
          v-if="hasDetails"
          class="size-3.5"
        />
      </span>
    </button>

    <div v-if="expanded && hasDetails" class="space-y-2 border-t bg-background px-3 py-2">
      <div v-if="subagent.prompt">
        <p class="mb-1 font-medium text-muted-foreground">{{ $t('components.subagentCard.task') }}</p>
        <pre class="max-h-32 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap break-words font-sans">{{ subagent.prompt }}</pre>
      </div>
      <div v-if="output">
        <p
          class="mb-1 font-medium"
          :class="subagent.status === 'error' ? 'text-destructive' : 'text-muted-foreground'"
        >
          {{ subagent.status === 'error' ? $t('components.subagentCard.status.error') : $t('components.subagentCard.output') }}
        </p>
        <pre
          class="max-h-64 overflow-auto rounded p-2 whitespace-pre-wrap break-words font-sans"
          :class="subagent.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted'"
        >{{ output }}</pre>
      </div>
    </div>
  </div>
</template>
