<script setup lang="ts">
import {
  File,
  FileQuestion,
  Folder,
  GitBranch,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-vue-next'
import type {
  TreeEntry,
  Workspace,
  WorkspaceFileResponse,
  WorkspaceGitResponse,
  WorkspaceRenameResponse,
  WorkspaceRoot,
  WorkspaceTreeResponse,
  WorkspaceWriteResponse,
} from '~/types/api'

// Threaded through from index.vue so workspace writes can produce
// `user[conv-N]:` git commits. Null when no conversation is active —
// the panel disables write actions in that case rather than committing
// anonymously. Default `null` lets the panel render in isolation (tests,
// settings-style routes) without forcing every caller to pass it.
const props = withDefaults(
  defineProps<{ conversationId?: number | null }>(),
  { conversationId: null },
)

const api = useApi()
const { confirm } = useConfirm()
const { prompt } = usePromptDialog()
const { t } = useI18n()
const localePath = useLocalePath()

const roots = ref<WorkspaceRoot[]>([])
const selectedRoot = ref<string>('')
const currentPath = ref<string>('')
const entries = ref<TreeEntry[]>([])

const rootsLoading = ref(false)
const treeLoading = ref(false)
const fileLoading = ref(false)

const rootsError = ref<string | null>(null)
const treeError = ref<string | null>(null)
const fileError = ref<string | null>(null)

const selectedFileName = ref<string | null>(null)
const filePreview = ref<WorkspaceFileResponse | null>(null)

const gitStatus = ref<WorkspaceGitResponse | null>(null)
const gitError = ref<string | null>(null)

// `files` shows the tree + preview (Plan 12/13 surface); `git` shows the
// Plan-24 status/diff/commit/branch/push-pull workflow. The Git tab is
// reachable both via the tab strip and by clicking the dirty badge.
const activeTab = ref<'files' | 'git'>('files')

// After a git mutation (stage/commit/checkout/pull/push) the file tree and
// the dirty-badge can both have stale state — reload them in lockstep.
async function onGitChanged() {
  await Promise.all([loadTree(), loadGit()])
}

// Edit-mode state. `editing` toggles preview→textarea; `editingContent`
// holds the in-progress draft so cancel can discard cleanly.
const editing = ref(false)
const editingContent = ref<string>('')
const saveError = ref<string | null>(null)
// Distinct from `saveError`: a successful write that produced no commit
// (root isn't a git repo) is *not* an error, so it gets its own neutral
// banner instead of red-tinting a happy path.
const saveNotice = ref<string | null>(null)
const saving = ref(false)

// Create-file flyout state.
const creating = ref(false)
const createPath = ref<string>('')
const createError = ref<string | null>(null)
const createSaving = ref(false)

// Monotonic seq guards against stale-response races. A user clicking dir A
// then quickly switching to root B would otherwise let A's late response
// overwrite B's state; same shape for file selection. Each fetch captures
// the seq at start and bails on commit if a newer fetch has begun.
let treeSeq = 0
let fileSeq = 0
let gitSeq = 0

function errorStatus(err: unknown): number | null {
  const e = err as { statusCode?: number; status?: number; response?: { status?: number } }
  return e?.statusCode ?? e?.status ?? e?.response?.status ?? null
}

function errorDetail(err: unknown): string | null {
  const e = err as { data?: { detail?: string }; response?: { _data?: { detail?: string } } }
  return e?.data?.detail ?? e?.response?._data?.detail ?? null
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  return fallback
}

// Single source of truth for "stringify the active conversation for a
// `user[conv-N]:` commit". Throws loudly if called without a conversation;
// the UI's `canWrite` gate is supposed to prevent that, so reaching this
// branch means a guard regressed somewhere — better to fail loud than to
// send `"null"` as the conversation id.
function commitConvId(): string {
  const id = props.conversationId
  if (id == null) throw new Error('no active conversation')
  return String(id)
}

function humanSize(bytes: number | null | undefined): string {
  if (bytes == null) return t('components.workspacePanel.sizeUnknown')
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(1)} ${units[i]}`
}

const sortedEntries = computed<TreeEntry[]>(() => {
  const list = [...entries.value]
  list.sort((a, b) => {
    const ad = a.type === 'dir' ? 0 : 1
    const bd = b.type === 'dir' ? 0 : 1
    if (ad !== bd) return ad - bd
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  return list
})

const breadcrumbSegments = computed<string[]>(() => {
  if (!currentPath.value) return []
  return currentPath.value.split('/').filter((s) => s.length > 0)
})

const canWrite = computed<boolean>(() => {
  // Plan 13 contract: every write produces a `user[conv-N]:` commit, so a
  // missing conversation id means the write would have an ambiguous author.
  // Better to disable the action than to commit anonymously.
  return props.conversationId != null
})

const canEditCurrent = computed<boolean>(() => {
  const p = filePreview.value
  if (!p || !canWrite.value) return false
  if (p.kind !== 'text' && p.kind !== 'markdown') return false
  // sha256 absent = file was metadata-only (too large to read fully) — editing
  // it would have no `base_sha` and any save would be unsafe by definition.
  return p.sha256 != null
})

function joinPath(base: string, name: string): string {
  if (!base) return name
  return `${base}/${name}`
}

async function loadRoots() {
  rootsLoading.value = true
  rootsError.value = null
  try {
    // Plan 25: workspaces source-of-truth is the DB-driven `/api/workspaces`
    // endpoint (display_name + sandbox/disk/git aggregate). The panel only
    // needs the slug for tree/file calls, so we project down to the same
    // `WorkspaceRoot` shape the type already commits to.
    const list = await api.get<Workspace[]>('/api/workspaces')
    roots.value = list.map((w) => ({ id: w.id }) as WorkspaceRoot)
    if (roots.value.length > 0) {
      selectedRoot.value = roots.value[0]!.id
      currentPath.value = ''
      void loadTree()
      void loadGit()
    }
  } catch (err: unknown) {
    rootsError.value = errorMessage(err, t('components.workspacePanel.errors.rootsLoad'))
  } finally {
    rootsLoading.value = false
  }
}

async function loadTree() {
  if (!selectedRoot.value) return
  const seq = ++treeSeq
  treeLoading.value = true
  treeError.value = null
  entries.value = []
  try {
    const res = await api.get<WorkspaceTreeResponse>('/api/workspace/tree', {
      root: selectedRoot.value,
      path: currentPath.value,
    })
    if (seq !== treeSeq) return
    entries.value = res.entries
  } catch (err: unknown) {
    if (seq !== treeSeq) return
    const status = errorStatus(err)
    if (status === 503) {
      treeError.value = t('components.workspacePanel.errors.unavailable')
    } else if (status === 404) {
      treeError.value = t('components.workspacePanel.errors.pathNotFound')
    } else if (status === 400) {
      treeError.value = errorDetail(err) ?? t('components.workspacePanel.errors.invalidPath')
    } else {
      treeError.value = errorMessage(err, t('components.workspacePanel.errors.treeLoad'))
    }
  } finally {
    if (seq === treeSeq) treeLoading.value = false
  }
}

async function loadFile(name: string) {
  if (!selectedRoot.value) return
  const seq = ++fileSeq
  fileLoading.value = true
  fileError.value = null
  filePreview.value = null
  selectedFileName.value = name
  // Switching files always exits edit mode — any unsaved draft is dropped.
  // The watcher below also enforces this for breadcrumb/root nav.
  editing.value = false
  editingContent.value = ''
  saveError.value = null
  try {
    const res = await api.get<WorkspaceFileResponse>('/api/workspace/file', {
      root: selectedRoot.value,
      path: joinPath(currentPath.value, name),
    })
    if (seq !== fileSeq) return
    filePreview.value = res
  } catch (err: unknown) {
    if (seq !== fileSeq) return
    const status = errorStatus(err)
    if (status === 503) {
      fileError.value = t('components.workspacePanel.errors.unavailable')
    } else if (status === 404) {
      fileError.value = t('components.workspacePanel.errors.fileNotFound')
    } else if (status === 400) {
      fileError.value = errorDetail(err) ?? t('components.workspacePanel.errors.invalidPath')
    } else {
      fileError.value = errorMessage(err, t('components.workspacePanel.errors.fileLoad'))
    }
  } finally {
    if (seq === fileSeq) fileLoading.value = false
  }
}

async function loadGit() {
  if (!selectedRoot.value) return
  const seq = ++gitSeq
  gitError.value = null
  try {
    const res = await api.get<WorkspaceGitResponse>('/api/workspace/git', {
      root: selectedRoot.value,
    })
    if (seq !== gitSeq) return
    gitStatus.value = res
  } catch (err: unknown) {
    if (seq !== gitSeq) return
    // Git status is best-effort — failures shouldn't block the rest of the
    // panel. We surface the error inline near the badge area but keep the
    // tree + preview functioning.
    const status = errorStatus(err)
    if (status === 503) {
      gitError.value = t('components.workspacePanel.errors.sandboxUnavailable')
    } else {
      gitError.value =
        errorDetail(err) ?? errorMessage(err, t('components.workspacePanel.errors.gitUnavailable'))
    }
    gitStatus.value = null
  }
}

function onEntryClick(entry: TreeEntry) {
  if (entry.type === 'dir') {
    currentPath.value = joinPath(currentPath.value, entry.name)
    selectedFileName.value = null
    filePreview.value = null
    fileError.value = null
    void loadTree()
  } else if (entry.type === 'file') {
    // Clear a stale tree error: if a previous /tree fetch errored but
    // some entries are still visible (e.g. cached list), opening a file
    // shouldn't leave the error message dangling above the new preview.
    treeError.value = null
    void loadFile(entry.name)
  }
}

function navigateBreadcrumb(index: number) {
  if (index < 0) {
    currentPath.value = ''
  } else {
    currentPath.value = breadcrumbSegments.value.slice(0, index + 1).join('/')
  }
  selectedFileName.value = null
  filePreview.value = null
  fileError.value = null
  void loadTree()
}

function onRootChange() {
  currentPath.value = ''
  selectedFileName.value = null
  filePreview.value = null
  fileError.value = null
  gitStatus.value = null
  // Drop the create flyout too — its `createPath` is rooted under the
  // previous workspace's breadcrumb, so leaving it open would invite the
  // user to create a file at the wrong place.
  creating.value = false
  createPath.value = ''
  createError.value = null
  void loadTree()
  void loadGit()
}

async function refresh() {
  await Promise.all([loadTree(), loadGit()])
  if (selectedFileName.value) {
    await loadFile(selectedFileName.value)
  }
}

function startEditing() {
  if (!canEditCurrent.value || !filePreview.value) return
  editing.value = true
  editingContent.value = filePreview.value.content ?? ''
  saveError.value = null
  saveNotice.value = null
}

function cancelEditing() {
  editing.value = false
  editingContent.value = ''
  saveError.value = null
  saveNotice.value = null
}

async function saveEdit() {
  const preview = filePreview.value
  if (!preview || !canWrite.value || preview.sha256 == null) return
  // Capture the workspace context at the moment the user clicked Save —
  // if the user switches root or selects a different file while the PUT
  // is in flight, we must not reload the *new* root's file as if the
  // write happened there.
  const rootAtSave = selectedRoot.value
  const nameAtSave = preview.name
  saving.value = true
  saveError.value = null
  saveNotice.value = null
  try {
    const res = await api.put<WorkspaceWriteResponse>('/api/workspace/file', {
      root: rootAtSave,
      path: preview.path,
      content: editingContent.value,
      base_sha: preview.sha256,
      conversation_id: commitConvId(),
    })
    editing.value = false
    editingContent.value = ''
    if (selectedRoot.value !== rootAtSave) {
      // The user navigated away mid-save; the write succeeded against
      // `rootAtSave` but there's no longer a UI position to surface the
      // refreshed preview in. Just exit edit mode silently.
      return
    }
    // Refresh from server so the new sha + truncation state come from the
    // canonical source rather than a guess. Also refreshes the dirty badge.
    await Promise.all([
      loadFile(nameAtSave),
      loadGit(),
    ])
    if (res.committed === false) {
      // Successful write, just without a commit (root isn't a git repo).
      // A neutral notice — not an error.
      saveNotice.value = t('components.workspacePanel.notices.savedNoCommit')
    }
  } catch (err: unknown) {
    const status = errorStatus(err)
    if (status === 409) {
      saveError.value = t('components.workspacePanel.errors.saveConflict')
    } else if (status === 400) {
      saveError.value = errorDetail(err) ?? t('components.workspacePanel.errors.invalidContent')
    } else if (status === 503) {
      saveError.value = t('components.workspacePanel.errors.workspaceUnavailable')
    } else {
      saveError.value = errorMessage(err, t('components.workspacePanel.errors.saveFailed'))
    }
  } finally {
    saving.value = false
  }
}

function startCreating() {
  if (!canWrite.value) return
  creating.value = true
  createError.value = null
  createPath.value = currentPath.value ? `${currentPath.value}/` : ''
}

function cancelCreating() {
  creating.value = false
  createPath.value = ''
  createError.value = null
}

async function submitCreate() {
  if (!canWrite.value) return
  const path = createPath.value.trim()
  if (!path) {
    createError.value = t('components.workspacePanel.errors.pathEmpty')
    return
  }
  createSaving.value = true
  createError.value = null
  try {
    await api.post<WorkspaceWriteResponse>('/api/workspace/file', {
      root: selectedRoot.value,
      path,
      content: '',
      conversation_id: commitConvId(),
    })
    creating.value = false
    createPath.value = ''
    await Promise.all([loadTree(), loadGit()])
  } catch (err: unknown) {
    const status = errorStatus(err)
    if (status === 409) {
      createError.value = t('components.workspacePanel.errors.pathExists')
    } else if (status === 400) {
      createError.value = errorDetail(err) ?? t('components.workspacePanel.errors.invalidPath')
    } else if (status === 503) {
      createError.value = t('components.workspacePanel.errors.workspaceUnavailable')
    } else {
      createError.value = errorMessage(err, t('components.workspacePanel.errors.createFailed'))
    }
  } finally {
    createSaving.value = false
  }
}

async function renameCurrent() {
  const preview = filePreview.value
  if (!preview || !canWrite.value) return
  const next = await prompt({
    title: t('components.workspacePanel.rename.title'),
    description: t('components.workspacePanel.rename.description'),
    defaultValue: preview.path,
    confirmLabel: t('components.workspacePanel.rename.confirm'),
  })
  if (next == null) return
  const target = next.trim()
  if (!target || target === preview.path) return
  try {
    const res = await api.post<WorkspaceRenameResponse>(
      '/api/workspace/rename',
      {
        root: selectedRoot.value,
        src: preview.path,
        dest: target,
        conversation_id: commitConvId(),
      },
    )
    // After rename, the file lives at a new path; clear selection and
    // navigate to the dest's parent so the user can see the result.
    const lastSlash = res.dest.lastIndexOf('/')
    currentPath.value = lastSlash === -1 ? '' : res.dest.slice(0, lastSlash)
    const newName = lastSlash === -1 ? res.dest : res.dest.slice(lastSlash + 1)
    selectedFileName.value = null
    filePreview.value = null
    await Promise.all([loadTree(), loadGit()])
    await loadFile(newName)
  } catch (err: unknown) {
    const status = errorStatus(err)
    if (status === 409) {
      fileError.value = t('components.workspacePanel.errors.destExists')
    } else if (status === 400) {
      fileError.value = errorDetail(err) ?? t('components.workspacePanel.errors.invalidPath')
    } else if (status === 404) {
      fileError.value = t('components.workspacePanel.errors.fileNotFound')
    } else if (status === 503) {
      fileError.value = t('components.workspacePanel.errors.workspaceUnavailable')
    } else {
      fileError.value = errorMessage(err, t('components.workspacePanel.errors.renameFailed'))
    }
  }
}

async function deleteCurrent() {
  const preview = filePreview.value
  if (!preview || !canWrite.value) return
  // Destructive — always confirm. Plan 13 explicitly calls out "Require
  // confirmations for destructive operations."
  const ok = await confirm({
    title: t('components.workspacePanel.delete.title'),
    description: t('components.workspacePanel.delete.description', { path: preview.path }),
    destructive: true,
  })
  if (!ok) return
  try {
    await api.delete<WorkspaceWriteResponse>('/api/workspace/file', {
      root: selectedRoot.value,
      path: preview.path,
      conversation_id: commitConvId(),
    })
    selectedFileName.value = null
    filePreview.value = null
    fileError.value = null
    await Promise.all([loadTree(), loadGit()])
  } catch (err: unknown) {
    const status = errorStatus(err)
    if (status === 404) {
      fileError.value = t('components.workspacePanel.errors.fileNotFound')
    } else if (status === 400) {
      fileError.value = errorDetail(err) ?? t('components.workspacePanel.errors.invalidPath')
    } else if (status === 503) {
      fileError.value = t('components.workspacePanel.errors.workspaceUnavailable')
    } else {
      fileError.value = errorMessage(err, t('components.workspacePanel.errors.deleteFailed'))
    }
  }
}

// Drop any unsaved edit if the user navigates away (root/breadcrumb/file
// change) OR if the active conversation disappears. The latter matters
// because `canWrite` flips false when conversationId becomes null, which
// would otherwise leave the user in an edit mode whose Save silently
// no-ops at the `canWrite` guard.
watch(
  [selectedRoot, currentPath, selectedFileName, () => props.conversationId],
  () => {
    editing.value = false
    editingContent.value = ''
    saveError.value = null
    saveNotice.value = null
  },
)

onMounted(loadRoots)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between border-b p-3">
      <h3 class="text-sm font-semibold">{{ $t('components.workspacePanel.title') }}</h3>
      <div class="flex items-center gap-1">
        <UiButton
          v-if="roots.length > 0 && canWrite"
          size="sm"
          variant="ghost"
          :disabled="treeLoading || creating"
          :aria-label="$t('components.workspacePanel.newFileAria')"
          @click="startCreating"
        >
          <Plus class="size-3.5" />
        </UiButton>
        <UiButton
          v-if="roots.length > 0"
          size="sm"
          variant="ghost"
          :disabled="treeLoading || fileLoading"
          :aria-label="$t('common.refresh')"
          @click="refresh"
        >
          <RefreshCw
            class="size-3.5"
            :class="treeLoading || fileLoading ? 'animate-spin' : ''"
          />
        </UiButton>
      </div>
    </div>

    <div v-if="rootsLoading" class="p-3 text-sm text-muted-foreground">{{ $t('common.loading') }}</div>
    <div v-else-if="rootsError" class="p-3 text-sm text-destructive">{{ rootsError }}</div>
    <div
      v-else-if="roots.length === 0"
      class="p-3 text-sm text-muted-foreground"
    >
      {{ $t('components.workspacePanel.noWorkspaces') }}
      <NuxtLink
        :to="localePath('/settings/workspaces')"
        class="text-primary underline-offset-2 hover:underline"
      >
        {{ $t('components.workspacePanel.createInControlCenter') }}
      </NuxtLink>.
    </div>

    <template v-else>
      <div class="space-y-2 border-b p-3">
        <select
          v-model="selectedRoot"
          class="w-full rounded-md border bg-background px-2 py-1 text-sm"
          @change="onRootChange"
        >
          <option v-for="r in roots" :key="r.id" :value="r.id">{{ r.id }}</option>
        </select>
        <div
          v-if="gitStatus && gitStatus.is_repo"
          class="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <GitBranch class="size-3" />
          <span class="font-mono">{{ gitStatus.branch ?? '(detached)' }}</span>
          <button
            v-if="gitStatus.dirty"
            type="button"
            class="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-700 hover:bg-amber-500/25 dark:text-amber-300"
            :title="$t('components.workspacePanel.dirtyTitle', { count: gitStatus.entries.length })"
            @click="activeTab = 'git'"
          >{{ $t('components.workspacePanel.dirty') }}</button>
          <span v-else class="text-emerald-700 dark:text-emerald-300">{{ $t('components.workspacePanel.clean') }}</span>
        </div>
        <div v-else-if="gitError" class="text-xs text-muted-foreground">
          {{ gitError }}
        </div>
      </div>

      <!-- Tab strip (Plan 24): Dateien-Browser ↔ Git-Workflow -->
      <div role="tablist" class="flex border-b text-xs font-medium">
        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === 'files'"
          class="flex-1 border-b-2 px-3 py-2 transition-colors"
          :class="
            activeTab === 'files'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'files'"
        >
          {{ $t('components.workspacePanel.tabs.files') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="activeTab === 'git'"
          class="flex-1 border-b-2 px-3 py-2 transition-colors"
          :class="
            activeTab === 'git'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'git'"
        >
          {{ $t('components.workspacePanel.tabs.git') }}
        </button>
      </div>

      <template v-if="activeTab === 'files'">
      <div class="space-y-2 border-b p-3">
        <nav class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <button
            type="button"
            class="rounded px-1 hover:bg-muted hover:text-foreground"
            @click="navigateBreadcrumb(-1)"
          >
            {{ selectedRoot || '/' }}
          </button>
          <template v-for="(seg, i) in breadcrumbSegments" :key="i">
            <span>/</span>
            <button
              type="button"
              class="rounded px-1 hover:bg-muted hover:text-foreground"
              @click="navigateBreadcrumb(i)"
            >
              {{ seg }}
            </button>
          </template>
        </nav>
        <div
          v-if="creating"
          class="rounded-md border bg-muted/30 p-2 text-xs"
        >
          <label class="block">
            <span class="text-muted-foreground">{{ $t('components.workspacePanel.createLabel') }}</span>
            <input
              v-model="createPath"
              type="text"
              class="mt-1 w-full rounded border bg-background px-2 py-1 font-mono"
              :placeholder="$t('components.workspacePanel.createPlaceholder')"
              :disabled="createSaving"
              @keydown.enter.prevent="submitCreate"
              @keydown.esc.prevent="cancelCreating"
            />
          </label>
          <p v-if="createError" class="mt-1 text-destructive">{{ createError }}</p>
          <div class="mt-2 flex justify-end gap-2">
            <UiButton
              size="sm"
              variant="ghost"
              :disabled="createSaving"
              @click="cancelCreating"
            >
              {{ $t('common.cancel') }}
            </UiButton>
            <UiButton size="sm" :disabled="createSaving" @click="submitCreate">
              {{ $t('components.workspacePanel.createSubmit') }}
            </UiButton>
          </div>
        </div>
        <p
          v-if="!canWrite"
          class="text-xs text-muted-foreground"
        >
          {{ $t('components.workspacePanel.noConversation') }}
        </p>
      </div>

      <div class="flex-1 overflow-y-auto border-b">
        <p v-if="treeLoading" class="p-3 text-sm text-muted-foreground">{{ $t('common.loading') }}</p>
        <p v-else-if="treeError" class="p-3 text-sm text-destructive">{{ treeError }}</p>
        <p
          v-else-if="sortedEntries.length === 0"
          class="p-3 text-sm text-muted-foreground"
        >
          {{ $t('components.workspacePanel.emptyFolder') }}
        </p>
        <ul v-else class="divide-y">
          <li
            v-for="entry in sortedEntries"
            :key="entry.name"
            class="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted"
            :class="[
              entry.name.startsWith('.') ? 'opacity-60' : '',
              selectedFileName === entry.name && entry.type === 'file' ? 'bg-accent' : '',
            ]"
            @click="onEntryClick(entry)"
          >
            <Folder v-if="entry.type === 'dir'" class="size-3.5 text-muted-foreground" />
            <File v-else-if="entry.type === 'file'" class="size-3.5 text-muted-foreground" />
            <FileQuestion v-else class="size-3.5 text-muted-foreground" />
            <span class="flex-1 truncate">{{ entry.name }}</span>
            <span v-if="entry.type === 'file'" class="text-xs text-muted-foreground">
              {{ humanSize(entry.size) }}
            </span>
          </li>
        </ul>
      </div>

      <div
        class="flex h-1/2 min-h-[160px] flex-col overflow-hidden"
        aria-live="polite"
      >
        <div v-if="fileLoading" class="p-3 text-sm text-muted-foreground">{{ $t('common.loading') }}</div>
        <div v-else-if="fileError" class="p-3 text-sm text-destructive">{{ fileError }}</div>
        <div
          v-else-if="!filePreview"
          class="p-3 text-sm text-muted-foreground"
        >
          {{ $t('components.workspacePanel.selectFile') }}
        </div>
        <template v-else>
          <div class="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
            <span class="truncate font-mono">{{ filePreview.name }}</span>
            <div class="flex shrink-0 items-center gap-1">
              <span>{{ humanSize(filePreview.size) }}</span>
              <UiButton
                v-if="canEditCurrent && !editing"
                size="sm"
                variant="ghost"
                :aria-label="$t('common.edit')"
                @click="startEditing"
              >
                <Pencil class="size-3.5" />
              </UiButton>
              <UiButton
                v-if="canWrite && !editing"
                size="sm"
                variant="ghost"
                :aria-label="$t('components.workspacePanel.renameAria')"
                @click="renameCurrent"
              >
                <File class="size-3.5" />
              </UiButton>
              <UiButton
                v-if="canWrite && !editing"
                size="sm"
                variant="ghost"
                :aria-label="$t('common.delete')"
                class="text-destructive hover:text-destructive"
                @click="deleteCurrent"
              >
                <Trash2 class="size-3.5" />
              </UiButton>
            </div>
          </div>
          <div
            v-if="filePreview.truncated && !editing"
            class="border-b bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            {{ $t('components.workspacePanel.truncated') }}
          </div>
          <div
            v-if="saveError"
            class="border-b bg-muted px-3 py-1 text-xs text-destructive"
          >
            {{ saveError }}
          </div>
          <div
            v-else-if="saveNotice"
            class="border-b bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            {{ saveNotice }}
          </div>
          <div v-if="editing" class="flex flex-1 flex-col overflow-hidden">
            <textarea
              v-model="editingContent"
              class="flex-1 resize-none border-0 bg-background p-3 font-mono text-xs focus:outline-none"
              :disabled="saving"
              spellcheck="false"
            />
            <div class="flex justify-end gap-2 border-t p-2">
              <UiButton
                size="sm"
                variant="ghost"
                :disabled="saving"
                @click="cancelEditing"
              >
                {{ $t('common.cancel') }}
              </UiButton>
              <UiButton size="sm" :disabled="saving" @click="saveEdit">
                {{ saving ? $t('components.workspacePanel.saving') : $t('common.save') }}
              </UiButton>
            </div>
          </div>
          <div v-else class="flex-1 overflow-auto">
            <pre
              v-if="filePreview.kind === 'text'"
              class="whitespace-pre p-3 font-mono text-xs"
            >{{ filePreview.content }}</pre>
            <div v-else-if="filePreview.kind === 'markdown'" class="p-3">
              <ChatRenderedMarkdown :content="filePreview.content ?? ''" />
            </div>
            <div
              v-else-if="filePreview.kind === 'image' && filePreview.data_url"
              class="flex items-center justify-center p-3"
            >
              <img
                :src="filePreview.data_url"
                :alt="filePreview.name"
                loading="lazy"
                class="max-h-[400px] max-w-full object-contain"
              />
            </div>
            <div v-else class="p-3 text-sm text-muted-foreground">
              <p class="font-mono">{{ filePreview.name }}</p>
              <p class="mt-1">{{ humanSize(filePreview.size) }}</p>
              <p class="mt-2">{{ $t('components.workspacePanel.binaryPreview') }}</p>
            </div>
          </div>
        </template>
      </div>
      </template>

      <template v-else-if="activeTab === 'git'">
        <PanelsWorkspaceGitTab
          :root="selectedRoot"
          :conversation-id="conversationId"
          @changed="onGitChanged"
        />
      </template>
    </template>
  </div>
</template>
