<script setup lang="ts">
import { Copy, FileText, RefreshCcw, WrapText } from 'lucide-vue-next'
import type { LogRow } from '~/types/api'

// Plan 27: tail of the rotating structlog file. Severity filter,
// substring search, tail size selector, copy-all, and a wrap toggle.
// Auto-refreshes every 5s while the tab is visible — silent when
// hidden so a background tab doesn't drum on the backend.

const {
  rows,
  loading,
  error,
  disabled,
  minLevel,
  tail,
  load,
  setMinLevel,
  setTail,
} = useLogs()
const toast = useToast()
const { t } = useI18n()

const LEVEL_OPTIONS: { value: LogLevelFilter; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
]

const TAIL_OPTIONS: LogTailSize[] = [100, 500, 1000]

const search = ref('')
const wrap = ref(true)

const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return rows.value
  return rows.value.filter((row) => JSON.stringify(row).toLowerCase().includes(needle))
})

// ── auto-refresh: 5s while visible ───────────────────────────────────
const refreshTimer = ref<ReturnType<typeof setInterval> | null>(null)

function startAutoRefresh(): void {
  stopAutoRefresh()
  refreshTimer.value = setInterval(() => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      void load()
    }
  }, 5_000)
}

function stopAutoRefresh(): void {
  if (refreshTimer.value !== null) {
    clearInterval(refreshTimer.value)
    refreshTimer.value = null
  }
}

onMounted(() => {
  void load()
  startAutoRefresh()
})
onBeforeUnmount(stopAutoRefresh)

// ── presentation helpers ─────────────────────────────────────────────

function rowLevel(row: LogRow): string | null {
  const lvl = (row as Record<string, unknown>).level
  return typeof lvl === 'string' ? lvl : null
}

function rowEvent(row: LogRow): string {
  const ev = (row as Record<string, unknown>).event
  if (typeof ev === 'string') return ev
  if ('_raw' in row && typeof row._raw === 'string') return row._raw
  return ''
}

function rowTimestamp(row: LogRow): string | null {
  const ts = (row as Record<string, unknown>).timestamp
  return typeof ts === 'string' ? ts : null
}

function rowDetails(row: LogRow): string {
  // Render every key except the ones already shown in the header so the
  // detail line doesn't repeat itself. `_raw` is the malformed-line
  // fallback — its content is already in the event slot via rowEvent(),
  // so drop it here too or it'd appear twice on every unparseable line.
  const { level, event, timestamp, _raw, ...rest } = row as Record<
    string,
    unknown
  >
  void level
  void event
  void timestamp
  void _raw
  if (Object.keys(rest).length === 0) return ''
  return JSON.stringify(rest)
}

const LEVEL_CLASS: Record<string, string> = {
  debug: 'text-muted-foreground',
  info: 'text-sky-600 dark:text-sky-400',
  warning: 'text-amber-600 dark:text-amber-400',
  error: 'text-destructive',
  critical: 'text-destructive font-semibold',
}

function levelClass(level: string | null): string {
  if (!level) return ''
  return LEVEL_CLASS[level.toLowerCase()] ?? ''
}

async function copyAll(): Promise<void> {
  try {
    const payload = filtered.value
      .map((r) => JSON.stringify(r))
      .join('\n')
    await navigator.clipboard.writeText(payload)
    toast.success(t('pages.logs.copied', { count: filtered.value.length }))
  } catch {
    toast.error(t('pages.logs.copyFailed'))
  }
}
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="logs-page">
    <!-- ── Header ──────────────────────────────────────────────── -->
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <FileText class="size-5 text-muted-foreground" />
        <h2 class="text-base font-semibold">{{ $t('pages.logs.title') }}</h2>
      </div>
      <div class="flex items-center gap-2">
        <UiButton
          size="sm"
          variant="outline"
          :disabled="loading || filtered.length === 0"
          :aria-label="$t('pages.logs.copyAria')"
          data-testid="logs-copy"
          @click="copyAll"
        >
          <Copy class="mr-1 size-4" />
          {{ $t('pages.logs.copy') }}
        </UiButton>
        <UiButton
          size="sm"
          variant="outline"
          :aria-pressed="wrap"
          :title="wrap ? $t('pages.logs.wrapOff') : $t('pages.logs.wrapOn')"
          data-testid="logs-wrap"
          @click="wrap = !wrap"
        >
          <WrapText class="mr-1 size-4" />
          {{ $t('pages.logs.wrap') }}
        </UiButton>
        <UiButton
          size="sm"
          variant="outline"
          :disabled="loading"
          :aria-label="$t('common.reload')"
          data-testid="logs-refresh"
          @click="load"
        >
          <RefreshCcw class="mr-1 size-4" />
          {{ $t('common.reload') }}
        </UiButton>
      </div>
    </header>

    <!-- ── Filter bar ──────────────────────────────────────────── -->
    <div class="flex flex-wrap items-center gap-3">
      <div
        class="inline-flex rounded-md border bg-background p-0.5"
        role="group"
        :aria-label="$t('pages.logs.severityAria')"
        data-testid="logs-level"
      >
        <button
          v-for="opt in LEVEL_OPTIONS"
          :key="opt.value"
          type="button"
          class="rounded px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            minLevel === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
          "
          :aria-pressed="minLevel === opt.value"
          :data-testid="`logs-level-${opt.value}`"
          @click="setMinLevel(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>

      <div
        class="inline-flex rounded-md border bg-background p-0.5"
        role="group"
        :aria-label="$t('pages.logs.lineCountAria')"
        data-testid="logs-tail"
      >
        <button
          v-for="value in TAIL_OPTIONS"
          :key="value"
          type="button"
          class="rounded px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            tail === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
          "
          :aria-pressed="tail === value"
          :data-testid="`logs-tail-${value}`"
          @click="setTail(value)"
        >
          {{ value }}
        </button>
      </div>

      <input
        v-model="search"
        type="search"
        class="h-8 flex-1 min-w-48 rounded-md border bg-background px-3 text-xs"
        :placeholder="$t('pages.logs.searchPlaceholder')"
        :aria-label="$t('pages.logs.searchAria')"
        data-testid="logs-search"
      />
    </div>

    <!-- ── Disabled state (no HERMES_LOG_FILE) ─────────────────── -->
    <p
      v-if="disabled"
      class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400"
      data-testid="logs-disabled"
    >
      {{ $t('pages.logs.disabled.before') }}<code class="font-mono">HERMES_LOG_FILE</code>{{ $t('pages.logs.disabled.middle') }}<code class="font-mono">/var/log/hermes/agent.log</code>{{ $t('pages.logs.disabled.after') }}
    </p>

    <p
      v-else-if="error"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
      data-testid="logs-error"
    >
      {{ error }}
    </p>

    <p
      v-else-if="loading && rows.length === 0"
      class="text-xs text-muted-foreground"
    >
      {{ $t('common.loading') }}
    </p>

    <p
      v-else-if="!loading && filtered.length === 0 && search.trim().length > 0"
      class="text-xs text-muted-foreground"
      data-testid="logs-no-match"
    >
      {{ $t('pages.logs.noMatch', { search }) }}
    </p>

    <p
      v-else-if="!loading && rows.length === 0"
      class="text-xs text-muted-foreground"
      data-testid="logs-empty"
    >
      {{ $t('pages.logs.empty') }}
    </p>

    <!-- ── Tail ────────────────────────────────────────────────── -->
    <ol
      v-if="filtered.length > 0"
      class="overflow-hidden rounded-md border bg-muted/20 font-mono text-[11px] leading-snug"
      data-testid="logs-tail-output"
    >
      <li
        v-for="(row, idx) in filtered"
        :key="idx"
        class="border-b px-3 py-1.5 last:border-b-0"
        :class="wrap ? 'whitespace-pre-wrap wrap-break-word' : 'overflow-x-auto whitespace-pre'"
        :data-testid="`logs-row-${idx}`"
      >
        <span v-if="rowTimestamp(row)" class="text-muted-foreground">
          {{ rowTimestamp(row) }}
        </span>
        <span
          v-if="rowLevel(row)"
          class="ml-1 mr-2 uppercase"
          :class="levelClass(rowLevel(row))"
        >
          {{ rowLevel(row) }}
        </span>
        <span class="font-semibold">{{ rowEvent(row) }}</span>
        <span v-if="rowDetails(row)" class="ml-2 text-muted-foreground">
          {{ rowDetails(row) }}
        </span>
      </li>
    </ol>
  </div>
</template>
