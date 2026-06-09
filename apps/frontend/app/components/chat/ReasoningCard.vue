<script setup lang="ts">
import { Brain, ChevronDown, ChevronRight, Loader2 } from 'lucide-vue-next'

// The model's reasoning / "thinking" for one assistant turn. Collapsed by
// default so it never dominates the chat; the user's "show reasoning by
// default" preference flips the initial state. `streaming` shows a spinner
// while reasoning is still arriving. Renders the same live and on reload.
const props = defineProps<{
  content: string
  streaming?: boolean
}>()

const { showReasoningByDefault } = useReasoningPreference()
const expanded = ref(showReasoningByDefault.value)

// Respect the preference if it flips while the card is mounted (e.g. the user
// toggles it in settings during a live turn), but never collapse a card the
// user opened by hand — only auto-open.
watch(showReasoningByDefault, (show) => {
  if (show) expanded.value = true
})

function toggle() {
  expanded.value = !expanded.value
}
</script>

<template>
  <div class="w-full max-w-[80%] overflow-hidden rounded-xl border border-violet-500/30 text-xs">
    <button
      type="button"
      class="flex w-full items-center gap-2 bg-violet-500/10 px-3 py-2 text-left text-violet-700 transition-colors hover:opacity-80 dark:text-violet-300"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <Brain class="size-3.5 shrink-0" />
      <span class="font-medium">{{ $t('components.reasoningCard.title') }}</span>
      <span class="ml-auto inline-flex items-center gap-1">
        <Loader2 v-if="streaming" class="size-3.5 animate-spin" />
        <span v-if="streaming">{{ $t('components.reasoningCard.thinking') }}</span>
        <component :is="expanded ? ChevronDown : ChevronRight" class="size-3.5" />
      </span>
    </button>

    <div v-if="expanded" class="border-t bg-background px-3 py-2">
      <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-muted-foreground">{{ content }}</pre>
    </div>
  </div>
</template>
