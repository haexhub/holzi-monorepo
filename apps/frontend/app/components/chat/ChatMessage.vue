<script setup lang="ts">
import { Pencil, RotateCcw } from 'lucide-vue-next'
import type { Message } from '~/types/api'

const props = defineProps<{
  // `ts` is optional: persisted messages carry it; the in-flight streaming
  // bubble does not. `tool_call` is set on persisted tool turns; `reasoning`
  // on persisted assistant turns where the provider exposed thinking.
  message: Pick<Message, 'role' | 'content'> & {
    ts?: number
    tool_call?: Message['tool_call']
    reasoning?: Message['reasoning']
    attachments?: Message['attachments']
  }
  // When true (set by the page on the latest assistant turn), show a
  // Retry control that regenerates this response.
  canRetry?: boolean
  // Disable the Retry control while another run is in flight.
  retryDisabled?: boolean
  // When true (set by the page on user turns), show an Edit control that
  // rewrites this message and regenerates everything after it.
  canEdit?: boolean
  // Disable the Edit control while another run is in flight.
  editDisabled?: boolean
  // Set on the in-flight streaming bubble: keep it plain text so we don't
  // re-run shiki on every chunk. The persisted turn renders as Markdown.
  plain?: boolean
}>()

const emit = defineEmits<{ retry: []; edit: [content: string] }>()

const isUser = computed(() => props.message.role === 'user')
const isTool = computed(() => props.message.role === 'tool')
// Only persisted assistant prose gets Markdown rendering; user, tool, and the
// still-streaming bubble stay literal.
const isAssistant = computed(() => props.message.role === 'assistant')
const renderMarkdown = computed(() => isAssistant.value && !props.plain)

// The card view of a persisted tool turn (null on the legacy plain-text path).
const toolCall = computed(() => props.message.tool_call ?? null)

// Files attached to a user turn (Plan 11), rendered as chips under the bubble.
const attachments = computed(() => props.message.attachments ?? [])

// Persisted reasoning for an assistant turn (live reasoning is rendered by the
// page from the stream, not here). Shown above the bubble in a collapsed card.
const reasoning = computed(() =>
  isAssistant.value && !props.plain ? (props.message.reasoning ?? null) : null,
)
const hasReasoning = computed(() => !!reasoning.value?.trim())

// An assistant turn that only requested tools is persisted with empty content
// (the tool cards that follow carry the substance). Don't render an empty
// bubble for it. The still-streaming bubble (plain) is always shown by the
// page only when it has text, so it's exempt. A reasoning-only turn still
// renders (its card), just without an empty text bubble.
const hideBubble = computed(
  () => isAssistant.value && !props.plain && !props.message.content.trim(),
)

const timestamp = computed(() => {
  if (props.message.ts == null) return ''
  return new Date(props.message.ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
})

// Inline edit state. The draft is seeded from the current content each time
// the user opens the editor, so Cancel always restores the original.
const editing = ref(false)
const draft = ref('')

function startEdit() {
  draft.value = props.message.content
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

function confirmEdit() {
  const text = draft.value.trim()
  // Mirror the backend's min_length=1 guard — don't fire a no-op regenerate.
  if (!text) return
  editing.value = false
  emit('edit', text)
}
</script>

<template>
  <div
    v-if="!hideBubble || hasReasoning"
    class="flex w-full flex-col"
    :class="isUser ? 'items-end' : 'items-start'"
  >
    <!-- Reasoning card (assistant turns where the provider exposed thinking).
         Rendered before the answer so it reads as "thought, then replied". -->
    <ChatReasoningCard v-if="hasReasoning" :content="reasoning!" class="mb-2" />

    <!-- Tool turn: render a structured card instead of a text bubble. -->
    <template v-if="isTool && toolCall">
      <ChatToolCallCard :tool-call="toolCall" />
      <span
        v-if="timestamp"
        class="message-ts mt-1 px-1 text-[10px] text-muted-foreground"
      >
        {{ timestamp }}
      </span>
    </template>

    <!-- Inline editor (user turns only) -->
    <div v-if="editing" class="flex w-full max-w-[80%] flex-col gap-1">
      <textarea
        v-model="draft"
        rows="3"
        class="w-full resize-y rounded-2xl border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        :aria-label="$t('components.chatMessage.edit.aria')"
        @keydown.escape="cancelEdit"
      />
      <p class="text-xs text-muted-foreground">
        {{ $t('components.chatMessage.edit.hint') }}
      </p>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          @click="cancelEdit"
        >
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!draft.trim()"
          @click="confirmEdit"
        >
          {{ $t('components.chatMessage.edit.saveAndRegen') }}
        </button>
      </div>
    </div>

    <template v-else-if="!(isTool && toolCall) && !hideBubble">
      <div
        class="max-w-[80%] rounded-2xl px-4 py-2 text-sm break-words"
        :class="{
          'bg-primary text-primary-foreground whitespace-pre-wrap': isUser,
          'bg-muted text-foreground': isAssistant,
          'whitespace-pre-wrap': isAssistant && !renderMarkdown,
          'border border-dashed bg-background text-muted-foreground font-mono text-xs whitespace-pre-wrap': isTool,
        }"
      >
        <span v-if="isTool" class="text-xs uppercase tracking-wider opacity-60 mr-2">
          tool
        </span>
        <ChatRenderedMarkdown v-if="renderMarkdown" :content="message.content" />
        <template v-else>{{ message.content }}</template>
      </div>
      <!-- Attachment chips on a user turn, under the bubble. -->
      <div
        v-if="isUser && attachments.length"
        class="mt-1 flex max-w-[80%] flex-wrap justify-end gap-1.5"
      >
        <ChatAttachmentChip
          v-for="a in attachments"
          :key="a.id"
          :filename="a.filename"
          :content-type="a.content_type"
          :size="a.size"
        />
      </div>
      <span
        v-if="timestamp"
        class="message-ts mt-1 px-1 text-[10px] text-muted-foreground"
      >
        {{ timestamp }}
      </span>
      <button
        v-if="canRetry"
        type="button"
        class="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="retryDisabled"
        :aria-label="$t('components.chatMessage.retry.aria')"
        @click="emit('retry')"
      >
        <RotateCcw class="size-3" />
        {{ $t('components.chatMessage.retry.label') }}
      </button>
      <button
        v-if="canEdit"
        type="button"
        class="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="editDisabled"
        :aria-label="$t('components.chatMessage.edit.aria')"
        @click="startEdit"
      >
        <Pencil class="size-3" />
        {{ $t('common.edit') }}
      </button>
    </template>
  </div>
</template>
