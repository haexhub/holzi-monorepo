<script setup lang="ts">
import { Paperclip, Send, Square, X } from 'lucide-vue-next'
import { useDropZone } from '@vueuse/core'
import type Textarea from '~/components/ui/textarea/index.vue'
import type { ModelEntry, Persona } from '~/types/api'

interface Skill { slug: string; name: string }

const props = defineProps<{
  streaming?: boolean
  canStop?: boolean
  personaName?: string | null
  model?: string
  personas?: Persona[]
  models?: ModelEntry[]
  skills?: Skill[]
  override?: { model?: string; personaId?: number; thinkingBudget?: 'low' | 'medium' | 'high' } | null
  skillHints?: string[]
}>()

const emit = defineEmits<{
  send: [payload: { text: string; files: File[] }]
  stop: []
  'update:override': [value: typeof props.override]
  'update:skillHints': [value: string[]]
  'clear-conversation': []
}>()

// Accept the same set the backend allows (text/code/markdown/log + images +
// PDF). This is a UX hint only — the backend re-validates type and size.
const ACCEPT =
  '.txt,.md,.markdown,.log,.json,.yaml,.yml,.csv,.xml,.toml,.ini,.sh,.sql,' +
  '.py,.js,.ts,.tsx,.vue,.css,.html,.rs,.go,.java,.c,.h,.cpp,' +
  'text/*,image/png,image/jpeg,image/gif,image/webp,application/pdf'

const MAX_LINES = 10

const draft = ref('')
const files = ref<File[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const composerEl = ref<HTMLFormElement | null>(null)
const textareaRef = ref<InstanceType<typeof Textarea> | null>(null)

function autoResize() {
  const el = textareaRef.value?.el
  if (!el) return
  el.style.height = 'auto'
  const cs = window.getComputedStyle(el)
  const lineHeight = parseFloat(cs.lineHeight) || 20
  const paddingTop = parseFloat(cs.paddingTop) || 0
  const paddingBottom = parseFloat(cs.paddingBottom) || 0
  const borderTop = parseFloat(cs.borderTopWidth) || 0
  const borderBottom = parseFloat(cs.borderBottomWidth) || 0
  const max = lineHeight * MAX_LINES + paddingTop + paddingBottom + borderTop + borderBottom
  el.style.height = `${Math.min(el.scrollHeight, max)}px`
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
}

watch(draft, () => {
  nextTick(autoResize)
})

onMounted(() => {
  nextTick(autoResize)
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(() => nextTick(autoResize))
  }
})

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) {
    attachFiles(Array.from(input.files))
  }
  input.value = ''
}

function attachFiles(picked: File[]) {
  if (!picked.length) return
  files.value = [...files.value, ...picked]
}

function removeFile(index: number) {
  files.value = files.value.filter((_, i) => i !== index)
}

function submit() {
  const text = draft.value.trim()
  if (!text) return
  emit('send', { text, files: files.value })
  draft.value = ''
  files.value = []
  nextTick(autoResize)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
}

const { isOverDropZone } = useDropZone(composerEl, {
  onDrop: (dropped) => {
    if (props.streaming) return
    if (dropped && dropped.length) attachFiles(dropped)
  },
})
const isDragOver = computed(() => !props.streaming && isOverDropZone.value)

const hasOverride = computed(
  () => !!props.override && Object.keys(props.override).length > 0,
)
</script>

<template>
  <form
    ref="composerEl"
    class="relative flex flex-col gap-1.5 border-t bg-background px-3 pb-3 pt-2"
    @submit.prevent="submit"
  >
    <div
      v-if="isDragOver"
      data-testid="composer-dropzone"
      class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary/70 bg-primary/10 text-sm font-medium text-primary"
    >
      {{ $t('components.chatComposer.dropHere') }}
    </div>

    <!-- Pending attachments -->
    <div v-if="files.length" class="flex flex-wrap gap-1.5 pt-1">
      <ChatAttachmentChip
        v-for="(f, i) in files"
        :key="`${f.name}-${i}`"
        :filename="f.name"
        :content-type="f.type || 'application/octet-stream'"
        :size="f.size"
        removable
        @remove="removeFile(i)"
      />
    </div>

    <!-- Full-width textarea -->
    <UiTextarea
      ref="textareaRef"
      v-model="draft"
      :rows="1"
      :placeholder="streaming
        ? $t('components.chatComposer.placeholder.queue')
        : $t('components.chatComposer.placeholder.default')"
      class="min-h-11 w-full resize-none overflow-hidden"
      @keydown="onKeydown"
    />

    <!-- Toolbar row -->
    <div class="flex items-center gap-1">
      <!-- Hidden file input -->
      <input
        ref="fileInput"
        type="file"
        multiple
        :accept="ACCEPT"
        class="hidden"
        @change="onPick"
      />

      <!-- Attach -->
      <button
        type="button"
        class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :aria-label="$t('components.chatComposer.attachAria')"
        @click="fileInput?.click()"
      >
        <Paperclip class="size-4" />
      </button>

      <!-- Command picker -->
      <ChatCommandPicker
        :personas="personas ?? []"
        :models="models ?? []"
        :default-model="model ?? ''"
        :skills="skills ?? []"
        :override="override ?? null"
        :skill-hints="skillHints ?? []"
        @update:override="emit('update:override', $event)"
        @update:skill-hints="emit('update:skillHints', $event)"
        @clear-conversation="emit('clear-conversation')"
      />

      <!-- Active override indicator -->
      <div
        v-if="hasOverride"
        class="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs text-primary"
      >
        <span class="max-w-48 truncate font-mono">
          {{ override?.model ?? (personaName ?? '—') }}
        </span>
        <button
          type="button"
          class="ml-0.5 rounded-full text-primary/70 hover:text-primary"
          :aria-label="$t('components.chatHub.composerToolbar.clearOverride')"
          @click.stop="emit('update:override', null)"
        >
          <X class="size-3" />
        </button>
      </div>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Stop -->
      <button
        v-if="streaming"
        type="button"
        class="inline-flex size-8 items-center justify-center rounded-md bg-destructive text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        :disabled="!canStop"
        :title="canStop ? $t('components.chatComposer.stop.ready') : $t('components.chatComposer.stop.preparing')"
        :aria-label="$t('components.chatComposer.stop.ready')"
        @click="emit('stop')"
      >
        <Square class="size-4 fill-current" />
      </button>

      <!-- Send -->
      <button
        type="submit"
        class="inline-flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        :disabled="!draft.trim()"
        :title="streaming ? $t('components.chatComposer.send.queue') : $t('components.chatComposer.send.now')"
      >
        <Send class="size-4" />
      </button>
    </div>
  </form>
</template>
