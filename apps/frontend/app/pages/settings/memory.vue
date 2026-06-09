<script setup lang="ts">
import {
  Brain,
  Check,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-vue-next'
import type { Note, NoteCreate, NoteUpdate } from '~/types/api'

// Plan 15 — /settings/memory in the Hermes WebUI memory-panel layout:
// a left sidebar listing every note (search + "+ New"), a right main
// view that shows the selected note rendered as markdown (read mode)
// or its editable form (edit mode). The same three header actions —
// Edit / Cancel / Save (+ Delete) — mirror Hermes WebUI's main-view-
// header convention.

const api = useApi()
const { confirm } = useConfirm()
const { t } = useI18n()

type Mode = 'empty' | 'read' | 'edit'

const notes = ref<Note[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const selectedKey = ref<string | null>(null)
const mode = ref<Mode>('empty')

// Debounced FTS5 search via the new `?q=` query param.
const search = ref('')
const debouncedSearch = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (next) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedSearch.value = next
  }, 200)
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
watch(debouncedSearch, () => load(), { immediate: false })

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const trimmed = debouncedSearch.value.trim()
    notes.value = await api.get<Note[]>(
      '/api/notes',
      trimmed ? { q: trimmed } : undefined,
    )
    // If the current selection was filtered out (search no-match, deleted
    // elsewhere, …) drop back to the empty state — leaving the detail
    // pane "headless" with action buttons still attached is jarring.
    if (
      mode.value !== 'edit' &&
      selectedKey.value &&
      !notes.value.some((n) => n.key === selectedKey.value)
    ) {
      selectedKey.value = null
      mode.value = 'empty'
    }
  } catch (err: unknown) {
    loadError.value =
      err instanceof Error ? err.message : t('pages.memory.errors.load')
  } finally {
    loading.value = false
  }
}

const selectedNote = computed<Note | null>(() => {
  if (!selectedKey.value) return null
  return notes.value.find((n) => n.key === selectedKey.value) ?? null
})

function selectNote(note: Note) {
  selectedKey.value = note.key
  formError.value = null
  isCreating.value = false
  mode.value = 'read'
}

// ── Form state (covers both create and edit) ────────────────────────
const isCreating = ref(false)
const formKey = ref('')
const formContent = ref('')
const formTags = ref('')
const formError = ref<string | null>(null)
const saving = ref(false)

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

function openCreate() {
  isCreating.value = true
  selectedKey.value = null
  formKey.value = ''
  formContent.value = ''
  formTags.value = ''
  formError.value = null
  mode.value = 'edit'
}

function openEdit() {
  const note = selectedNote.value
  if (!note) return
  isCreating.value = false
  formKey.value = note.key
  formContent.value = note.content
  formTags.value = note.tags ?? ''
  formError.value = null
  mode.value = 'edit'
}

function cancelEdit() {
  formError.value = null
  if (isCreating.value) {
    isCreating.value = false
    mode.value = 'empty'
    return
  }
  // If the original note has since been filtered out (search reload
  // landed while we were editing) there's nothing to fall back to —
  // drop the stale selection and go to empty rather than rendering a
  // headless read pane.
  if (selectedNote.value) {
    mode.value = 'read'
  } else {
    selectedKey.value = null
    mode.value = 'empty'
  }
}

async function save() {
  const content = formContent.value
  if (!content.trim()) {
    formError.value = t('pages.memory.form.contentRequired')
    return
  }
  saving.value = true
  formError.value = null
  try {
    if (isCreating.value) {
      const key = formKey.value.trim()
      if (!key) {
        formError.value = t('pages.memory.form.keyRequired')
        return
      }
      const body: NoteCreate = {
        key,
        content,
        tags: parseTags(formTags.value),
      }
      await api.post('/api/notes', body)
      isCreating.value = false
      selectedKey.value = key
    } else {
      const note = selectedNote.value
      if (!note) return
      const body: NoteUpdate = {
        content,
        tags: parseTags(formTags.value),
      }
      await api.put(`/api/notes/${encodeURIComponent(note.key)}`, body)
    }
    await load()
    mode.value = 'read'
  } catch (err: unknown) {
    formError.value =
      err instanceof Error ? err.message : t('pages.memory.errors.save')
  } finally {
    saving.value = false
  }
}

async function remove() {
  const note = selectedNote.value
  if (!note) return
  const ok = await confirm({
    title: t('pages.memory.deleteConfirm.title'),
    description: t('pages.memory.deleteConfirm.description', { key: note.key }),
    destructive: true,
  })
  if (!ok) return
  try {
    await api.delete(`/api/notes/${encodeURIComponent(note.key)}`)
    selectedKey.value = null
    mode.value = 'empty'
    await load()
  } catch (err: unknown) {
    loadError.value =
      err instanceof Error ? err.message : t('pages.memory.errors.delete')
  }
}

// ── Display helpers ─────────────────────────────────────────────────
function tagList(raw: string | null): string[] {
  return raw ? parseTags(raw) : []
}

function formatTimestamp(updatedAt: number): string {
  return new Date(updatedAt * 1000).toLocaleString()
}

function previewLine(content: string): string {
  const first = content.split('\n').find((l) => l.trim().length > 0) ?? ''
  return first.length > 80 ? `${first.slice(0, 77)}…` : first
}

onMounted(load)
</script>

<template>
  <div class="flex h-[calc(100vh-9rem)] gap-4">
    <!-- ── Left sidebar: list ──────────────────────────────────── -->
    <aside class="flex w-72 shrink-0 flex-col rounded-md border">
      <header class="flex items-center justify-between gap-2 border-b p-3">
        <div class="flex items-center gap-2">
          <Brain class="size-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold">{{ $t('pages.memory.sidebarTitle') }}</h2>
        </div>
        <UiButton
          size="sm"
          variant="ghost"
          :aria-label="$t('pages.memory.newNote')"
          @click="openCreate"
        >
          <Plus class="size-4" />
        </UiButton>
      </header>

      <div class="relative border-b p-2">
        <Search
          class="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <UiInput
          v-model="search"
          :placeholder="$t('pages.memory.searchPlaceholder')"
          class="h-8 pl-7 text-sm"
          :aria-label="$t('pages.memory.searchAria')"
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <p
          v-if="loading"
          class="p-3 text-xs text-muted-foreground"
        >
          {{ $t('common.loading') }}
        </p>
        <p
          v-else-if="loadError"
          class="p-3 text-xs text-destructive"
        >
          {{ loadError }}
        </p>
        <p
          v-else-if="notes.length === 0"
          class="p-3 text-xs text-muted-foreground"
        >
          <template v-if="debouncedSearch.trim()">
            {{ $t('pages.memory.noMatch', { query: debouncedSearch }) }}
          </template>
          <template v-else>
            {{ $t('pages.memory.empty') }}
          </template>
        </p>
        <ul v-else class="flex flex-col">
          <li
            v-for="note in notes"
            :key="note.id"
          >
            <button
              type="button"
              :data-testid="`memory-item-${note.key}`"
              class="w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              :class="
                selectedKey === note.key && mode !== 'edit'
                  ? 'bg-muted'
                  : ''
              "
              @click="selectNote(note)"
            >
              <code class="block break-all font-mono text-xs font-medium">{{ note.key }}</code>
              <p
                v-if="previewLine(note.content)"
                class="mt-1 line-clamp-1 text-xs text-muted-foreground"
              >
                {{ previewLine(note.content) }}
              </p>
              <div
                v-if="tagList(note.tags).length"
                class="mt-1 flex flex-wrap gap-1"
              >
                <span
                  v-for="tag in tagList(note.tags)"
                  :key="tag"
                  class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {{ tag }}
                </span>
              </div>
            </button>
          </li>
        </ul>
      </div>
    </aside>

    <!-- ── Right main view: detail ──────────────────────────────── -->
    <section class="flex min-w-0 flex-1 flex-col rounded-md border">
      <!-- Header with title + actions -->
      <header
        class="flex items-center justify-between gap-2 border-b p-3"
        data-testid="memory-detail-header"
      >
        <div class="min-w-0 flex-1">
          <template v-if="mode === 'empty'">
            <h2 class="text-sm font-semibold text-muted-foreground">
              {{ $t('pages.memory.detailEmptyTitle') }}
            </h2>
          </template>
          <template v-else-if="mode === 'edit' && isCreating">
            <h2 class="text-sm font-semibold">{{ $t('pages.memory.newNote') }}</h2>
          </template>
          <template v-else-if="selectedNote">
            <code
              class="block truncate font-mono text-sm font-semibold"
              data-testid="memory-detail-title"
            >{{ selectedNote.key }}</code>
            <p class="text-xs text-muted-foreground">
              {{ formatTimestamp(selectedNote.updated_at) }}
            </p>
          </template>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <template v-if="mode === 'read'">
            <UiButton
              size="sm"
              variant="ghost"
              :aria-label="$t('common.edit')"
              @click="openEdit"
            >
              <Pencil class="size-4" />
            </UiButton>
            <UiButton
              size="sm"
              variant="ghost"
              :aria-label="$t('common.delete')"
              @click="remove"
            >
              <Trash2 class="size-4" />
            </UiButton>
          </template>
          <template v-else-if="mode === 'edit'">
            <UiButton
              size="sm"
              variant="ghost"
              :aria-label="$t('common.cancel')"
              @click="cancelEdit"
            >
              <X class="size-4" />
            </UiButton>
            <UiButton
              size="sm"
              :aria-label="$t('common.save')"
              :disabled="saving"
              @click="save"
            >
              <Check class="size-4" />
            </UiButton>
          </template>
        </div>
      </header>

      <!-- Body -->
      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <!-- Empty state -->
        <div
          v-if="mode === 'empty'"
          class="flex h-full flex-col items-center justify-center text-center text-muted-foreground"
        >
          <Brain class="mb-3 size-12 stroke-[1.25]" />
          <p class="text-sm font-medium">{{ $t('pages.memory.emptyTitle') }}</p>
          <p class="mt-1 text-xs">
            {{ $t('pages.memory.emptyHint') }}
          </p>
        </div>

        <!-- Read mode -->
        <div v-else-if="mode === 'read' && selectedNote" class="flex flex-col gap-4">
          <ChatRenderedMarkdown
            :content="selectedNote.content"
            data-testid="memory-detail-body"
          />
          <div
            v-if="tagList(selectedNote.tags).length"
            class="flex flex-wrap gap-1.5 border-t pt-3"
          >
            <span
              v-for="tag in tagList(selectedNote.tags)"
              :key="tag"
              class="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {{ tag }}
            </span>
          </div>
        </div>

        <!-- Edit mode -->
        <form
          v-else-if="mode === 'edit'"
          class="flex flex-col gap-3"
          data-testid="memory-edit-form"
          @submit.prevent="save"
        >
          <div class="flex flex-col gap-1">
            <label for="memoryKey" class="text-xs font-medium text-muted-foreground">
              {{ $t('pages.memory.form.key') }}
            </label>
            <UiInput
              id="memoryKey"
              v-model="formKey"
              :readonly="!isCreating"
              :disabled="!isCreating"
              :placeholder="$t('pages.memory.form.keyPlaceholder')"
              class="font-mono text-sm"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="memoryContent" class="text-xs font-medium text-muted-foreground">
              {{ $t('pages.memory.form.content') }}
            </label>
            <UiTextarea
              id="memoryContent"
              v-model="formContent"
              class="min-h-80 font-mono text-sm"
              spellcheck="false"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="memoryTags" class="text-xs font-medium text-muted-foreground">
              {{ $t('pages.memory.form.tags') }}
            </label>
            <UiInput
              id="memoryTags"
              v-model="formTags"
              :placeholder="$t('pages.memory.form.tagsPlaceholder')"
            />
          </div>
          <p v-if="formError" class="text-sm text-destructive">{{ formError }}</p>
        </form>
      </div>
    </section>
  </div>
</template>
