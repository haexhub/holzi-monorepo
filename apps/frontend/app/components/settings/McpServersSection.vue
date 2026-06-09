<script setup lang="ts">
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash2,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  ServerCog,
  Trash2,
  X,
} from 'lucide-vue-next'
import type {
  McpServer,
  McpServerCreate,
  McpServerStatus,
  McpServerTransport,
  McpServerUpdate,
} from '~/types/api'

// Plan 32 — MCP-Server-Section on /settings/skills.
//
// CRUD over registered external MCP servers. Form is inline (open with
// "Neuer Server" or "Bearbeiten"); the same form serves create + edit
// because the only structural difference is "may name be changed?" (no
// — the slug is part of every tool's `source` so renaming it would
// orphan every persona allowlist downstream).
//
// Auto-refresh every 10 s so the page stays in sync without a manual
// reload — same cadence /settings/diagnostics uses.

const props = defineProps<{
  /** Refresh /api/tools after a server CRUD action so the catalog list
   *  upstream reflects the new MCP-sourced tools without a full page
   *  reload. */
  onCatalogChanged?: () => void
}>()

const mcp = useMcpServers()
const toast = useToast()
const { confirm } = useConfirm()
const { t } = useI18n()

const expandedErrorIds = ref<Set<number>>(new Set())

// Form state. `editingId === null` → create; `editingId === <id>` → edit.
const formOpen = ref(false)
const editingId = ref<number | null>(null)
const submitting = ref(false)
const formError = ref<string | null>(null)
const revealCredentials = ref(false)

type EnvPair = { key: string; value: string }

const draft = reactive({
  name: '',
  display_name: '',
  transport: 'http' as McpServerTransport,
  url: '',
  command: '',
  args: [] as string[],
  env: [] as EnvPair[],
  credentials: '',
  // Edit mode flags: whether the user explicitly cleared the credential
  // or wants to leave the stored one untouched. Sentinel matches the
  // PUT contract (omitted vs null).
  credentialsTouched: false,
})

const restartingId = ref<number | null>(null)
const togglingId = ref<number | null>(null)
const deletingId = ref<number | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void mcp.list()
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void mcp.list()
    }
  }, 10_000)
})

onBeforeUnmount(() => {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

const servers = computed<McpServer[]>(() => mcp.data.value?.servers ?? [])

defineExpose({ scrollTo: (serverId: number) => scrollToServer(serverId) })

function scrollToServer(serverId: number) {
  nextTick(() => {
    document
      .getElementById(`mcp-server-${serverId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

// ── Form helpers ───────────────────────────────────────────────────────

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/

function resetDraft() {
  draft.name = ''
  draft.display_name = ''
  draft.transport = 'http'
  draft.url = ''
  draft.command = ''
  draft.args = []
  draft.env = []
  draft.credentials = ''
  draft.credentialsTouched = false
  revealCredentials.value = false
  formError.value = null
}

function openCreate() {
  resetDraft()
  editingId.value = null
  formOpen.value = true
}

function openEdit(server: McpServer) {
  resetDraft()
  editingId.value = server.id
  draft.name = server.name
  draft.display_name = server.display_name
  draft.transport = server.transport
  draft.url = server.url ?? ''
  const argv = server.command_argv ?? []
  draft.command = argv[0] ?? ''
  draft.args = argv.slice(1)
  draft.env = server.env_keys.map((k) => ({ key: k, value: '' }))
  // Credentials never round-trip — leave the field empty and only treat
  // it as a write when the user actually types into it.
  draft.credentials = ''
  draft.credentialsTouched = false
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
  resetDraft()
}

function addArg() {
  draft.args.push('')
}

function removeArg(idx: number) {
  draft.args.splice(idx, 1)
}

function addEnv() {
  draft.env.push({ key: '', value: '' })
}

function removeEnv(idx: number) {
  draft.env.splice(idx, 1)
}

function clearStoredCredential() {
  draft.credentials = ''
  draft.credentialsTouched = true
}

function nameValid(): boolean {
  return NAME_RE.test(draft.name)
}

function buildCreateBody(): McpServerCreate {
  const body: McpServerCreate = {
    name: draft.name,
    display_name: draft.display_name,
    transport: draft.transport,
    enabled: true,
  }
  if (draft.transport === 'http') {
    body.url = draft.url
    if (draft.credentials) body.credentials = draft.credentials
  } else {
    const argv = [draft.command, ...draft.args.map((a) => a.trim())].filter(
      (p) => p.length > 0,
    )
    body.command_argv = argv
    const env: Record<string, string> = {}
    for (const pair of draft.env) {
      const key = pair.key.trim()
      if (!key) continue
      env[key] = pair.value
    }
    if (Object.keys(env).length > 0) body.env = env
  }
  return body
}

function buildUpdateBody(): McpServerUpdate {
  const body: McpServerUpdate = {
    display_name: draft.display_name,
  }
  if (draft.transport === 'http') {
    body.url = draft.url
    if (draft.credentialsTouched) {
      body.credentials = draft.credentials || null
    }
  } else {
    const argv = [draft.command, ...draft.args.map((a) => a.trim())].filter(
      (p) => p.length > 0,
    )
    body.command_argv = argv
    // env always re-sent on edit — we only show the keys to the user
    // anyway, and re-typing values is the canonical way to "rotate"
    // them. Sending an empty map is a deliberate "clear all env vars".
    const env: Record<string, string> = {}
    for (const pair of draft.env) {
      const key = pair.key.trim()
      if (!key) continue
      env[key] = pair.value
    }
    body.env = env
  }
  return body
}

async function submitForm() {
  formError.value = null
  if (!draft.display_name.trim()) {
    formError.value = t('components.mcpServersSection.errors.displayNameRequired')
    return
  }
  if (editingId.value === null && !nameValid()) {
    formError.value = t('components.mcpServersSection.errors.slugInvalid')
    return
  }
  if (draft.transport === 'http' && !draft.url.trim()) {
    formError.value = t('components.mcpServersSection.errors.urlRequired')
    return
  }
  if (draft.transport === 'stdio' && !draft.command.trim()) {
    formError.value = t('components.mcpServersSection.errors.commandRequired')
    return
  }

  submitting.value = true
  try {
    if (editingId.value === null) {
      await mcp.create(buildCreateBody())
      toast.success(t('components.mcpServersSection.toasts.created'))
    } else {
      await mcp.update(editingId.value, buildUpdateBody())
      toast.success(t('components.mcpServersSection.toasts.updated'))
    }
    props.onCatalogChanged?.()
    closeForm()
  } catch (err: unknown) {
    formError.value = describeError(err)
  } finally {
    submitting.value = false
  }
}

async function restartServer(server: McpServer) {
  restartingId.value = server.id
  try {
    await mcp.restart(server.id)
    toast.success(t('components.mcpServersSection.toasts.restarted', { name: server.display_name }))
    props.onCatalogChanged?.()
  } catch (err: unknown) {
    toast.error(t('components.mcpServersSection.toasts.restartFailed', { error: describeError(err) }))
  } finally {
    restartingId.value = null
  }
}

async function toggleEnabled(server: McpServer) {
  togglingId.value = server.id
  try {
    await mcp.update(server.id, { enabled: !server.enabled })
    props.onCatalogChanged?.()
  } catch (err: unknown) {
    toast.error(describeError(err))
  } finally {
    togglingId.value = null
  }
}

async function deleteServer(server: McpServer) {
  // Guard against a fast double-click: a second invocation while the
  // first DELETE is in flight would either 404 (race-lost) or remove a
  // freshly-recreated row of the same name. Mirrors the restart/toggle
  // single-flight pattern above.
  if (deletingId.value === server.id) return
  const ok = await confirm({
    title: t('components.mcpServersSection.deleteConfirm.title', { name: server.display_name }),
    description: t('components.mcpServersSection.deleteConfirm.description'),
    destructive: true,
    confirmLabel: t('components.mcpServersSection.deleteConfirm.confirm'),
  })
  if (!ok) return
  deletingId.value = server.id
  try {
    await mcp.remove(server.id)
    toast.success(t('components.mcpServersSection.toasts.deleted'))
    props.onCatalogChanged?.()
  } catch (err: unknown) {
    toast.error(describeError(err))
  } finally {
    deletingId.value = null
  }
}

function toggleError(id: number) {
  const next = new Set(expandedErrorIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedErrorIds.value = next
}

function describeError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const data = (err as { data?: { detail?: string } }).data
    if (data?.detail) return data.detail
    const message = (err as { message?: string }).message
    if (message) return message
  }
  return t('components.mcpServersSection.errors.unknown')
}

// ── Display helpers ────────────────────────────────────────────────────

function statusLabel(status: McpServerStatus): string {
  return t(`components.mcpServersSection.status.${status}`)
}
</script>

<template>
  <section
    id="mcp-section"
    class="rounded-md border"
    data-testid="mcp-servers-section"
  >
    <header class="border-b p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="flex items-center gap-2 text-sm font-semibold">
            <ServerCog class="size-4 text-muted-foreground" />
            {{ $t('components.mcpServersSection.title') }}
          </h3>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {{ $t('components.mcpServersSection.subtitle') }}
          </p>
        </div>
        <UiButton
          size="sm"
          variant="outline"
          data-testid="mcp-server-new"
          :disabled="formOpen && editingId === null"
          @click="openCreate"
        >
          <Plus class="mr-1 size-4" />
          {{ $t('components.mcpServersSection.newServer') }}
        </UiButton>
      </div>
    </header>

    <!-- ── Form ────────────────────────────────────────────────── -->
    <div
      v-if="formOpen"
      class="space-y-3 border-b bg-muted/30 p-3"
      data-testid="mcp-server-form"
    >
      <div class="flex items-center justify-between">
        <h4 class="text-sm font-semibold">
          {{ editingId === null ? $t('components.mcpServersSection.form.createTitle') : $t('components.mcpServersSection.form.editTitle') }}
        </h4>
        <UiButton
          size="sm"
          variant="ghost"
          :aria-label="$t('components.mcpServersSection.form.closeAria')"
          data-testid="mcp-server-form-close"
          @click="closeForm"
        >
          <X class="size-4" />
        </UiButton>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1">
          <label class="text-xs font-medium" for="mcp-name">{{ $t('components.mcpServersSection.form.slug') }}</label>
          <UiInput
            id="mcp-name"
            v-model="draft.name"
            :disabled="editingId !== null"
            placeholder="filesystem"
            data-testid="mcp-server-name"
          />
          <p
            v-if="editingId !== null"
            class="text-[11px] text-muted-foreground"
          >
            {{ $t('components.mcpServersSection.form.slugLockedHint') }}
          </p>
          <p
            v-else-if="draft.name && !nameValid()"
            class="text-[11px] text-destructive"
          >
            {{ $t('components.mcpServersSection.form.slugInvalidHint') }}
          </p>
        </div>

        <div class="space-y-1">
          <label class="text-xs font-medium" for="mcp-display-name">
            {{ $t('components.mcpServersSection.form.displayName') }}
          </label>
          <UiInput
            id="mcp-display-name"
            v-model="draft.display_name"
            placeholder="Filesystem MCP"
            data-testid="mcp-server-display-name"
          />
        </div>
      </div>

      <div class="space-y-1">
        <span class="text-xs font-medium">{{ $t('components.mcpServersSection.form.transport') }}</span>
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 rounded-md border px-2 py-1.5 text-xs font-medium"
            :class="
              draft.transport === 'http'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-input text-muted-foreground hover:bg-muted'
            "
            :disabled="editingId !== null && draft.transport !== 'http'"
            data-testid="mcp-server-transport-http"
            @click="draft.transport = 'http'"
          >
            {{ $t('components.mcpServersSection.form.transportHttp') }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-md border px-2 py-1.5 text-xs font-medium"
            :class="
              draft.transport === 'stdio'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-input text-muted-foreground hover:bg-muted'
            "
            :disabled="editingId !== null && draft.transport !== 'stdio'"
            data-testid="mcp-server-transport-stdio"
            @click="draft.transport = 'stdio'"
          >
            {{ $t('components.mcpServersSection.form.transportStdio') }}
          </button>
        </div>
        <p
          v-if="editingId !== null"
          class="text-[11px] text-muted-foreground"
        >
          {{ $t('components.mcpServersSection.form.transportLockedHint') }}
        </p>
      </div>

      <!-- HTTP-spezifische Felder -->
      <template v-if="draft.transport === 'http'">
        <div class="space-y-1">
          <label class="text-xs font-medium" for="mcp-url">{{ $t('components.mcpServersSection.form.url') }}</label>
          <UiInput
            id="mcp-url"
            v-model="draft.url"
            type="url"
            placeholder="https://mcp.example.com/sse"
            data-testid="mcp-server-url"
          />
        </div>

        <div class="space-y-1">
          <label class="text-xs font-medium" for="mcp-credentials">
            {{ $t('components.mcpServersSection.form.credentials') }}
            <span class="font-normal text-muted-foreground">{{ $t('components.mcpServersSection.form.optional') }}</span>
          </label>
          <div class="flex items-center gap-2">
            <UiInput
              id="mcp-credentials"
              v-model="draft.credentials"
              :type="revealCredentials ? 'text' : 'password'"
              :placeholder="
                editingId !== null
                  ? $t('components.mcpServersSection.form.credentialsPlaceholderEdit')
                  : 'eyJhbGc…'
              "
              data-testid="mcp-server-credentials"
              @input="draft.credentialsTouched = true"
            />
            <UiButton
              size="sm"
              variant="outline"
              type="button"
              :aria-label="revealCredentials ? $t('components.mcpServersSection.form.hide') : $t('components.mcpServersSection.form.reveal')"
              data-testid="mcp-server-credentials-reveal"
              @click="revealCredentials = !revealCredentials"
            >
              <EyeOff v-if="revealCredentials" class="size-4" />
              <Eye v-else class="size-4" />
            </UiButton>
          </div>
          <button
            v-if="editingId !== null"
            type="button"
            class="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            data-testid="mcp-server-credentials-clear"
            @click="clearStoredCredential"
          >
            {{ $t('components.mcpServersSection.form.clearCredential') }}
          </button>
        </div>
      </template>

      <!-- stdio-spezifische Felder -->
      <template v-else>
        <div class="space-y-1">
          <label class="text-xs font-medium" for="mcp-command">{{ $t('components.mcpServersSection.form.command') }}</label>
          <UiInput
            id="mcp-command"
            v-model="draft.command"
            placeholder="npx"
            data-testid="mcp-server-command"
          />
        </div>

        <div class="space-y-1">
          <span class="text-xs font-medium">{{ $t('components.mcpServersSection.form.arguments') }}</span>
          <div
            v-for="(arg, idx) in draft.args"
            :key="`arg-${idx}`"
            class="flex items-center gap-2"
          >
            <UiInput
              v-model="draft.args[idx]"
              :data-testid="`mcp-server-arg-${idx}`"
              placeholder="-y"
            />
            <UiButton
              size="sm"
              variant="ghost"
              :aria-label="$t('components.mcpServersSection.form.removeArg')"
              @click="removeArg(idx)"
            >
              <X class="size-4" />
            </UiButton>
          </div>
          <UiButton
            size="sm"
            variant="outline"
            type="button"
            data-testid="mcp-server-arg-add"
            @click="addArg"
          >
            <Plus class="mr-1 size-4" />
            {{ $t('components.mcpServersSection.form.addArg') }}
          </UiButton>
        </div>

        <div class="space-y-1">
          <span class="text-xs font-medium">{{ $t('components.mcpServersSection.form.envVars') }}</span>
          <div
            v-for="(pair, idx) in draft.env"
            :key="`env-${idx}`"
            class="flex items-center gap-2"
          >
            <UiInput
              v-model="pair.key"
              :data-testid="`mcp-server-env-key-${idx}`"
              placeholder="GITHUB_TOKEN"
              class="max-w-45"
            />
            <UiInput
              v-model="pair.value"
              :data-testid="`mcp-server-env-value-${idx}`"
              type="password"
              placeholder="value"
            />
            <UiButton
              size="sm"
              variant="ghost"
              :aria-label="$t('components.mcpServersSection.form.removeEnv')"
              @click="removeEnv(idx)"
            >
              <X class="size-4" />
            </UiButton>
          </div>
          <UiButton
            size="sm"
            variant="outline"
            type="button"
            data-testid="mcp-server-env-add"
            @click="addEnv"
          >
            <Plus class="mr-1 size-4" />
            {{ $t('components.mcpServersSection.form.addEnv') }}
          </UiButton>
          <p
            v-if="editingId !== null && draft.env.length > 0"
            class="text-[11px] text-muted-foreground"
          >
            {{ $t('components.mcpServersSection.form.envHint') }}
          </p>
        </div>
      </template>

      <p
        v-if="formError"
        class="text-xs text-destructive"
        data-testid="mcp-server-form-error"
      >
        {{ formError }}
      </p>

      <div class="flex justify-end gap-2 pt-2">
        <UiButton
          size="sm"
          variant="ghost"
          type="button"
          :disabled="submitting"
          @click="closeForm"
        >
          {{ $t('common.cancel') }}
        </UiButton>
        <UiButton
          size="sm"
          type="button"
          :disabled="submitting"
          data-testid="mcp-server-form-submit"
          @click="submitForm"
        >
          <Loader2 v-if="submitting" class="mr-1 size-4 animate-spin" />
          {{ editingId === null ? $t('components.mcpServersSection.form.submitCreate') : $t('common.save') }}
        </UiButton>
      </div>
    </div>

    <!-- ── Server-Liste ─────────────────────────────────────────── -->
    <p
      v-if="mcp.loading.value && !mcp.data.value"
      class="p-3 text-xs text-muted-foreground"
      data-testid="mcp-servers-loading"
    >
      {{ $t('common.loading') }}
    </p>
    <p
      v-else-if="mcp.error.value"
      class="p-3 text-xs text-destructive"
      data-testid="mcp-servers-error"
    >
      {{ mcp.error.value }}
    </p>
    <p
      v-else-if="servers.length === 0"
      class="p-4 text-xs text-muted-foreground"
      data-testid="mcp-servers-empty"
    >
      {{ $t('components.mcpServersSection.empty') }}
      <button
        type="button"
        class="underline underline-offset-2 hover:text-foreground"
        @click="openCreate"
      >
        {{ $t('components.mcpServersSection.emptyCta') }}
      </button>
    </p>
    <ul v-else class="divide-y" data-testid="mcp-servers-list">
      <li
        v-for="server in servers"
        :id="`mcp-server-${server.id}`"
        :key="server.id"
        class="space-y-2 p-3"
        :data-testid="`mcp-server-${server.name}`"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p class="text-sm font-semibold">{{ server.display_name }}</p>
              <span
                class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                :class="{
                  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400':
                    server.status === 'ready',
                  'bg-amber-500/10 text-amber-600 dark:text-amber-400':
                    server.status === 'starting',
                  'bg-destructive/10 text-destructive':
                    server.status === 'crashed',
                  'bg-muted text-muted-foreground':
                    server.status === 'disabled' ||
                    server.status === 'unknown',
                }"
                :data-testid="`mcp-server-status-${server.name}`"
              >
                <CheckCircle2
                  v-if="server.status === 'ready'"
                  class="size-3"
                />
                <Loader2
                  v-else-if="server.status === 'starting'"
                  class="size-3 animate-spin"
                />
                <AlertCircle
                  v-else-if="server.status === 'crashed'"
                  class="size-3"
                />
                <CircleSlash2
                  v-else
                  class="size-3"
                />
                {{ statusLabel(server.status) }}
              </span>
              <span
                class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                :data-testid="`mcp-server-transport-${server.name}`"
              >
                {{ server.transport }}
              </span>
              <code
                class="font-mono text-[11px] text-muted-foreground"
              >mcp:{{ server.name }}</code>
            </div>
            <p
              v-if="server.transport === 'http' && server.url"
              class="break-all font-mono text-xs text-muted-foreground"
            >
              {{ server.url }}
            </p>
            <p
              v-else-if="server.transport === 'stdio' && server.command_argv"
              class="break-all font-mono text-xs text-muted-foreground"
            >
              {{ server.command_argv.join(' ') }}
            </p>
            <p
              v-if="server.env_keys.length > 0"
              class="text-xs text-muted-foreground"
            >
              {{ $t('components.mcpServersSection.envLabel') }}
              <code
                v-for="key in server.env_keys"
                :key="key"
                class="ml-1 font-mono"
              >{{ key }}</code>
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <UiButton
              size="sm"
              variant="outline"
              :disabled="restartingId === server.id"
              :data-testid="`mcp-server-restart-${server.name}`"
              @click="restartServer(server)"
            >
              <Loader2
                v-if="restartingId === server.id"
                class="size-4 animate-spin"
              />
              <RefreshCcw v-else class="size-4" />
              <span class="ml-1 hidden sm:inline">{{ $t('components.mcpServersSection.restart') }}</span>
            </UiButton>
            <UiButton
              size="sm"
              variant="outline"
              :disabled="togglingId === server.id"
              :data-testid="`mcp-server-toggle-${server.name}`"
              @click="toggleEnabled(server)"
            >
              {{ server.enabled ? $t('components.mcpServersSection.disable') : $t('components.mcpServersSection.enable') }}
            </UiButton>
            <UiButton
              size="sm"
              variant="outline"
              :data-testid="`mcp-server-edit-${server.name}`"
              @click="openEdit(server)"
            >
              <Pencil class="size-4" />
              <span class="ml-1 hidden sm:inline">{{ $t('common.edit') }}</span>
            </UiButton>
            <UiButton
              size="sm"
              variant="outline"
              :disabled="deletingId === server.id"
              :data-testid="`mcp-server-delete-${server.name}`"
              @click="deleteServer(server)"
            >
              <Loader2
                v-if="deletingId === server.id"
                class="size-4 animate-spin"
              />
              <Trash2 v-else class="size-4" />
              <span class="ml-1 hidden sm:inline">{{ $t('common.delete') }}</span>
            </UiButton>
          </div>
        </div>

        <div
          v-if="server.last_error"
          :data-testid="`mcp-server-error-${server.name}`"
        >
          <button
            type="button"
            class="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
            :aria-expanded="expandedErrorIds.has(server.id)"
            @click="toggleError(server.id)"
          >
            <ChevronDown
              v-if="expandedErrorIds.has(server.id)"
              class="size-3.5"
            />
            <ChevronRight v-else class="size-3.5" />
            {{ $t('components.mcpServersSection.crashDetails') }}
          </button>
          <pre
            v-if="expandedErrorIds.has(server.id)"
            class="mt-1 overflow-x-auto rounded-md bg-destructive/5 p-2 text-[11px] text-destructive"
            >{{ server.last_error }}</pre>
        </div>
      </li>
    </ul>
  </section>
</template>
