<script setup lang="ts">
import { BadgeCheck, ExternalLink, Trash2 } from 'lucide-vue-next'
import type {
  LlmCredential,
  LlmCredentialCreate,
  LlmProvider,
} from '~/types/api'

const llm = useLlmCredentials()
const { t } = useI18n()

const credentials = ref<LlmCredential[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// ── Add-API-key form ───────────────────────────────────────────────────
const newProvider = ref<LlmProvider>('anthropic')
const newDisplayName = ref('')
const newApiKey = ref('')
const newBaseUrl = ref('')
const submittingApiKey = ref(false)

const baseUrlRequired = computed(() => newProvider.value === 'custom')

// ── OAuth flow state machine ───────────────────────────────────────────
type OAuthPhase = 'idle' | 'awaiting_code' | 'submitting' | 'done'
const oauthPhase = ref<OAuthPhase>('idle')
const oauthFlowId = ref<number | null>(null)
const oauthUrl = ref<string | null>(null)
const oauthCode = ref('')
const oauthStarting = ref(false)
const oauthPollTimer = ref<ReturnType<typeof setInterval> | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    credentials.value = await llm.list()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : t('pages.llm.errors.load')
  } finally {
    loading.value = false
  }
}

async function addApiKey() {
  const display = newDisplayName.value.trim()
  const key = newApiKey.value.trim()
  const baseUrl = newBaseUrl.value.trim()
  if (!display || !key) return
  if (baseUrlRequired.value && !baseUrl) {
    error.value = t('pages.llm.addKey.errorBaseUrlRequired')
    return
  }
  const body: LlmCredentialCreate = {
    provider: newProvider.value,
    display_name: display,
    api_key: key,
    base_url: baseUrl || null,
  }
  submittingApiKey.value = true
  error.value = null
  try {
    await llm.createApiKey(body)
    newDisplayName.value = ''
    newApiKey.value = ''
    newBaseUrl.value = ''
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : t('pages.llm.errors.save')
  } finally {
    submittingApiKey.value = false
  }
}

async function activate(id: number) {
  try {
    await llm.activate(id)
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : t('pages.llm.errors.activate')
  }
}

async function setModel(cred: LlmCredential, model: string | null) {
  // Optimistic update so the ModelSelect doesn't flicker between picks.
  const previous = cred.model
  cred.model = model
  try {
    await llm.setModel(cred.id, model)
  } catch (err: unknown) {
    cred.model = previous
    error.value = err instanceof Error ? err.message : t('pages.llm.errors.save')
  }
}

async function remove(cred: LlmCredential) {
  if (!confirm(t('pages.llm.list.deleteConfirm', { name: cred.display_name }))) return
  try {
    await llm.delete(cred.id)
    await load()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : t('pages.llm.errors.delete')
  }
}

async function startOAuth() {
  oauthStarting.value = true
  error.value = null
  try {
    const res = await llm.oauthStart()
    oauthFlowId.value = res.id
    oauthUrl.value = res.url
    oauthPhase.value = 'awaiting_code'
    // Auto-open the authorization URL in a new tab.
    if (typeof window !== 'undefined') {
      window.open(res.url, '_blank', 'noopener')
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : t('pages.llm.oauth.startFailed')
    cancelOAuth()
  } finally {
    oauthStarting.value = false
  }
}

async function submitCode() {
  const id = oauthFlowId.value
  const code = oauthCode.value.trim()
  if (id === null || !code) return
  oauthPhase.value = 'submitting'
  error.value = null
  try {
    await llm.oauthSubmitCode(id, code)
    // Don't flip to 'done' yet — wait for /status to confirm authorized.
    // If the CLI exits 0 but a refresh somehow leaves the row 'expired',
    // pollOAuthStatus surfaces that instead of falsely celebrating.
    pollOAuthStatus()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : t('pages.llm.oauth.codeRejected')
    oauthPhase.value = 'awaiting_code'
  }
}

function pollOAuthStatus() {
  const id = oauthFlowId.value
  if (id === null) return
  if (oauthPollTimer.value) {
    clearInterval(oauthPollTimer.value)
  }
  oauthPollTimer.value = setInterval(async () => {
    try {
      const res = await llm.oauthStatus(id)
      if (res.status === 'authorized') {
        stopPolling()
        oauthPhase.value = 'done'
        await load()
        resetOAuth()
      } else if (res.status === 'expired') {
        stopPolling()
        error.value = t('pages.llm.oauth.expired')
        oauthPhase.value = 'idle'
        await load()
      }
    } catch (err: unknown) {
      // 404 once the row got deleted by /cancel — stop polling silently.
      stopPolling()
      error.value = err instanceof Error ? err.message : t('pages.llm.oauth.statusPollFailed')
    }
  }, 1000)
}

function stopPolling() {
  if (oauthPollTimer.value) {
    clearInterval(oauthPollTimer.value)
    oauthPollTimer.value = null
  }
}

function resetOAuth() {
  oauthPhase.value = 'idle'
  oauthFlowId.value = null
  oauthUrl.value = null
  oauthCode.value = ''
}

async function cancelOAuth() {
  stopPolling()
  const id = oauthFlowId.value
  resetOAuth()
  if (id !== null) {
    try {
      await llm.oauthCancel(id)
    } catch {
      // Best-effort — the row may already be gone (timeout / completed).
    }
    await load()
  }
}

function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function modeBadge(c: LlmCredential): string {
  if (c.mode === 'oauth_claude') {
    return c.oauth_status === 'authorized'
      ? t('pages.llm.modeBadge.oauthClaude')
      : t('pages.llm.modeBadge.oauthClaudeStatus', { status: c.oauth_status ?? '?' })
  }
  return t('pages.llm.modeBadge.apiKey')
}

/**
 * Pending / expired OAuth rows have no usable ciphertext — activating them
 * leaves the proxy without a token and chat 503s. We block the action in the
 * UI and the backend also rejects with 409, but the badge gives the user a
 * clear "this credential isn't ready" signal.
 */
function isOAuthUnready(c: LlmCredential): boolean {
  return c.mode === 'oauth_claude' && c.oauth_status !== 'authorized'
}

onMounted(load)
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h2 class="text-base font-semibold">{{ $t('pages.llm.title') }}</h2>
      <p class="text-sm text-muted-foreground">
        {{ $t('pages.llm.description') }}
      </p>
    </div>

    <p v-if="error" class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {{ error }}
    </p>

    <!-- ── Liste ─────────────────────────────────────────────────────── -->
    <section class="space-y-2">
      <h2 class="text-sm font-semibold uppercase text-muted-foreground">
        {{ $t('pages.llm.list.heading') }}
      </h2>
      <p v-if="loading" class="text-sm text-muted-foreground">{{ $t('common.loading') }}</p>
      <p v-else-if="credentials.length === 0" class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        {{ $t('pages.llm.list.empty') }}
      </p>
      <div
        v-for="c in credentials"
        :key="c.id"
        class="flex flex-col gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-center"
      >
        <BadgeCheck v-if="c.is_active" class="hidden size-4 text-emerald-500 sm:block" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <BadgeCheck v-if="c.is_active" class="size-4 text-emerald-500 sm:hidden" />
            <span class="font-medium">{{ c.display_name }}</span>
            <span class="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
              {{ c.provider }}
            </span>
            <span class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {{ modeBadge(c) }}
            </span>
            <span v-if="c.is_active" class="text-xs font-medium text-emerald-600">
              {{ $t('pages.llm.list.active') }}
            </span>
          </div>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {{ $t('pages.llm.list.createdAt', { timestamp: formatTimestamp(c.created_at) }) }}
            <template v-if="c.oauth_authorized_at">
              · {{ $t('pages.llm.list.authorizedAt', { timestamp: formatTimestamp(c.oauth_authorized_at) }) }}
            </template>
          </p>
          <p v-if="isOAuthUnready(c)" class="mt-1 text-xs text-amber-600">
            {{ $t('pages.llm.list.oauthNotReady') }}
          </p>
          <div class="mt-2 w-full max-w-md">
            <SettingsModelSelect
              :model-value="c.model"
              :credential-id="c.id"
              :disabled="isOAuthUnready(c)"
              @update:model-value="(v) => setModel(c, v)"
            />
          </div>
        </div>
        <UiButton
          v-if="!c.is_active && !isOAuthUnready(c)"
          size="sm"
          variant="secondary"
          @click="activate(c.id)"
        >
          {{ $t('pages.llm.list.activate') }}
        </UiButton>
        <UiButton
          size="sm"
          variant="ghost"
          :aria-label="$t('pages.llm.list.deleteAria', { name: c.display_name })"
          :title="$t('pages.llm.list.deleteAria', { name: c.display_name })"
          @click="remove(c)"
        >
          <Trash2 class="size-3.5" />
        </UiButton>
      </div>
    </section>

    <UiSeparator />

    <!-- ── API-Key hinzufügen ───────────────────────────────────────── -->
    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase text-muted-foreground">
        {{ $t('pages.llm.addKey.heading') }}
      </h2>
      <form class="space-y-3" @submit.prevent="addApiKey">
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <UiLabel for="provider">{{ $t('pages.llm.addKey.provider') }}</UiLabel>
            <select
              id="provider"
              v-model="newProvider"
              class="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="anthropic">anthropic</option>
              <option value="openai">openai</option>
              <option value="openrouter">openrouter</option>
              <option value="google">google</option>
              <option value="custom">custom</option>
            </select>
          </div>
          <div class="space-y-1">
            <UiLabel for="display">{{ $t('pages.llm.addKey.displayName') }}</UiLabel>
            <UiInput
              id="display"
              v-model="newDisplayName"
              :placeholder="$t('pages.llm.addKey.displayNamePlaceholder')"
            />
          </div>
        </div>
        <div class="space-y-1">
          <UiLabel for="apikey">{{ $t('pages.llm.addKey.apiKey') }}</UiLabel>
          <UiInput
            id="apikey"
            v-model="newApiKey"
            type="password"
            :placeholder="$t('pages.llm.addKey.apiKeyPlaceholder')"
            autocomplete="off"
          />
        </div>
        <div class="space-y-1">
          <UiLabel for="baseurl">
            {{ $t('pages.llm.addKey.baseUrl') }}
            <span class="text-xs text-muted-foreground">
              ({{ baseUrlRequired ? $t('pages.llm.addKey.baseUrlRequired') : $t('pages.llm.addKey.baseUrlOptional') }})
            </span>
          </UiLabel>
          <UiInput
            id="baseurl"
            v-model="newBaseUrl"
            :placeholder="$t('pages.llm.addKey.baseUrlPlaceholder')"
          />
        </div>
        <UiButton type="submit" :disabled="submittingApiKey" size="sm">
          {{ submittingApiKey ? $t('pages.llm.addKey.submitting') : $t('pages.llm.addKey.submit') }}
        </UiButton>
      </form>
    </section>

    <UiSeparator />

    <!-- ── Claude OAuth ─────────────────────────────────────────────── -->
    <section class="space-y-3">
      <h2 class="text-sm font-semibold uppercase text-muted-foreground">
        {{ $t('pages.llm.oauth.heading') }}
      </h2>

      <div v-if="oauthPhase === 'idle'">
        <p class="text-sm text-muted-foreground">
          {{ $t('pages.llm.oauth.intro', { command: 'claude auth login --claudeai' }) }}
        </p>
        <UiButton class="mt-2" size="sm" :disabled="oauthStarting" @click="startOAuth">
          {{ oauthStarting ? $t('pages.llm.oauth.starting') : $t('pages.llm.oauth.start') }}
        </UiButton>
      </div>

      <div v-else-if="oauthPhase === 'awaiting_code'" class="space-y-2">
        <p class="text-sm">
          {{ $t('pages.llm.oauth.awaitingCode') }}
        </p>
        <a
          v-if="oauthUrl"
          :href="oauthUrl"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          <ExternalLink class="size-3" />
          {{ $t('pages.llm.oauth.reopenTab') }}
        </a>
        <form class="flex gap-2" @submit.prevent="submitCode">
          <UiInput
            v-model="oauthCode"
            :placeholder="$t('pages.llm.oauth.codePlaceholder')"
            autocomplete="off"
            class="flex-1"
          />
          <UiButton type="submit" size="sm" :disabled="!oauthCode.trim()">
            {{ $t('pages.llm.oauth.submit') }}
          </UiButton>
          <UiButton type="button" variant="ghost" size="sm" @click="cancelOAuth">
            {{ $t('common.cancel') }}
          </UiButton>
        </form>
      </div>

      <div v-else-if="oauthPhase === 'submitting'" class="text-sm text-muted-foreground">
        {{ $t('pages.llm.oauth.submitting') }}
      </div>

      <div v-else-if="oauthPhase === 'done'" class="text-sm text-emerald-600">
        {{ $t('pages.llm.oauth.done') }}
      </div>
    </section>
  </div>
</template>
