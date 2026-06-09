<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import {
  Check,
  MessageSquarePlus,
  Pencil,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-vue-next'
import type { Conversation } from '~/types/api'

const { confirm } = useConfirm()
const { t } = useI18n({ useScope: 'global' })

const props = defineProps<{
  conversations: Conversation[]
  activeId: number | null
}>()

const emit = defineEmits<{
  select: [id: number]
  'new-chat': []
  'toggle-bookmark': [id: number]
  rename: [id: number, title: string]
  delete: [id: number]
  search: [query: string]
}>()

const TTL_SOON_SECONDS = 7 * 24 * 60 * 60

const editingId = ref<number | null>(null)
const editingTitle = ref('')

const searchQuery = ref('')
// 250 ms debounce — long enough that typing "refactor" doesn't fire eight
// requests, short enough that the user sees results before reading them.
const debouncedQuery = refDebounced(searchQuery, 250)
watch(debouncedQuery, (q) => {
  emit('search', q.trim())
})

function clearSearch() {
  searchQuery.value = ''
}

function fmt(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function displayTitle(c: Conversation): string {
  return c.title || `${c.channel} #${c.id}`
}

function expiresHint(c: Conversation): string | null {
  if (c.bookmarked) return null
  if (c.expires_at == null) return null
  // Recomputed on each re-render (triggered by conversation updates);
  // sufficient for a 7-day window hint without a wall-clock timer.
  const remaining = c.expires_at - Math.floor(Date.now() / 1000)
  if (remaining > TTL_SOON_SECONDS) return null
  if (remaining <= 0) return t('components.conversationList.expiresSoon')
  const days = Math.max(1, Math.ceil(remaining / 86_400))
  return t('components.conversationList.expiresInDays', { days })
}

function onBookmarkClick(event: MouseEvent, id: number) {
  event.stopPropagation()
  emit('toggle-bookmark', id)
}

function onRowKeydown(event: KeyboardEvent, id: number) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('select', id)
  }
}

function startRename(event: MouseEvent, c: Conversation) {
  event.stopPropagation()
  editingId.value = c.id
  editingTitle.value = displayTitle(c)
}

function cancelRename() {
  editingId.value = null
  editingTitle.value = ''
}

function submitRename(c: Conversation) {
  const title = editingTitle.value.trim()
  if (!title || title === displayTitle(c)) {
    cancelRename()
    return
  }
  emit('rename', c.id, title)
  cancelRename()
}

async function confirmDelete(event: MouseEvent, c: Conversation) {
  event.stopPropagation()
  const ok = await confirm({
    title: t('components.conversationList.deleteConfirm.title'),
    description: t('components.conversationList.deleteConfirm.description', {
      title: displayTitle(c),
    }),
    destructive: true,
  })
  if (!ok) return
  if (editingId.value === c.id) {
    cancelRename()
  }
  emit('delete', c.id)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between border-b p-3">
      <h2 class="text-sm font-semibold">{{ $t('components.conversationList.title') }}</h2>
      <UiButton size="sm" variant="ghost" @click="emit('new-chat')">
        <MessageSquarePlus class="mr-1 size-4" />
        {{ $t('components.conversationList.new') }}
      </UiButton>
    </div>
    <div class="border-b p-2">
      <div class="relative">
        <Search
          class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <UiInput
          v-model="searchQuery"
          type="search"
          :placeholder="$t('components.conversationList.searchPlaceholder')"
          :aria-label="$t('components.conversationList.searchAria')"
          class="h-8 pl-7 pr-7 text-sm"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          :aria-label="$t('components.conversationList.clearSearch')"
          @click="clearSearch"
        >
          <X class="size-3.5" />
        </button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-2 space-y-1">
      <p
        v-if="props.conversations.length === 0"
        class="px-2 py-4 text-center text-sm text-muted-foreground"
      >
        {{ searchQuery ? $t('components.conversationList.empty.noMatches') : $t('components.conversationList.empty.none') }}
      </p>
      <div
        v-for="c in props.conversations"
        :key="c.id"
        class="group rounded-md text-sm transition-colors"
        :class="
          c.id === props.activeId
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-muted'
        "
      >
        <form
          v-if="editingId === c.id"
          class="flex items-center gap-1 p-2"
          @submit.prevent="submitRename(c)"
        >
          <UiInput
            v-model="editingTitle"
            class="h-8 flex-1"
            :aria-label="$t('components.conversationList.rename.titleAria')"
            autofocus
            @keydown.esc.prevent="cancelRename"
          />
          <UiButton
            type="submit"
            size="icon"
            variant="ghost"
            class="size-8"
            :aria-label="$t('components.conversationList.rename.saveAria')"
          >
            <Check class="size-4" />
          </UiButton>
          <UiButton
            type="button"
            size="icon"
            variant="ghost"
            class="size-8"
            :aria-label="$t('components.conversationList.rename.cancelAria')"
            @click="cancelRename"
          >
            <X class="size-4" />
          </UiButton>
        </form>
        <div
          v-else
          role="button"
          tabindex="0"
          class="block w-full cursor-pointer rounded-md px-3 py-2 text-left"
          @click="emit('select', c.id)"
          @keydown="onRowKeydown($event, c.id)"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="truncate font-medium">
              {{ displayTitle(c) }}
            </span>
            <span class="shrink-0 text-xs text-muted-foreground">
              {{ fmt(c.updated_at) }}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <button
              type="button"
              class="rounded p-0.5 transition-colors hover:bg-background hover:text-foreground"
              :class="c.bookmarked ? 'text-amber-500' : 'text-muted-foreground'"
              :aria-label="c.bookmarked ? $t('components.conversationList.bookmark.remove') : $t('components.conversationList.bookmark.add')"
              :title="c.bookmarked ? $t('components.conversationList.bookmark.remove') : $t('components.conversationList.bookmark.add')"
              @click="onBookmarkClick($event, c.id)"
            >
              <Star
                class="size-3.5"
                :class="c.bookmarked ? 'fill-current' : ''"
              />
            </button>
            <span class="rounded bg-secondary px-1.5 py-0.5">{{ c.channel }}</span>
            <span v-if="c.message_count !== undefined">
              {{ c.message_count }} {{ $t('components.conversationList.msgSuffix') }}
            </span>
            <span
              v-if="expiresHint(c)"
              class="text-amber-600 dark:text-amber-400"
            >
              {{ expiresHint(c) }}
            </span>
            <div
              class="ml-auto flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <UiButton
                variant="ghost"
                size="icon"
                :aria-label="$t('components.conversationList.row.renameAria', { title: displayTitle(c) })"
                @click="startRename($event, c)"
              >
                <Pencil class="size-4" />
              </UiButton>
              <UiButton
                variant="ghost"
                size="icon"
                class="text-destructive hover:text-destructive"
                :aria-label="$t('components.conversationList.row.deleteAria', { title: displayTitle(c) })"
                @click="confirmDelete($event, c)"
              >
                <Trash2 class="size-4" />
              </UiButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
