<script setup lang="ts">
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  RefreshCcw,
  ShieldAlert,
  Wrench,
} from 'lucide-vue-next'
import type McpServersSection from '~/components/settings/McpServersSection.vue'
import type { ToolInfo } from '~/types/api'

// Plan 31 + 32 + 33: skills & tools page.
//   0. Skills section (Plan 33) — reusable prompt building blocks
//      (Markdown bodies with frontmatter-style metadata). Two-pane
//      browser mirroring /settings/memory's layout. Personas activate
//      them on the Preferences page.
//   1. MCP-Servers section (Plan 32) — registered external MCP servers.
//      CRUD form + per-server lifecycle controls. Plan 31's
//      "Konfigurieren"-button now scrolls here.
//   2. MCP-Surface card — the inbound streamable-HTTP mount external
//      clients (Cline, HaexChat) connect to. Refresh button re-polls
//      `/api/mcp/health` (now also lists per-server statuses).
//   3. Tool catalog — flat alphabetical list with `source` pill.
//      `mcp:<server-name>`-sourced tools' "Konfigurieren"-Button jumps
//      to the matching server card.

const toolsApi = useTools()
const mcpApi = useMcpHealth()
const toast = useToast()
const { t } = useI18n()
const mcpSectionRef = ref<InstanceType<typeof McpServersSection> | null>(null)

const expandedToolNames = ref<Set<string>>(new Set())

// Tick every second so "vor X s" stays live without re-polling the
// backend — `lastCheckedAt` is captured client-side and the relative
// label is derived from it.
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void toolsApi.list()
  void mcpApi.check()
  nowTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (nowTimer !== null) {
    clearInterval(nowTimer)
    nowTimer = null
  }
})

function toggleTool(name: string) {
  const next = new Set(expandedToolNames.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  expandedToolNames.value = next
}

function formatRelative(epochMs: number | null, nowMs: number): string {
  if (!epochMs) return t('pages.skills.relative.never')
  const deltaSec = Math.max(0, Math.floor((nowMs - epochMs) / 1000))
  if (deltaSec < 60) return t('pages.skills.relative.seconds', { n: deltaSec })
  const min = Math.floor(deltaSec / 60)
  if (min < 60) return t('pages.skills.relative.minutes', { n: min })
  const hr = Math.floor(min / 60)
  return t('pages.skills.relative.hours', { n: hr })
}

function prettySchema(schema: ToolInfo['parameters_schema']): string {
  return JSON.stringify(schema, null, 2)
}

function hasParameters(tool: ToolInfo): boolean {
  const props = (tool.parameters_schema?.properties ?? null) as
    | Record<string, unknown>
    | null
  return !!props && Object.keys(props).length > 0
}

const SOURCE_PILL_CLASS =
  'rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'

function sourceLabel(source: string): string {
  if (source === 'builtin') return 'built-in'
  if (source.startsWith('mcp:')) return source
  return source
}

async function copyMcpUrl() {
  if (!mcpApi.data.value) return
  try {
    await navigator.clipboard.writeText(mcpApi.data.value.url)
    toast.success(t('pages.skills.toasts.urlCopied'))
  } catch {
    toast.error(t('pages.skills.toasts.copyFailed'))
  }
}

function scrollToSection(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Plan 32: when a tool is sourced from an MCP server, surface the
// "Konfigurieren"-Button as a jump-to-server-card link. Built-in tools
// stay disabled (Plan 33 will give them a real configure surface).
function mcpServerNameForTool(source: string): string | null {
  if (!source.startsWith('mcp:')) return null
  return source.slice('mcp:'.length)
}

function scrollToMcpServer(source: string) {
  const name = mcpServerNameForTool(source)
  if (name === null) return
  const el = document.getElementById(`mcp-server-${name}`)
  // Fall back to the section anchor when the registered server doesn't
  // match a card (deleted between refreshes etc.).
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  else scrollToSection('mcp-section')
}

function onMcpCatalogChanged() {
  // The catalog endpoint reads `app.state.tool_catalog` live, so a
  // re-fetch picks up the new MCP-sourced tools. The MCP-health card
  // also refreshes so the "X Tools exponiert" line stays in sync.
  void toolsApi.list()
  void mcpApi.check()
}
</script>

<template>
  <div class="flex flex-col gap-6" data-testid="skills-page">
    <!-- ── Header ──────────────────────────────────────────────── -->
    <header class="flex items-center gap-2">
      <Wrench class="size-5 text-muted-foreground" />
      <h2 class="text-base font-semibold">{{ $t('pages.skills.title') }}</h2>
    </header>

    <!-- ── Skills (Plan 33) ────────────────────────────────────── -->
    <SettingsSkillsSection />

    <!-- ── MCP-Servers (Plan 32) ───────────────────────────────── -->
    <SettingsMcpServersSection
      ref="mcpSectionRef"
      :on-catalog-changed="onMcpCatalogChanged"
    />

    <!-- ── MCP-Surface card ────────────────────────────────────── -->
    <section class="rounded-md border" data-testid="mcp-card">
      <header class="flex flex-wrap items-start justify-between gap-3 border-b p-3">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-semibold">{{ $t('pages.skills.mcpEndpoint.title') }}</h3>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {{ $t('pages.skills.mcpEndpoint.subtitle') }}
          </p>
        </div>
        <UiButton
          size="sm"
          variant="outline"
          :disabled="mcpApi.loading.value"
          :aria-label="$t('pages.skills.mcpEndpoint.reloadAria')"
          data-testid="mcp-refresh"
          @click="mcpApi.check"
        >
          <RefreshCcw class="mr-1 size-4" />
          {{ $t('common.reload') }}
        </UiButton>
      </header>

      <div class="space-y-3 p-3">
        <p
          v-if="mcpApi.loading.value && !mcpApi.data.value"
          class="text-xs text-muted-foreground"
          data-testid="mcp-loading"
        >
          {{ $t('common.loading') }}
        </p>
        <p
          v-else-if="mcpApi.error.value"
          class="text-xs text-destructive"
          data-testid="mcp-error"
        >
          {{ $t('pages.skills.mcpEndpoint.statusUnknownLabel') }} {{ mcpApi.error.value }}
        </p>
        <template v-else-if="mcpApi.data.value">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span
              v-if="mcpApi.data.value.status === 'ok'"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
              data-testid="mcp-status"
            >
              <CheckCircle2 class="size-3.5" aria-hidden="true" />
              {{ $t('pages.skills.mcpEndpoint.active') }}
            </span>
            <span
              v-else
              class="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
              data-testid="mcp-status"
            >
              <AlertCircle class="size-3.5" aria-hidden="true" />
              {{ $t('pages.skills.mcpEndpoint.inactive') }}
            </span>
            <span
              class="text-xs text-muted-foreground"
              data-testid="mcp-tool-count"
            >
              {{ $t('pages.skills.mcpEndpoint.toolsExposed', { count: mcpApi.data.value.tool_count }) }}
            </span>
            <span
              class="text-xs text-muted-foreground"
              data-testid="mcp-last-checked"
            >
              {{ formatRelative(mcpApi.lastCheckedAt.value, now) }}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs">
            <code
              class="rounded bg-muted px-1.5 py-0.5 font-mono"
              data-testid="mcp-url"
            >{{ mcpApi.data.value.url }}</code>
            <UiButton
              size="sm"
              variant="ghost"
              :aria-label="$t('pages.skills.mcpEndpoint.copyUrlAria')"
              data-testid="mcp-copy-url"
              @click="copyMcpUrl"
            >
              <Copy class="mr-1 size-3.5" />
              {{ $t('pages.skills.mcpEndpoint.copy') }}
            </UiButton>
          </div>

          <p
            v-if="mcpApi.data.value.message"
            class="text-xs text-muted-foreground"
            data-testid="mcp-message"
          >
            {{ mcpApi.data.value.message }}
          </p>

          <p class="text-xs text-muted-foreground">
            {{ $t('pages.skills.mcpEndpoint.configBefore') }}<code class="font-mono">{host}/mcp</code>{{ $t('pages.skills.mcpEndpoint.configMid') }}<code class="font-mono">HERMES_AUTH_TOKEN</code>{{ $t('pages.skills.mcpEndpoint.configAfter') }}
          </p>

          <div>
            <button
              type="button"
              class="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              data-testid="mcp-configure"
              @click="scrollToSection('mcp-section')"
            >
              {{ $t('pages.skills.mcpEndpoint.configureButton') }}
            </button>
          </div>
        </template>
      </div>
    </section>

    <!-- ── Tool catalog ────────────────────────────────────────── -->
    <section class="rounded-md border" data-testid="tools-section">
      <header class="border-b p-3">
        <h3 class="text-sm font-semibold">{{ $t('pages.skills.tools.title') }}</h3>
        <p
          v-if="toolsApi.data.value"
          class="mt-0.5 text-xs text-muted-foreground"
          data-testid="tools-count"
        >
          {{ $t('pages.skills.tools.count', { count: toolsApi.data.value.total }) }}
        </p>
        <p v-else class="mt-0.5 text-xs text-muted-foreground">
          {{ $t('pages.skills.tools.subtitle') }}
        </p>
      </header>

      <p
        v-if="toolsApi.loading.value && !toolsApi.data.value"
        class="p-3 text-xs text-muted-foreground"
        data-testid="tools-loading"
      >
        {{ $t('common.loading') }}
      </p>
      <p
        v-else-if="toolsApi.error.value"
        class="p-3 text-xs text-destructive"
        data-testid="tools-error"
      >
        {{ toolsApi.error.value }}
      </p>
      <p
        v-else-if="toolsApi.data.value && toolsApi.data.value.tools.length === 0"
        class="p-3 text-xs text-muted-foreground"
        data-testid="tools-empty"
      >
        {{ $t('pages.skills.tools.empty') }}
      </p>
      <ul
        v-else-if="toolsApi.data.value"
        class="divide-y"
      >
        <li
          v-for="tool in toolsApi.data.value.tools"
          :key="tool.name"
          class="space-y-2 p-3"
          :data-testid="`tool-${tool.name}`"
        >
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p class="font-mono text-sm font-medium">{{ tool.name }}</p>
            <span
              :class="SOURCE_PILL_CLASS"
              :data-testid="`tool-source-${tool.name}`"
            >
              {{ sourceLabel(tool.source) }}
            </span>
            <span
              v-if="tool.requires_approval"
              class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
              :data-testid="`tool-approval-${tool.name}`"
            >
              <ShieldAlert class="size-3" aria-hidden="true" />
              {{ $t('pages.skills.tools.approval') }}
            </span>
          </div>
          <p class="wrap-break-word text-xs text-muted-foreground">
            {{ tool.description }}
          </p>
          <p
            v-if="tool.requires_approval && tool.risk_reason"
            class="wrap-break-word text-xs text-amber-700 dark:text-amber-300"
          >
            {{ tool.risk_reason }}
          </p>

          <button
            type="button"
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            :aria-expanded="expandedToolNames.has(tool.name)"
            :data-testid="`tool-toggle-${tool.name}`"
            @click="toggleTool(tool.name)"
          >
            <ChevronDown
              v-if="expandedToolNames.has(tool.name)"
              class="size-3.5"
              aria-hidden="true"
            />
            <ChevronRight
              v-else
              class="size-3.5"
              aria-hidden="true"
            />
            {{ $t('pages.skills.tools.viewParams') }}
          </button>
          <div
            v-if="expandedToolNames.has(tool.name)"
            :data-testid="`tool-schema-${tool.name}`"
          >
            <p
              v-if="!hasParameters(tool)"
              class="text-xs text-muted-foreground"
            >
              {{ $t('pages.skills.tools.noParams') }}
            </p>
            <pre
              v-else
              class="overflow-x-auto rounded-md bg-muted/40 p-3 text-[11px] leading-snug"
              >{{ prettySchema(tool.parameters_schema) }}</pre>
          </div>

          <div>
            <!--
              Plan 32 sprungpunkt: for MCP-sourced tools the Konfigurieren
              button scrolls to the server's card. Built-in tools have
              no per-tool config surface (Plan 33 added Skills as the
              other modular surface; per-built-in-tool config remains a
              future plan if it's ever justified).
            -->
            <button
              v-if="mcpServerNameForTool(tool.source)"
              type="button"
              class="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
              :data-testid="`tool-configure-${tool.name}`"
              @click="scrollToMcpServer(tool.source)"
            >
              {{ $t('pages.skills.tools.configure') }}
            </button>
            <button
              v-else
              type="button"
              class="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium opacity-50"
              disabled
              :title="$t('pages.skills.tools.builtinNoConfig')"
              :data-testid="`tool-configure-${tool.name}`"
            >
              {{ $t('pages.skills.tools.configure') }}
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
