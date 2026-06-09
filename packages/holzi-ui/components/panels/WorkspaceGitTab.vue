<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-vue-next'
import type {
  GitBranchesResponse,
  GitDiffResponse,
  GitOpResponse,
  GitPullResponse,
  WorkspaceGitResponse,
} from '~/types/api'

const props = defineProps<{
  root: string
  conversationId: number | null
}>()

const emit = defineEmits<{
  /**
   * Fired after any mutation (stage/commit/checkout/pull/push) so the
   * parent panel can refresh its tree + status badge without each tab
   * having to know about the parent's state.
   */
  (e: 'changed'): void
}>()

const api = useApi()
const { prompt } = usePromptDialog()
const toast = useToast()
const { t } = useI18n()

const status = ref<WorkspaceGitResponse | null>(null)
const branches = ref<GitBranchesResponse | null>(null)
const diff = ref<GitDiffResponse | null>(null)
const selectedPath = ref<string | null>(null)
// `staged` vs `unstaged` determines which `git diff` to fetch and which
// per-row action set to show. A single `MM` file produces two rows (one
// in each group); selectedSide stores which row is active.
const selectedSide = ref<'unstaged' | 'staged'>('unstaged')

// Mirrors the branch `<select>`'s actual value. We keep this as its own
// ref (not `branches.current` directly) so that selecting `__create__`
// + cancelling the prompt, or selecting a target branch and getting a 409
// from checkout, can reset the dropdown to the current branch without
// having to mutate the loaded branches payload.
const selectedBranch = ref<string>('')

const statusLoading = ref(false)
const branchesLoading = ref(false)
const diffLoading = ref(false)
const remoteBusy = ref(false)
const commitBusy = ref(false)

const statusError = ref<string | null>(null)
const branchesError = ref<string | null>(null)
const diffError = ref<string | null>(null)
const remoteMessage = ref<string | null>(null)
const pullConflicts = ref<string[]>([])

const commitMessage = ref('')

let statusSeq = 0
let branchesSeq = 0
let diffSeq = 0

const canWrite = computed(() => props.conversationId !== null)

function errorDetail(err: unknown): string | null {
  const e = err as {
    data?: { detail?: string }
    response?: { _data?: { detail?: string } }
    statusCode?: number
  }
  return e?.data?.detail ?? e?.response?._data?.detail ?? null
}
function errorMsg(err: unknown, fallback: string): string {
  return errorDetail(err) ?? (err instanceof Error ? err.message : fallback)
}
function errorStatus(err: unknown): number | null {
  return (err as { statusCode?: number; status?: number })?.statusCode
    ?? (err as { status?: number })?.status
    ?? null
}

async function fetchStatus(): Promise<void> {
  if (!props.root) return
  const seq = ++statusSeq
  statusLoading.value = true
  statusError.value = null
  try {
    const res = await api.get<WorkspaceGitResponse>(`/api/workspace/git`, {
      root: props.root,
    })
    if (seq === statusSeq) status.value = res
  } catch (err) {
    if (seq === statusSeq) {
      statusError.value = errorMsg(err, t('components.workspaceGitTab.errors.statusLoad'))
      status.value = null
    }
  } finally {
    if (seq === statusSeq) statusLoading.value = false
  }
}

async function fetchBranches(): Promise<void> {
  if (!props.root) return
  const seq = ++branchesSeq
  branchesLoading.value = true
  branchesError.value = null
  try {
    const res = await api.get<GitBranchesResponse>(
      `/api/workspace/git/branches`,
      { root: props.root },
    )
    if (seq === branchesSeq) {
      branches.value = res
      // Keep the dropdown's actual value in lockstep with the server's
      // notion of the current branch — otherwise a failed checkout that
      // left `selectedBranch` pointing at a different ref would silently
      // stay wrong after the next refresh.
      selectedBranch.value = res.current ?? ''
    }
  } catch (err) {
    if (seq === branchesSeq) {
      branchesError.value = errorMsg(err, t('components.workspaceGitTab.errors.branchesLoad'))
      branches.value = null
      selectedBranch.value = ''
    }
  } finally {
    if (seq === branchesSeq) branchesLoading.value = false
  }
}

async function fetchDiff(): Promise<void> {
  if (!props.root) return
  const seq = ++diffSeq
  diffLoading.value = true
  diffError.value = null
  try {
    const query: Record<string, unknown> = {
      root: props.root,
      staged: selectedSide.value === 'staged',
    }
    if (selectedPath.value) query.path = selectedPath.value
    const res = await api.get<GitDiffResponse>(
      `/api/workspace/git/diff`,
      query,
    )
    if (seq === diffSeq) diff.value = res
  } catch (err) {
    if (seq === diffSeq) {
      diffError.value = errorMsg(err, t('components.workspaceGitTab.errors.diffLoad'))
      diff.value = null
    }
  } finally {
    if (seq === diffSeq) diffLoading.value = false
  }
}

async function refreshAll(): Promise<void> {
  // Status + branches in parallel; diff follows because its query depends
  // on which file is selected (and that may change with a status refresh).
  await Promise.all([fetchStatus(), fetchBranches()])
  await fetchDiff()
}

// Each Plan-24 entry has porcelain XY status. Group into "staged" (index
// side X != space/?) and "unstaged" (working tree side Y != space). A
// single `MM` file lands in both buckets — that's intentional.
const stagedEntries = computed(() => {
  if (!status.value) return []
  return status.value.entries.filter((e) => {
    const x = e.status[0] ?? ' '
    return x !== ' ' && x !== '?'
  })
})
const unstagedEntries = computed(() => {
  if (!status.value) return []
  return status.value.entries.filter((e) => {
    const y = e.status[1] ?? ' '
    // `??` shows up as both X and Y == '?' — we want it under Unstaged.
    if (e.status === '??') return true
    return y !== ' '
  })
})

function selectFile(path: string, side: 'unstaged' | 'staged') {
  selectedPath.value = path
  selectedSide.value = side
  fetchDiff()
}

function clearSelectionIfMatches(path: string) {
  // After a row is staged / unstaged / discarded, the highlight + diff
  // header would point at a row that has either moved sides or vanished.
  // Easiest sane UX: drop the selection so the diff panel goes back to
  // "Datei auswählen" and the user can pick again from the post-refresh
  // bucket layout.
  if (selectedPath.value === path) {
    selectedPath.value = null
    diff.value = null
  }
}

async function stageOne(path: string) {
  clearSelectionIfMatches(path)
  await runOp(
    () => api.post<GitOpResponse>(`/api/workspace/git/stage`, {
      root: props.root,
      paths: [path],
    }),
    t('components.workspaceGitTab.toasts.staged'),
  )
}

async function unstageOne(path: string) {
  clearSelectionIfMatches(path)
  await runOp(
    () => api.post<GitOpResponse>(`/api/workspace/git/unstage`, {
      root: props.root,
      paths: [path],
    }),
    t('components.workspaceGitTab.toasts.unstaged'),
  )
}

async function discardOne(path: string) {
  if (!canWrite.value) {
    toast.warning(t('components.workspaceGitTab.toasts.needConversation'))
    return
  }
  clearSelectionIfMatches(path)
  try {
    await api.post<GitOpResponse>(`/api/workspace/git/discard`, {
      root: props.root,
      paths: [path],
      conversation_id: String(props.conversationId),
    })
    toast.success(t('components.workspaceGitTab.toasts.discarded'))
    await refreshAll()
    emit('changed')
  } catch (err) {
    if (errorStatus(err) === 403) {
      toast.error(t('components.workspaceGitTab.errors.discardDisabled'))
    } else {
      toast.error(errorMsg(err, t('components.workspaceGitTab.errors.discardFailed')))
    }
  }
}

async function runOp(
  call: () => Promise<GitOpResponse>,
  successMessage: string,
): Promise<void> {
  try {
    await call()
    toast.success(successMessage)
    await refreshAll()
    emit('changed')
  } catch (err) {
    toast.error(errorMsg(err, t('components.workspaceGitTab.errors.opFailed')))
  }
}

async function commit() {
  if (!commitMessage.value.trim()) {
    toast.warning(t('components.workspaceGitTab.toasts.needCommitMessage'))
    return
  }
  if (!canWrite.value) {
    toast.warning(t('components.workspaceGitTab.toasts.needConversation'))
    return
  }
  commitBusy.value = true
  try {
    await api.post<GitOpResponse>(`/api/workspace/git/commit`, {
      root: props.root,
      message: commitMessage.value.trim(),
      conversation_id: String(props.conversationId),
      all: false,
    })
    toast.success(t('components.workspaceGitTab.toasts.committed'))
    commitMessage.value = ''
    await refreshAll()
    emit('changed')
  } catch (err) {
    toast.error(errorMsg(err, t('components.workspaceGitTab.errors.commitFailed')))
  } finally {
    commitBusy.value = false
  }
}

function restoreBranchSelection() {
  // Bring the dropdown back in sync with the server's notion of the
  // current branch — called whenever a branch action returns early or
  // fails so the `<select>` doesn't stay stuck on `__create__` or on a
  // failed target. The reactive bump alone isn't enough because v-model
  // mirrors the user's last DOM choice, not the underlying ref.
  selectedBranch.value = branches.value?.current ?? ''
}

async function onBranchSelect(target: string | '__create__') {
  if (target === '__create__') {
    const name = await prompt({
      title: t('components.workspaceGitTab.createBranch.title'),
      description: t('components.workspaceGitTab.createBranch.description'),
      placeholder: t('components.workspaceGitTab.createBranch.placeholder'),
    })
    if (!name) {
      restoreBranchSelection()
      return
    }
    await checkoutBranch(name.trim(), true)
    return
  }
  if (target && target !== branches.value?.current) {
    await checkoutBranch(target, false)
  }
}

async function checkoutBranch(branch: string, create: boolean) {
  try {
    await api.post<GitOpResponse>(`/api/workspace/git/checkout`, {
      root: props.root,
      branch,
      create,
    })
    toast.success(
      create
        ? t('components.workspaceGitTab.toasts.branchCreated', { branch })
        : t('components.workspaceGitTab.toasts.branchSwitched', { branch }),
    )
    selectedPath.value = null
    await refreshAll()
    emit('changed')
  } catch (err) {
    if (errorStatus(err) === 409) {
      toast.error(t('components.workspaceGitTab.errors.checkoutConflict'))
    } else {
      toast.error(errorMsg(err, t('components.workspaceGitTab.errors.checkoutFailed')))
    }
    // Failed checkout = branch didn't change; resync the dropdown so
    // it doesn't look as if the target was selected.
    restoreBranchSelection()
  }
}

async function fetchRemote() {
  remoteBusy.value = true
  remoteMessage.value = null
  pullConflicts.value = []
  try {
    const res = await api.post<GitOpResponse>(`/api/workspace/git/fetch`, {
      root: props.root,
    })
    remoteMessage.value = res.ok
      ? (res.message || t('components.workspaceGitTab.toasts.fetchOk'))
      : t('components.workspaceGitTab.errors.fetchFailedDetail', { message: res.message })
    await refreshAll()
  } catch (err) {
    remoteMessage.value = errorMsg(err, t('components.workspaceGitTab.errors.fetchFailed'))
  } finally {
    remoteBusy.value = false
  }
}

async function pullRemote() {
  remoteBusy.value = true
  remoteMessage.value = null
  pullConflicts.value = []
  try {
    const res = await api.post<GitPullResponse>(`/api/workspace/git/pull`, {
      root: props.root,
    })
    if (res.ok) {
      remoteMessage.value = res.message || t('components.workspaceGitTab.toasts.pullOk')
    } else {
      remoteMessage.value = res.message
      pullConflicts.value = res.conflicts ?? []
    }
    await refreshAll()
    emit('changed')
  } catch (err) {
    remoteMessage.value = errorMsg(err, t('components.workspaceGitTab.errors.pullFailed'))
  } finally {
    remoteBusy.value = false
  }
}

async function pushRemote(setUpstream: boolean) {
  remoteBusy.value = true
  remoteMessage.value = null
  pullConflicts.value = []
  try {
    const res = await api.post<GitOpResponse>(`/api/workspace/git/push`, {
      root: props.root,
      set_upstream: setUpstream,
    })
    remoteMessage.value = res.ok
      ? (res.message || t('components.workspaceGitTab.toasts.pushOk'))
      : t('components.workspaceGitTab.errors.pushFailedDetail', { message: res.message })
  } catch (err) {
    remoteMessage.value = errorMsg(err, t('components.workspaceGitTab.errors.pushFailed'))
  } finally {
    remoteBusy.value = false
  }
}

// Header for the diff pane: "<side> · <path>" when a row is selected, or a
// prompt to pick one. `selectedSide` is already the literal 'staged' /
// 'unstaged' git term, kept verbatim in both locales.
const diffHeaderLabel = computed(() => {
  if (!selectedPath.value) return t('components.workspaceGitTab.diffSelectPrompt')
  return `${selectedSide.value} · ${selectedPath.value}`
})

// The diff body is rendered as a fenced ```diff block so shiki (already
// preloaded with the `diff` grammar — see app/utils/markdown.ts) handles
// the syntax highlighting we'd otherwise have to wire by hand.
const diffMarkdown = computed(() => {
  if (!diff.value || diff.value.kind !== 'text' || !diff.value.patch) return ''
  // The patch can include three-backtick lines (e.g. when the diff
  // touches a markdown file that itself contains a fenced block). A naive
  // ``` outer fence would be closed prematurely by the inner run. CommonMark
  // lets us pick a longer outer fence — at least one more backtick than
  // the longest run found inside the body.
  const longestRun = (diff.value.patch.match(/`+/g) ?? [])
    .reduce((max, run) => Math.max(max, run.length), 0)
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}diff\n${diff.value.patch}\n${fence}`
})

watch(
  () => props.root,
  () => {
    selectedPath.value = null
    selectedSide.value = 'unstaged'
    status.value = null
    branches.value = null
    diff.value = null
    if (props.root) refreshAll()
  },
  { immediate: true },
)

defineExpose({ refreshAll })
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Branch + refresh row -->
    <div class="flex items-center gap-2 border-b p-3">
      <GitBranch class="size-4 shrink-0 text-muted-foreground" />
      <select
        v-model="selectedBranch"
        class="flex-1 truncate rounded-md border bg-background px-2 py-1 text-sm"
        :disabled="branchesLoading || !branches"
        @change="onBranchSelect(($event.target as HTMLSelectElement).value)"
      >
        <option v-if="!branches?.current" value="" disabled>
          {{ branchesLoading ? $t('common.loading') : $t('components.workspaceGitTab.detached') }}
        </option>
        <option
          v-for="b in branches?.all ?? []"
          :key="b.name"
          :value="b.name"
          :disabled="b.is_remote"
        >
          {{ b.is_remote ? `remote: ${b.name}` : b.name }}
        </option>
        <option value="__create__">{{ $t('components.workspaceGitTab.createBranchOption') }}</option>
      </select>
      <UiButton
        size="sm"
        variant="ghost"
        :disabled="statusLoading || branchesLoading"
        :aria-label="$t('common.refresh')"
        @click="refreshAll"
      >
        <RefreshCw
          class="size-3.5"
          :class="statusLoading || branchesLoading ? 'animate-spin' : ''"
        />
      </UiButton>
    </div>

    <!-- Status sections -->
    <div class="max-h-60 overflow-y-auto border-b">
      <div v-if="statusError" class="p-3 text-sm text-destructive">
        {{ statusError }}
      </div>
      <div
        v-else-if="!status || (!status.is_repo)"
        class="p-3 text-sm text-muted-foreground"
      >
        {{ $t('components.workspaceGitTab.noRepo') }}
      </div>
      <div
        v-else-if="stagedEntries.length === 0 && unstagedEntries.length === 0"
        class="p-3 text-sm text-muted-foreground"
      >
        {{ $t('components.workspaceGitTab.workingTreeClean') }}
      </div>
      <template v-else>
        <section v-if="unstagedEntries.length > 0">
          <h4 class="bg-muted/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {{ $t('components.workspaceGitTab.sections.unstaged', { count: unstagedEntries.length }) }}
          </h4>
          <ul class="divide-y text-sm">
            <li
              v-for="entry in unstagedEntries"
              :key="`u-${entry.path}`"
              class="flex items-center gap-2 px-3 py-1.5"
              :class="
                selectedPath === entry.path && selectedSide === 'unstaged'
                  ? 'bg-accent'
                  : 'hover:bg-muted'
              "
            >
              <span class="w-6 font-mono text-xs text-muted-foreground">
                {{ entry.status }}
              </span>
              <button
                type="button"
                class="flex-1 truncate text-left font-mono text-xs"
                @click="selectFile(entry.path, 'unstaged')"
              >
                {{ entry.path }}
              </button>
              <UiButton
                size="sm"
                variant="ghost"
                :aria-label="$t('components.workspaceGitTab.stageAria')"
                :disabled="!canWrite"
                @click="stageOne(entry.path)"
              >
                <Plus class="size-3" />
              </UiButton>
              <UiButton
                size="sm"
                variant="ghost"
                :aria-label="$t('components.workspaceGitTab.discardAria')"
                class="text-destructive hover:text-destructive"
                :disabled="!canWrite"
                @click="discardOne(entry.path)"
              >
                <Trash2 class="size-3" />
              </UiButton>
            </li>
          </ul>
        </section>
        <section v-if="stagedEntries.length > 0">
          <h4 class="bg-muted/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {{ $t('components.workspaceGitTab.sections.staged', { count: stagedEntries.length }) }}
          </h4>
          <ul class="divide-y text-sm">
            <li
              v-for="entry in stagedEntries"
              :key="`s-${entry.path}`"
              class="flex items-center gap-2 px-3 py-1.5"
              :class="
                selectedPath === entry.path && selectedSide === 'staged'
                  ? 'bg-accent'
                  : 'hover:bg-muted'
              "
            >
              <span class="w-6 font-mono text-xs text-muted-foreground">
                {{ entry.status }}
              </span>
              <button
                type="button"
                class="flex-1 truncate text-left font-mono text-xs"
                @click="selectFile(entry.path, 'staged')"
              >
                {{ entry.path }}
              </button>
              <UiButton
                size="sm"
                variant="ghost"
                :aria-label="$t('components.workspaceGitTab.unstageAria')"
                :disabled="!canWrite"
                @click="unstageOne(entry.path)"
              >
                <Minus class="size-3" />
              </UiButton>
            </li>
          </ul>
        </section>
      </template>
    </div>

    <!-- Diff viewer -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <div class="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
        <span class="truncate font-mono">
          {{ diffHeaderLabel }}
        </span>
        <span v-if="diff && diff.kind !== 'none'" class="shrink-0">
          {{ diff.summary.files }} {{ $t('components.workspaceGitTab.filesLabel') }} ·
          <span class="text-emerald-600 dark:text-emerald-400">+{{ diff.summary.insertions }}</span> /
          <span class="text-rose-600 dark:text-rose-400">-{{ diff.summary.deletions }}</span>
        </span>
      </div>
      <div class="flex-1 overflow-auto">
        <p v-if="diffLoading" class="p-3 text-sm text-muted-foreground">{{ $t('common.loading') }}</p>
        <p v-else-if="diffError" class="p-3 text-sm text-destructive">{{ diffError }}</p>
        <p
          v-else-if="!diff || diff.kind === 'none'"
          class="p-3 text-sm text-muted-foreground"
        >
          {{ $t('components.workspaceGitTab.noChanges') }}
        </p>
        <p
          v-else-if="diff.kind === 'binary'"
          class="p-3 text-sm text-muted-foreground"
        >
          {{ $t('components.workspaceGitTab.binary') }}
        </p>
        <template v-else>
          <p
            v-if="diff.truncated"
            class="border-b bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            {{ $t('components.workspaceGitTab.patchTruncated') }}
          </p>
          <div class="p-3 text-xs">
            <ChatRenderedMarkdown :content="diffMarkdown" />
          </div>
        </template>
      </div>
    </div>

    <!-- Commit row -->
    <div class="space-y-2 border-t p-3">
      <textarea
        v-model="commitMessage"
        class="min-h-15 w-full resize-y rounded-md border bg-background p-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
        :placeholder="$t('components.workspaceGitTab.commitPlaceholder')"
        :disabled="commitBusy || !canWrite"
        spellcheck="false"
      />
      <div class="flex flex-wrap items-center gap-2">
        <UiButton
          size="sm"
          :disabled="commitBusy || !canWrite || !commitMessage.trim() || stagedEntries.length === 0"
          @click="commit"
        >
          {{ commitBusy ? $t('components.workspaceGitTab.commitBusy') : $t('components.workspaceGitTab.commitButton') }}
        </UiButton>
        <p
          v-if="!canWrite"
          class="text-xs text-muted-foreground"
        >
          {{ $t('components.workspaceGitTab.commitNoConversation') }}
        </p>
        <p
          v-else-if="stagedEntries.length === 0"
          class="text-xs text-muted-foreground"
        >
          {{ $t('components.workspaceGitTab.commitNeedsStaged') }}
        </p>
      </div>
    </div>

    <!-- Remote ops + last-message banner -->
    <div class="space-y-2 border-t p-3">
      <div class="flex flex-wrap items-center gap-2">
        <UiButton
          size="sm"
          variant="outline"
          :disabled="remoteBusy"
          @click="fetchRemote"
        >
          {{ $t('components.workspaceGitTab.fetch') }}
        </UiButton>
        <UiButton
          size="sm"
          variant="outline"
          :disabled="remoteBusy"
          @click="pullRemote"
        >
          <ArrowDown class="mr-1 size-3" /> {{ $t('components.workspaceGitTab.pull') }}
        </UiButton>
        <UiButton
          size="sm"
          variant="outline"
          :disabled="remoteBusy"
          @click="pushRemote(false)"
        >
          <ArrowUp class="mr-1 size-3" /> {{ $t('components.workspaceGitTab.push') }}
        </UiButton>
        <UiButton
          size="sm"
          variant="ghost"
          :disabled="remoteBusy"
          @click="pushRemote(true)"
        >
          {{ $t('components.workspaceGitTab.pushUpstream') }}
        </UiButton>
      </div>
      <pre
        v-if="remoteMessage"
        class="whitespace-pre-wrap rounded border bg-muted/30 p-2 text-xs"
      >{{ remoteMessage }}</pre>
      <div v-if="pullConflicts.length > 0" class="rounded border border-amber-500/60 bg-amber-500/10 p-2 text-xs">
        <p class="font-semibold text-amber-700 dark:text-amber-300">
          {{ $t('components.workspaceGitTab.pullConflicts') }}
        </p>
        <ul class="mt-1 list-disc space-y-0.5 pl-5 font-mono">
          <li v-for="path in pullConflicts" :key="path">{{ path }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>
