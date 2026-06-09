<script setup lang="ts">
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCcw,
} from 'lucide-vue-next'
import type {
  AgentRun,
  DiagnosticsCheck,
  DiagnosticsStatus,
  SandboxCrash,
  SandboxCrashState,
} from '~/types/api'

// Plan 20: read-only status snapshot for the Control Center.
// Two sections — a flat subsystem-check list (one row per check returned
// by `/api/diagnostics`) and a "Recent failures" panel backed by
// `GET /api/runs?status=error`. The page is intentionally flatter than
// /settings/memory + /settings/tasks because nothing here is editable.

const {
  diagnostics,
  diagnosticsLoading,
  diagnosticsError,
  failures,
  failuresLoading,
  failuresError,
  crashes,
  crashesLoading,
  crashesError,
  loadAll,
} = useDiagnostics()
const { t } = useI18n()

const expandedRunIds = ref<Set<string>>(new Set())

function toggleRun(id: string) {
  const next = new Set(expandedRunIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedRunIds.value = next
}

const overall = computed<DiagnosticsStatus | null>(() => {
  return diagnostics.value?.overall ?? null
})

// `satisfies Record<DiagnosticsStatus, ...>` keeps this map exhaustive
// against future schema additions — adding a status value to the backend
// without updating it becomes a TS error. The label counterpart lives in
// the locale files under `pages.diagnostics.status.*` and is keyed by the
// same enum value via the template literal in statusLabel().
const STATUS_BADGE_CLASS = {
  ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  error: 'bg-destructive/10 text-destructive',
} as const satisfies Record<DiagnosticsStatus, string>

function statusLabel(status: DiagnosticsStatus): string {
  return t(`pages.diagnostics.status.${status}`)
}

function statusBadgeClass(status: DiagnosticsStatus): string {
  return STATUS_BADGE_CLASS[status]
}

// Plan 30: each subsystem id has a localized label under
// pages.diagnostics.subsystems.labels.<id>. The id itself is a stable
// backend identifier (database / llm / scheduler / workspace / sandbox)
// — never user-facing.
function subsystemLabel(id: string): string {
  return t(`pages.diagnostics.subsystems.labels.${id}`)
}

// Plan 30 contract: each check carries `code` + `params`; the locale
// file owns the full message template (`errors.<CODE>`). The backend
// is locale-agnostic from here on.
function checkMessage(check: DiagnosticsCheck): string {
  // `params.names` (from DIAG_WORKSPACE_CONFIGURED) comes through as
  // an array; the i18n template expects a single string, so we join
  // here once with the user's preferred locale's separator (", "
  // works for both DE and EN — no need to split per-locale).
  const params: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(check.params ?? {})) {
    params[k] = Array.isArray(v) ? v.join(', ') : (v as string | number)
  }
  return t(`errors.${check.code}`, params)
}

function formatTimestamp(epoch: number | null): string {
  if (!epoch) return '—'
  return new Date(epoch * 1000).toLocaleString()
}

// Plan 20-A: persisted sandbox crashes. Always an "error" badge (a row
// only exists if the watcher saw a dead transition), but the state value
// itself — crashed | oom | removed — disambiguates the failure mode for
// the operator. Labels live under `pages.diagnostics.crashState.*`, keyed
// by the enum value via the template literal in crashStateLabel().
function crashStateLabel(state: SandboxCrashState): string {
  return t(`pages.diagnostics.crashState.${state}`)
}

function formatCrashExitCode(crash: SandboxCrash): string {
  return crash.exit_code === null ? '—' : String(crash.exit_code)
}

function describeDuration(run: AgentRun): string {
  if (!run.finished_at) return t('pages.diagnostics.running')
  const ms = (run.finished_at - run.started_at) * 1000
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

onMounted(loadAll)
</script>

<template>
  <div class="flex flex-col gap-6" data-testid="diagnostics-page">
    <!-- ── Header: title + overall badge + refresh ─────────────── -->
    <header class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <Activity class="size-5 text-muted-foreground" />
        <h2 class="text-base font-semibold">{{ $t('pages.diagnostics.title') }}</h2>
        <span
          v-if="overall"
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          :class="statusBadgeClass(overall)"
          data-testid="diagnostics-overall"
        >
          {{ statusLabel(overall) }}
        </span>
      </div>
      <UiButton
        size="sm"
        variant="outline"
        :disabled="diagnosticsLoading || failuresLoading || crashesLoading"
        :aria-label="$t('common.reload')"
        data-testid="diagnostics-refresh"
        @click="loadAll"
      >
        <RefreshCcw class="mr-1 size-4" />
        {{ $t('common.reload') }}
      </UiButton>
    </header>

    <!-- ── Subsystem checks ─────────────────────────────────────── -->
    <section class="rounded-md border" data-testid="diagnostics-checks">
      <header class="border-b p-3">
        <h3 class="text-sm font-semibold">{{ $t('pages.diagnostics.subsystems.title') }}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{ $t('pages.diagnostics.subsystems.subtitle') }}
        </p>
      </header>

      <p v-if="diagnosticsLoading" class="p-3 text-xs text-muted-foreground">
        {{ $t('common.loading') }}
      </p>
      <p
        v-else-if="diagnosticsError"
        class="p-3 text-xs text-destructive"
        data-testid="diagnostics-checks-error"
      >
        {{ diagnosticsError }}
      </p>
      <ul
        v-else-if="diagnostics"
        class="divide-y"
      >
        <li
          v-for="check in diagnostics.checks"
          :key="check.id"
          class="flex items-start gap-3 p-3"
          :data-testid="`diagnostics-check-${check.id}`"
        >
          <span class="mt-0.5 shrink-0">
            <CheckCircle2
              v-if="check.status === 'ok'"
              class="size-5 text-emerald-500"
              aria-hidden="true"
            />
            <AlertTriangle
              v-else-if="check.status === 'warning'"
              class="size-5 text-amber-500"
              aria-hidden="true"
            />
            <AlertCircle
              v-else
              class="size-5 text-destructive"
              aria-hidden="true"
            />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium">{{ subsystemLabel(check.id) }}</p>
              <span
                class="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                :class="statusBadgeClass(check.status)"
              >
                {{ statusLabel(check.status) }}
              </span>
            </div>
            <p class="mt-0.5 wrap-break-word text-xs text-muted-foreground">
              {{ checkMessage(check) }}
            </p>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Sandbox crashes (Plan 20-A) ──────────────────────────── -->
    <section class="rounded-md border" data-testid="diagnostics-crashes">
      <header class="border-b p-3">
        <h3 class="text-sm font-semibold">{{ $t('pages.diagnostics.crashes.title') }}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{ $t('pages.diagnostics.crashes.subtitle') }}
        </p>
      </header>

      <p v-if="crashesLoading" class="p-3 text-xs text-muted-foreground">
        {{ $t('common.loading') }}
      </p>
      <p
        v-else-if="crashesError"
        class="p-3 text-xs text-destructive"
        data-testid="diagnostics-crashes-error"
      >
        {{ crashesError }}
      </p>
      <p
        v-else-if="crashes.length === 0"
        class="p-3 text-xs text-muted-foreground"
        data-testid="diagnostics-crashes-empty"
      >
        {{ $t('pages.diagnostics.crashes.empty') }}
      </p>
      <ul v-else class="divide-y">
        <li
          v-for="crash in crashes"
          :key="crash.id"
          class="flex items-start gap-3 p-3"
          :data-testid="`diagnostics-crash-${crash.id}`"
        >
          <AlertCircle
            class="mt-0.5 size-5 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p class="text-sm font-medium">{{ crash.workspace_id }}</p>
              <span
                class="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive"
              >
                {{ crashStateLabel(crash.state) }}
              </span>
            </div>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">
              {{ formatTimestamp(crash.crashed_at) }} ·
              {{ $t('pages.diagnostics.crashes.exitLabel') }} {{ formatCrashExitCode(crash) }} ·
              <span class="font-mono">{{ crash.sandbox_id }}</span>
            </p>
            <p
              v-if="crash.last_message"
              class="mt-1 wrap-break-word text-xs"
            >
              {{ crash.last_message }}
            </p>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Recent failures ──────────────────────────────────────── -->
    <section class="rounded-md border" data-testid="diagnostics-failures">
      <header class="border-b p-3">
        <h3 class="text-sm font-semibold">{{ $t('pages.diagnostics.failures.title') }}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{ $t('pages.diagnostics.failures.subtitleBefore') }}<code>error</code>{{ $t('pages.diagnostics.failures.subtitleMid') }}<code>/api/runs</code>{{ $t('pages.diagnostics.failures.subtitleAfter') }}
        </p>
      </header>

      <p v-if="failuresLoading" class="p-3 text-xs text-muted-foreground">
        {{ $t('common.loading') }}
      </p>
      <p
        v-else-if="failuresError"
        class="p-3 text-xs text-destructive"
        data-testid="diagnostics-failures-error"
      >
        {{ failuresError }}
      </p>
      <p
        v-else-if="failures.length === 0"
        class="p-3 text-xs text-muted-foreground"
        data-testid="diagnostics-failures-empty"
      >
        {{ $t('pages.diagnostics.failures.empty') }}
      </p>
      <ul v-else class="divide-y">
        <li
          v-for="run in failures"
          :key="run.id"
          :data-testid="`diagnostics-failure-${run.id}`"
        >
          <button
            type="button"
            class="flex w-full items-start gap-2 p-3 text-left transition-colors hover:bg-muted/40"
            :aria-expanded="expandedRunIds.has(run.id)"
            @click="toggleRun(run.id)"
          >
            <ChevronDown
              v-if="expandedRunIds.has(run.id)"
              class="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <ChevronRight
              v-else
              class="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p class="text-sm font-medium">
                  {{ run.error_code ?? 'error' }}
                </p>
                <span class="text-xs text-muted-foreground">
                  · {{ run.channel }} · {{ run.model }}
                </span>
              </div>
              <p class="mt-0.5 truncate text-xs text-muted-foreground">
                {{ formatTimestamp(run.started_at) }} ·
                {{ describeDuration(run) }} ·
                {{ $t('pages.diagnostics.failures.conversation', { id: run.conversation_id }) }}
              </p>
              <p
                v-if="run.error_message"
                class="mt-1 wrap-break-word text-xs"
              >
                {{ run.error_message }}
              </p>
            </div>
          </button>
          <pre
            v-if="expandedRunIds.has(run.id) && run.error_trace"
            class="mx-3 mb-3 overflow-x-auto rounded-md bg-muted/40 p-3 text-[11px] leading-snug"
            >{{ run.error_trace }}</pre>
          <p
            v-else-if="expandedRunIds.has(run.id)"
            class="mx-3 mb-3 text-xs text-muted-foreground"
          >
            {{ $t('pages.diagnostics.failures.noTrace') }}
          </p>
        </li>
      </ul>
    </section>
  </div>
</template>
