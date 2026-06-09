<script setup lang="ts">
import { FileText, Image as ImageIcon, File as FileIcon, X } from 'lucide-vue-next'

const props = defineProps<{
  filename: string
  contentType: string
  size: number
  // When true, show a remove button (composer preview before send).
  removable?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()

const isImage = computed(() => props.contentType.startsWith('image/'))
const isText = computed(
  () => props.contentType.startsWith('text/') || props.contentType === 'application/json',
)
const icon = computed(() => (isImage.value ? ImageIcon : isText.value ? FileText : FileIcon))

const humanSize = computed(() => {
  const b = props.size
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
})
</script>

<template>
  <span
    class="inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
    :title="`${filename} (${humanSize})`"
  >
    <component :is="icon" class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="truncate text-foreground">{{ filename }}</span>
    <span class="shrink-0 text-muted-foreground">{{ humanSize }}</span>
    <button
      v-if="removable"
      type="button"
      class="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive"
      :aria-label="`${filename} ${$t('components.attachmentChip.removeSuffix')}`"
      @click="emit('remove')"
    >
      <X class="size-3" />
    </button>
  </span>
</template>
