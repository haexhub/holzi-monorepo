<script setup lang="ts">
import {
  Check,
  FolderTree,
  GitBranch,
  HardDrive,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-vue-next'
import type {
  SandboxStatusResponse,
  Workspace,
  WorkspaceCreate,
  WorkspaceRename,
  WorkspaceSandboxState,
} from '~/types/api'

// Plan 25 — Control-Center Workspaces page.
//
// Layout mirrors `/settings/memory` and `/settings/tasks` so the three
// shipped two-pane sections look consistent: a left list (one row per
// workspace, status dot + dirty badge + disk hint), a right detail
// pane (rename / archive / restart / disk-usage bar). The page never
// auto-creates sandboxes — it consumes whatever `GET /api/workspaces`
// returns, including `sandbox.state === 'absent'` for workspaces no
// chat has touched yet.

const api = useApi()
const { confirm } = useConfirm()
const { prompt } = usePromptDialog()
const toast = useToast()
const { t } = useI18n()

type Mode = 'empty' | 'detail'

const workspaces = ref<Workspace[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const selectedId = ref<string | null>(null)
const mode = ref<Mode>('empty')

// Per-row pending state for sandbox-restart so the UI can disable the
// button without lying about *which* row is in flight.
const restartingId = ref<string | null>(null)

// Rename form state.
const renaming = ref(false)
const renameDraft = ref('')
const renameSaving = ref(false)
const renameError = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    workspaces.value = await api.get<Workspace[]>('/api/workspaces')
    // If the current selection vanished (archived elsewhere or removed
    // by another client) fall back to empty rather than leaving the
    // detail pane "headless".
    if (
      selectedId.value &&
      !workspaces.value.some((w) => w.id === selectedId.value)
    ) {
      selectedId.value = null
      mode.value = 'empty'
    }
  } catch (err: unknown) {
    loadError.value =
      err instanceof Error ? err.message : t('pages.workspaces.errors.load')
  } finally {
    loading.value = false
  }
}

const selected = computed<Workspace | null>(() => {
  if (!selectedId.value) return null
  return workspaces.value.find((w) => w.id === selectedId.value) ?? null
})

function selectWorkspace(ws: Workspace) {
  selectedId.value = ws.id
  renaming.value = false
  renameError.value = null
  mode.value = 'detail'
}

// ── Create ────────────────────────────────────────────────────────────
async function openCreate() {
  const slug = await prompt({
    title: t('pages.workspaces.create.slugTitle'),
    description: t('pages.workspaces.create.slugDescription'),
    placeholder: t('pages.workspaces.create.slugPlaceholder'),
    confirmLabel: t('pages.workspaces.create.slugConfirm'),
  })
  if (!slug) return
  const name = await prompt({
    title: t('pages.workspaces.create.nameTitle'),
    description: t('pages.workspaces.create.nameDescription'),
    placeholder: t('pages.workspaces.create.namePlaceholder'),
    defaultValue: slug,
    confirmLabel: t('pages.workspaces.create.nameConfirm'),
  })
  if (!name) return
  try {
    const body: WorkspaceCreate = { id: slug, display_name: name }
    const created = await api.post<Workspace>('/api/workspaces', body)
    await load()
    selectedId.value = created.id
    mode.value = 'detail'
    toast.success(t('pages.workspaces.create.success', { name: created.display_name }))
  } catch (err: unknown) {
    const detail =
      (err as { data?: { detail?: string } })?.data?.detail ??
      (err instanceof Error ? err.message : t('pages.workspaces.create.error'))
    toast.error(detail)
  }
}

// ── Rename ────────────────────────────────────────────────────────────
function openRename() {
  const ws = selected.value
  if (!ws) return
  renaming.value = true
  renameDraft.value = ws.display_name
  renameError.value = null
}

function cancelRename() {
  renaming.value = false
  renameError.value = null
}

async function saveRename() {
  const ws = selected.value
  if (!ws) return
  const next = renameDraft.value.trim()
  if (!next) {
    renameError.value = t('pages.workspaces.rename.empty')
    return
  }
  if (next === ws.display_name) {
    renaming.value = false
    return
  }
  renameSaving.value = true
  renameError.value = null
  try {
    const body: WorkspaceRename = { display_name: next }
    await api.patch<Workspace>(
      `/api/workspaces/${encodeURIComponent(ws.id)}`,
      body,
    )
    renaming.value = false
    await load()
    toast.success(t('pages.workspaces.rename.success'))
  } catch (err: unknown) {
    renameError.value =
      (err as { data?: { detail?: string } })?.data?.detail ??
      (err instanceof Error ? err.message : t('pages.workspaces.rename.error'))
  } finally {
    renameSaving.value = false
  }
}

// ── Archive (soft-delete) ─────────────────────────────────────────────
async function archive() {
  const ws = selected.value
  if (!ws) return
  const ok = await confirm({
    title: t('pages.workspaces.archive.title'),
    description: t('pages.workspaces.archive.description', { name: ws.display_name }),
    destructive: true,
  })
  if (!ok) return
  try {
    await api.delete(`/api/workspaces/${encodeURIComponent(ws.id)}`)
    selectedId.value = null
    mode.value = 'empty'
    await load()
    toast.success(t('pages.workspaces.archive.success'))
  } catch (err: unknown) {
    const detail =
      (err as { data?: { detail?: string } })?.data?.detail ??
      (err instanceof Error ? err.message : t('pages.workspaces.archive.error'))
    toast.error(detail)
  }
}

// ── Sandbox restart ───────────────────────────────────────────────────
async function restartSandbox(ws: Workspace) {
  if (restartingId.value) return
  restartingId.value = ws.id
  try {
    await api.post<SandboxStatusResponse>(
      `/api/workspaces/${encodeURIComponent(ws.id)}/sandbox/restart`,
    )
    await load()
    toast.success(t('pages.workspaces.restart.success', { name: ws.display_name }))
  } catch (err: unknown) {
    const detail =
      (err as { data?: { detail?: string } })?.data?.detail ??
      (err instanceof Error
        ? err.message
        : t('pages.workspaces.restart.error'))
    toast.error(detail)
  } finally {
    restartingId.value = null
  }
}

// ── Display helpers ───────────────────────────────────────────────────
const SANDBOX_DOT_CLASS: Record<WorkspaceSandboxState, string> = {
  absent: 'bg-muted-foreground/40',
  running: 'bg-green-500',
  exited: 'bg-amber-500',
  crashed: 'bg-destructive',
  oom: 'bg-destructive',
  removed: 'bg-muted-foreground/40',
}

function sandboxLabel(state: WorkspaceSandboxState): string {
  return t(`pages.workspaces.sandbox.states.${state}`)
}

function formatTimestamp(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString()
}

function formatUsedMb(used: number | null | undefined): string {
  if (used == null) return '—'
  if (used < 1024) return `${used} MiB`
  return `${(used / 1024).toFixed(1)} GiB`
}

onMounted(load)
</script>

<template>
  <div class="flex h-[calc(100vh-9rem)] gap-4">
    <!-- ── Left sidebar: workspace list ────────────────────────── -->
    <aside class="flex w-72 shrink-0 flex-col rounded-md border">
      <header class="flex items-center justify-between gap-2 border-b p-3">
        <div class="flex items-center gap-2">
          <FolderTree class="size-4 text-muted-foreground" />
          <h2 class="text-sm font-semibold">{{ $t('pages.workspaces.title') }}</h2>
        </div>
        <UiButton
          size="sm"
          variant="ghost"
          :aria-label="$t('pages.workspaces.createAria')"
          data-testid="workspace-create-button"
          @click="openCreate"
        >
          <Plus class="size-4" />
        </UiButton>
      </header>

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
          v-else-if="workspaces.length === 0"
          class="p-3 text-xs text-muted-foreground"
        >
          {{ $t('pages.workspaces.emptyList') }}
        </p>
        <ul v-else class="flex flex-col">
          <li
            v-for="ws in workspaces"
            :key="ws.id"
          >
            <button
              type="button"
              :data-testid="`workspace-item-${ws.id}`"
              class="flex w-full flex-col gap-1 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              :class="selectedId === ws.id ? 'bg-muted' : ''"
              @click="selectWorkspace(ws)"
            >
              <div class="flex items-center gap-2">
                <span
                  class="size-2 shrink-0 rounded-full"
                  :class="SANDBOX_DOT_CLASS[ws.sandbox.state]"
                  :aria-label="sandboxLabel(ws.sandbox.state)"
                />
                <span class="truncate text-sm font-medium">{{ ws.display_name }}</span>
              </div>
              <code class="block truncate font-mono text-[10px] text-muted-foreground">
                {{ ws.id }}
              </code>
              <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{{ formatUsedMb(ws.disk.used_mb) }}</span>
                <template v-if="ws.git.is_repo">
                  <span aria-hidden="true">·</span>
                  <span class="inline-flex items-center gap-1">
                    <GitBranch class="size-3" />
                    {{ ws.git.branch ?? 'HEAD' }}
                  </span>
                  <span
                    v-if="ws.git.dirty"
                    class="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300"
                  >
                    {{ $t('pages.workspaces.list.dirty') }}
                  </span>
                </template>
              </div>
            </button>
          </li>
        </ul>
      </div>
    </aside>

    <!-- ── Right detail pane ─────────────────────────────────────── -->
    <section class="flex min-w-0 flex-1 flex-col rounded-md border">
      <header
        class="flex items-center justify-between gap-2 border-b p-3"
        data-testid="workspace-detail-header"
      >
        <div class="min-w-0 flex-1">
          <template v-if="mode === 'empty'">
            <h2 class="text-sm font-semibold text-muted-foreground">
              {{ $t('pages.workspaces.detailEmptyTitle') }}
            </h2>
          </template>
          <template v-else-if="selected">
            <h2
              class="truncate text-sm font-semibold"
              data-testid="workspace-detail-title"
            >
              {{ selected.display_name }}
            </h2>
            <code class="block truncate font-mono text-xs text-muted-foreground">
              {{ selected.id }}
            </code>
          </template>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <template v-if="mode === 'detail' && selected && !renaming">
            <UiButton
              size="sm"
              variant="ghost"
              :aria-label="$t('pages.workspaces.restartAria')"
              :disabled="restartingId === selected.id"
              data-testid="workspace-restart-button"
              @click="restartSandbox(selected)"
            >
              <RefreshCw
                class="size-4"
                :class="restartingId === selected.id ? 'animate-spin' : ''"
              />
            </UiButton>
            <UiButton
              size="sm"
              variant="ghost"
              :aria-label="$t('pages.workspaces.renameAria')"
              data-testid="workspace-rename-button"
              @click="openRename"
            >
              <Pencil class="size-4" />
            </UiButton>
            <UiButton
              size="sm"
              variant="ghost"
              :aria-label="$t('pages.workspaces.archiveAria')"
              data-testid="workspace-archive-button"
              @click="archive"
            >
              <Trash2 class="size-4" />
            </UiButton>
          </template>
          <template v-else-if="renaming">
            <UiButton
              size="sm"
              variant="ghost"
              :aria-label="$t('common.cancel')"
              @click="cancelRename"
            >
              <X class="size-4" />
            </UiButton>
            <UiButton
              size="sm"
              :aria-label="$t('common.save')"
              :disabled="renameSaving"
              @click="saveRename"
            >
              <Check class="size-4" />
            </UiButton>
          </template>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <!-- Empty state -->
        <div
          v-if="mode === 'empty'"
          class="flex h-full flex-col items-center justify-center text-center text-muted-foreground"
        >
          <FolderTree class="mb-3 size-12 stroke-[1.25]" />
          <p class="text-sm font-medium">{{ $t('pages.workspaces.emptyTitle') }}</p>
          <p class="mt-1 text-xs">
            {{ $t('pages.workspaces.emptyHint') }}
          </p>
        </div>

        <!-- Detail (rename mode is just an inline form in the same body) -->
        <div
          v-else-if="selected"
          class="flex flex-col gap-6"
        >
          <!-- Inline rename form -->
          <form
            v-if="renaming"
            data-testid="workspace-rename-form"
            class="flex flex-col gap-2"
            @submit.prevent="saveRename"
          >
            <label
              for="workspaceDisplayName"
              class="text-xs font-medium text-muted-foreground"
            >
              {{ $t('pages.workspaces.displayName') }}
            </label>
            <UiInput
              id="workspaceDisplayName"
              v-model="renameDraft"
              :disabled="renameSaving"
              :placeholder="$t('pages.workspaces.displayNamePlaceholder')"
              autofocus
            />
            <p v-if="renameError" class="text-sm text-destructive">
              {{ renameError }}
            </p>
          </form>

          <!-- Sandbox status block -->
          <section class="flex flex-col gap-2">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {{ $t('pages.workspaces.sandbox.heading') }}
            </h3>
            <div class="flex items-center gap-2 text-sm">
              <span
                class="size-2 shrink-0 rounded-full"
                :class="SANDBOX_DOT_CLASS[selected.sandbox.state]"
              />
              <span>{{ sandboxLabel(selected.sandbox.state) }}</span>
              <span
                v-if="selected.sandbox.exit_code != null"
                class="text-xs text-muted-foreground"
              >
                {{ $t('pages.workspaces.sandbox.exit', { code: selected.sandbox.exit_code }) }}
              </span>
            </div>
            <p class="text-xs text-muted-foreground">
              {{ $t('pages.workspaces.sandbox.hint') }}
            </p>
          </section>

          <!-- Disk usage block -->
          <section class="flex flex-col gap-2">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span class="inline-flex items-center gap-1">
                <HardDrive class="size-3" />
                {{ $t('pages.workspaces.disk.heading') }}
              </span>
            </h3>
            <div class="text-sm">
              {{ formatUsedMb(selected.disk.used_mb) }} {{ $t('pages.workspaces.disk.used') }}
              <template v-if="selected.disk.quota_mb != null">
                {{ $t('pages.workspaces.disk.quota', { value: formatUsedMb(selected.disk.quota_mb) }) }}
              </template>
              <span
                v-else
                class="text-xs text-muted-foreground"
              >
                {{ $t('pages.workspaces.disk.noQuota') }}
              </span>
            </div>
            <!-- Pure-CSS usage bar so we don't pull in a chart dep for
              one bar. clamp() keeps the width sane even with bad data. -->
            <div
              v-if="selected.disk.quota_mb != null && (selected.disk.used_mb ?? 0) >= 0"
              class="h-2 w-full overflow-hidden rounded bg-muted"
              aria-hidden="true"
            >
              <div
                class="h-full bg-primary"
                :style="{
                  width: `clamp(0%, ${
                    ((selected.disk.used_mb ?? 0) /
                      Math.max(1, selected.disk.quota_mb)) *
                    100
                  }%, 100%)`,
                }"
              />
            </div>
          </section>

          <!-- Git block -->
          <section class="flex flex-col gap-2">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span class="inline-flex items-center gap-1">
                <GitBranch class="size-3" />
                {{ $t('pages.workspaces.git.heading') }}
              </span>
            </h3>
            <p
              v-if="!selected.git.is_repo"
              class="text-sm text-muted-foreground"
            >
              {{ $t('pages.workspaces.git.notRepo') }}
            </p>
            <div v-else class="flex items-center gap-2 text-sm">
              <span class="font-mono">{{ selected.git.branch ?? 'HEAD (detached)' }}</span>
              <span
                v-if="selected.git.dirty"
                class="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-300"
              >
                {{ $t('pages.workspaces.git.dirty') }}
              </span>
              <span
                v-else
                class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {{ $t('pages.workspaces.git.clean') }}
              </span>
            </div>
          </section>

          <!-- Meta -->
          <section class="flex flex-col gap-1 text-xs text-muted-foreground">
            <div>{{ $t('pages.workspaces.meta.created', { timestamp: formatTimestamp(selected.created_at) }) }}</div>
            <div v-if="selected.archived_at != null">
              {{ $t('pages.workspaces.meta.archived', { timestamp: formatTimestamp(selected.archived_at) }) }}
            </div>
          </section>
        </div>
      </div>
    </section>
  </div>
</template>
