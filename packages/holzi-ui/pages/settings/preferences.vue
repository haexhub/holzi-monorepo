<script setup lang="ts">
import {
  BadgeCheck,
  Check,
  History,
  Languages,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-vue-next'
import { translateError } from '~/lib/errorMessages'
import type {
  ChannelPrompt,
  LlmCredential,
  Persona,
  PersonaHistoryItem,
} from '~/types/api'

// Plan 29-A /settings/preferences. Two stacked sections:
//   1. Personas — CRUD over `personas`. The single-default invariant
//      is enforced by the backend; the UI just disables the delete
//      button on the default and swaps to "Als Default setzen" on
//      non-defaults.
//   2. Channels — one card per row from `GET /api/channels` (i.e. one
//      per registry entry). Each card has a persona dropdown plus a
//      prompt textarea, and shows a "Reset"-button when the prompt is
//      no longer the channel's `default_prompt`. Driving the cards off
//      the API response means a new backend channel renders without a
//      FE change.

const personasApi = usePersonas()
const channelsApi = useChannels()
const credentialsApi = useLlmCredentials()
const { confirm } = useConfirm()
// useScope: 'global' is required so `setLocale` is the @nuxtjs/i18n-
// augmented method (does router navigation + cookie persistence). The
// composition-API default scope returns a *local* composer that has no
// setLocale — calling it would silently noop.
const { t, locale, setLocale } = useI18n({ useScope: 'global' })
const localePath = useLocalePath()

// Plan 30 Wave 0 — Sprach-Picker section. Locale is persisted via the
// i18n-cookie (configured in nuxt.config); when Wave C (multi-user)
// lands this moves into per-user preferences.
type SupportedLocale = 'de' | 'en'
const SUPPORTED_LOCALES: { code: SupportedLocale; key: string }[] = [
  { code: 'de', key: 'pages.preferences.language.options.de' },
  { code: 'en', key: 'pages.preferences.language.options.en' },
]
async function onLocaleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as SupportedLocale
  await setLocale(value)
}

const personas = ref<Persona[]>([])
const channels = ref<ChannelPrompt[]>([])
const credentials = ref<LlmCredential[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const [pers, chans, creds] = await Promise.all([
      personasApi.list(),
      channelsApi.list(),
      credentialsApi.list(),
    ])
    personas.value = pers.personas
    channels.value = chans.channels
    credentials.value = creds
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : t('pages.preferences.personas.errors.load')
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ────────────────────────────────────────────────────────────────────
// Personas
// ────────────────────────────────────────────────────────────────────

// One inline editor at a time — id of the persona currently in edit
// mode, or 'new' for the "Neue Persona"-form, or null for no editor.
type EditTarget = number | 'new' | null
const editing = ref<EditTarget>(null)
const formName = ref('')
// Plan 36 (Wave A1): the single `prompt` column was split into three
// fragments (soul / identity / agents). The form binds to one ref per
// fragment; the submit payload concatenates them into the API body.
const formSoul = ref('')
const formIdentity = ref('')
const formAgents = ref('')
const formIsDefault = ref(false)
// Plan 29-D (Wave B1): per-persona LLM credential + model override.
const formCredentialId = ref<number | null>(null)
const formModel = ref<string | null>(null)
const formError = ref<string | null>(null)
const saving = ref(false)
// Guards the "Als Default setzen" + "Löschen" buttons against double-
// clicks — those mutations don't go through the form (no `saving`
// flag) so they need their own latch. Held for the whole request +
// its trailing `load()`.
const personaMutating = ref(false)

// Plan 36 / Wave A1 — per-persona history-subview state. Loaded lazily
// when the `<details>` toggles open; `restoring` is a per-persona latch
// for the restore-button so two cards can restore independently.
const personaHistory = ref<Record<number, PersonaHistoryItem[]>>({})
const historyLoading = ref<Record<number, boolean>>({})
const restoring = ref<Record<number, boolean>>({})

function openCreate() {
  editing.value = 'new'
  formName.value = ''
  formSoul.value = ''
  formIdentity.value = ''
  formAgents.value = ''
  formIsDefault.value = false
  formCredentialId.value = null
  formModel.value = null
  formError.value = null
}

function openEdit(persona: Persona) {
  editing.value = persona.id
  formName.value = persona.name
  formSoul.value = persona.soul
  formIdentity.value = persona.identity
  formAgents.value = persona.agents
  formIsDefault.value = persona.is_default
  formCredentialId.value = persona.llm_credential_id ?? null
  formModel.value = persona.model ?? null
  formError.value = null
}

function cancelEdit() {
  editing.value = null
  formError.value = null
  formCredentialId.value = null
  formModel.value = null
}

async function submitPersonaForm() {
  const name = formName.value.trim()
  // Send trimmed fragments so save-and-reload doesn't visually shift
  // content if the backend strips on its side.
  const soul = formSoul.value.trim()
  const identity = formIdentity.value.trim()
  const agents = formAgents.value.trim()
  if (!name) {
    formError.value = t('pages.preferences.personas.errors.nameRequired')
    return
  }
  // Backend rejects with PERSONA_FRAGMENTS_ALL_EMPTY when all three are
  // blank; mirror the check on the FE so we don't round-trip the form
  // just to surface that.
  if (!soul && !identity && !agents) {
    formError.value = t('errors.PERSONA_FRAGMENTS_ALL_EMPTY')
    return
  }
  saving.value = true
  formError.value = null
  try {
    if (editing.value === 'new') {
      await personasApi.create({
        name,
        soul,
        identity,
        agents,
        is_default: formIsDefault.value,
      })
    } else if (typeof editing.value === 'number') {
      await personasApi.update(editing.value, {
        name,
        soul,
        identity,
        agents,
        is_default: formIsDefault.value,
        llm_credential_id: formCredentialId.value,
        model: formModel.value,
      })
    }
    await load()
    editing.value = null
  } catch (err: unknown) {
    formError.value = translateError(err, t)
  } finally {
    saving.value = false
  }
}

async function setDefaultPersona(persona: Persona) {
  if (personaMutating.value) return
  personaMutating.value = true
  error.value = null
  try {
    await personasApi.update(persona.id, { is_default: true })
    await load()
  } catch (err: unknown) {
    error.value = translateError(err, t)
  } finally {
    personaMutating.value = false
  }
}

async function deletePersona(persona: Persona) {
  if (personaMutating.value) return
  const ok = await confirm({
    title: t('pages.preferences.personas.deleteConfirm.title'),
    description: t('pages.preferences.personas.deleteConfirm.description', { name: persona.name }),
    destructive: true,
  })
  if (!ok) return
  personaMutating.value = true
  error.value = null
  try {
    await personasApi.delete(persona.id)
    await load()
  } catch (err: unknown) {
    error.value = translateError(err, t)
  } finally {
    personaMutating.value = false
  }
}

// ── History-Subview (Plan 36 / Wave A1) ─────────────────────────────

async function loadHistory(persona: Persona) {
  if (historyLoading.value[persona.id]) return
  historyLoading.value[persona.id] = true
  try {
    const resp = await personasApi.history(persona.id)
    personaHistory.value[persona.id] = resp.history
  } catch (err: unknown) {
    error.value = translateError(err, t)
  } finally {
    historyLoading.value[persona.id] = false
  }
}

function onHistoryToggle(persona: Persona, ev: Event) {
  const target = ev.target as HTMLDetailsElement
  // Lazy-load on first open; subsequent opens reuse the cached list
  // until a successful restore refreshes it.
  if (target.open && personaHistory.value[persona.id] === undefined) {
    void loadHistory(persona)
  }
}

function historyFor(personaId: number): PersonaHistoryItem[] {
  return personaHistory.value[personaId] ?? []
}

function formatHistoryDate(unixSeconds: number): string {
  // Native Intl via the active i18n locale — same approach as the rest
  // of the page (no extra date-fmt dep). Backend stores seconds.
  return new Date(unixSeconds * 1000).toLocaleString(locale.value)
}

async function restoreSnapshot(persona: Persona, entry: PersonaHistoryItem) {
  if (restoring.value[persona.id]) return
  const ok = await confirm({
    title: t('pages.preferences.personas.history.restoreConfirm.title'),
    description: t(
      'pages.preferences.personas.history.restoreConfirm.description',
      { name: persona.name, author: entry.author },
    ),
    destructive: false,
  })
  if (!ok) return
  restoring.value[persona.id] = true
  try {
    await personasApi.restoreHistory(persona.id, entry.id)
    await load()
    // The restore itself appends a new snapshot row, so the visible
    // list is stale until reloaded.
    await loadHistory(persona)
  } catch (err: unknown) {
    error.value = translateError(err, t)
  } finally {
    restoring.value[persona.id] = false
  }
}

// ────────────────────────────────────────────────────────────────────
// Channels
// ────────────────────────────────────────────────────────────────────

// Per-channel transient state: the textarea binds to a draft prompt and
// the dropdown binds to a draft persona id (null = global default). On
// "Speichern" we diff against the persisted row and only PUT what
// changed; on `load()` we refresh both back to the persisted values.
interface ChannelDraft {
  prompt: string
  // string here because <select> values are strings; "" means "global
  // default" (sent as null) and any other string is the persona id.
  defaultPersonaId: string
  saving: boolean
  error: string | null
}

const channelDrafts = ref<Record<string, ChannelDraft>>({})

function emptyDraft(channel: ChannelPrompt): ChannelDraft {
  return {
    prompt: channel.prompt,
    defaultPersonaId:
      channel.default_persona_id === null
        ? ''
        : String(channel.default_persona_id),
    saving: false,
    error: null,
  }
}

function draftFor(channel: ChannelPrompt): ChannelDraft {
  let draft = channelDrafts.value[channel.channel]
  if (draft === undefined) {
    // Race-safe init: a v-model binding may try to read the draft before
    // the watch below has populated it (template renders synchronously
    // on the first paint while the watch fires in microtask order).
    draft = emptyDraft(channel)
    channelDrafts.value[channel.channel] = draft
  }
  return draft
}

// Preserve in-flight channel-draft edits across reloads. A persona
// mutation (set-default, delete) reloads both lists; without this
// merge, the unconditional reseed would silently wipe an unsaved
// channel-prompt edit. Heuristic: if the existing draft equals what
// was persisted just before this fire, it's untouched → reseed to the
// new server value. Otherwise the user has uncommitted edits → keep
// the draft as-is. Single-user app, so an external mutation on the
// same channel mid-edit is not a real scenario.
function isPersisted(draft: ChannelDraft, channel: ChannelPrompt): boolean {
  const persistedId =
    channel.default_persona_id === null
      ? ''
      : String(channel.default_persona_id)
  return (
    draft.prompt === channel.prompt
    && draft.defaultPersonaId === persistedId
  )
}

watch(
  channels,
  (next, prev) => {
    const prevByKey = new Map(
      (prev ?? []).map((c) => [c.channel, c] as const),
    )
    const merged: Record<string, ChannelDraft> = {}
    for (const c of next) {
      const existing = channelDrafts.value[c.channel]
      const prior = prevByKey.get(c.channel)
      // Preserve only when the draft existed AND it's still in sync
      // with the prior persisted snapshot — anything else means the
      // user has edits (or this is the first paint).
      if (existing !== undefined && prior !== undefined && !isPersisted(existing, prior)) {
        merged[c.channel] = existing
      } else {
        merged[c.channel] = emptyDraft(c)
      }
    }
    channelDrafts.value = merged
  },
  { immediate: true },
)

function channelDirty(channel: ChannelPrompt): boolean {
  const draft = draftFor(channel)
  const promptChanged = draft.prompt !== channel.prompt
  const personaChanged =
    (draft.defaultPersonaId === '' ? null : Number(draft.defaultPersonaId))
    !== channel.default_persona_id
  return promptChanged || personaChanged
}

async function saveChannel(channel: ChannelPrompt) {
  const draft = draftFor(channel)
  draft.saving = true
  draft.error = null
  try {
    const body: {
      prompt?: string
      default_persona_id?: number | null
    } = {}
    if (draft.prompt !== channel.prompt) body.prompt = draft.prompt
    const wantedPid =
      draft.defaultPersonaId === '' ? null : Number(draft.defaultPersonaId)
    if (wantedPid !== channel.default_persona_id) {
      body.default_persona_id = wantedPid
    }
    await channelsApi.update(channel.channel, body)
    await load()
  } catch (err: unknown) {
    draft.error = translateError(err, t)
  } finally {
    draft.saving = false
  }
}

async function resetChannelPrompt(channel: ChannelPrompt) {
  const ok = await confirm({
    title: t('pages.preferences.channels.resetConfirm.title'),
    description: t(
      'pages.preferences.channels.resetConfirm.description',
      { label: channel.label },
    ),
    destructive: false,
  })
  if (!ok) return
  const draft = draftFor(channel)
  draft.saving = true
  draft.error = null
  try {
    await channelsApi.reset(channel.channel)
    await load()
  } catch (err: unknown) {
    draft.error = translateError(err, t)
  } finally {
    draft.saving = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-8" data-testid="preferences-page">
    <header class="flex items-center gap-2">
      <SlidersHorizontal class="size-5 text-muted-foreground" />
      <h2 class="text-base font-semibold">Preferences</h2>
    </header>

    <p
      v-if="error"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
      data-testid="preferences-global-error"
    >
      {{ error }}
    </p>

    <p v-if="loading" class="text-sm text-muted-foreground">{{ $t('common.loading') }}</p>

    <!-- ── Section 1: Sprache / Language (Plan 30) ─────────────────── -->
    <!-- Picker comes first so a user landing on `/settings/preferences`
         in the wrong locale can switch before reading anything else. -->
    <section class="flex flex-col gap-4" data-testid="language-section">
      <div class="flex items-center gap-2">
        <Languages class="size-4 text-muted-foreground" />
        <div>
          <h3 class="text-sm font-semibold">
            {{ $t('pages.preferences.language.title') }}
          </h3>
          <p class="text-xs text-muted-foreground">
            {{ $t('pages.preferences.language.description') }}
          </p>
        </div>
      </div>
      <div class="flex max-w-xs flex-col gap-1">
        <label
          for="language-select"
          class="text-xs font-medium text-muted-foreground"
        >
          {{ $t('pages.preferences.language.label') }}
        </label>
        <select
          id="language-select"
          class="h-9 rounded-md border bg-background px-2 text-sm"
          :value="locale"
          data-testid="language-select"
          @change="onLocaleChange"
        >
          <option
            v-for="opt in SUPPORTED_LOCALES"
            :key="opt.code"
            :value="opt.code"
          >
            {{ $t(opt.key) }}
          </option>
        </select>
      </div>
    </section>

    <!-- ── Section 2: Personas ─────────────────────────────────────── -->
    <!-- Section stays mounted across reload()-cycles so the per-persona
         <details> history block doesn't lose its open-state when a
         mutation (set-default / delete / restore) triggers a refresh.
         The top-level "loading" indicator above still signals progress;
         the list shows stale data for one paint until load() resolves. -->
    <section
      v-show="!loading || personas.length > 0"
      class="flex flex-col gap-4"
      data-testid="personas-section"
    >
      <div class="flex items-end justify-between gap-2">
        <div>
          <h3 class="text-sm font-semibold">
            {{ $t('pages.preferences.personas.title') }}
          </h3>
          <p class="text-xs text-muted-foreground">
            {{ $t('pages.preferences.personas.subtitle') }}
          </p>
        </div>
        <UiButton
          v-if="editing !== 'new'"
          size="sm"
          variant="outline"
          data-testid="personas-new-button"
          @click="openCreate"
        >
          <Plus class="mr-1 size-3.5" /> {{ $t('pages.preferences.personas.newButton') }}
        </UiButton>
      </div>

      <!-- Create form (inline) -->
      <form
        v-if="editing === 'new'"
        class="flex flex-col gap-3 rounded-md border p-4"
        data-testid="personas-create-form"
        @submit.prevent="submitPersonaForm"
      >
        <div class="flex flex-col gap-1">
          <label
            for="persona-create-name"
            class="text-xs font-medium text-muted-foreground"
          >
            {{ $t('pages.preferences.personas.form.name') }}
          </label>
          <UiInput
            id="persona-create-name"
            v-model="formName"
            :placeholder="$t('pages.preferences.personas.form.namePlaceholder')"
            data-testid="personas-form-name"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label
            for="persona-create-soul"
            class="text-xs font-medium text-muted-foreground"
          >
            {{ $t('pages.preferences.personas.fragments.soul.label') }}
          </label>
          <p class="text-[11px] text-muted-foreground">
            {{ $t('pages.preferences.personas.fragments.soul.description') }}
          </p>
          <UiTextarea
            id="persona-create-soul"
            v-model="formSoul"
            class="min-h-24 font-mono text-sm"
            spellcheck="false"
            :placeholder="$t('pages.preferences.personas.fragments.soul.placeholder')"
            data-testid="personas-form-soul"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label
            for="persona-create-identity"
            class="text-xs font-medium text-muted-foreground"
          >
            {{ $t('pages.preferences.personas.fragments.identity.label') }}
          </label>
          <p class="text-[11px] text-muted-foreground">
            {{ $t('pages.preferences.personas.fragments.identity.description') }}
          </p>
          <UiTextarea
            id="persona-create-identity"
            v-model="formIdentity"
            class="min-h-24 font-mono text-sm"
            spellcheck="false"
            :placeholder="$t('pages.preferences.personas.fragments.identity.placeholder')"
            data-testid="personas-form-identity"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label
            for="persona-create-agents"
            class="text-xs font-medium text-muted-foreground"
          >
            {{ $t('pages.preferences.personas.fragments.agents.label') }}
          </label>
          <p class="text-[11px] text-muted-foreground">
            {{ $t('pages.preferences.personas.fragments.agents.description') }}
          </p>
          <UiTextarea
            id="persona-create-agents"
            v-model="formAgents"
            class="min-h-24 font-mono text-sm"
            spellcheck="false"
            :placeholder="$t('pages.preferences.personas.fragments.agents.placeholder')"
            data-testid="personas-form-agents"
          />
        </div>
        <label class="flex items-center gap-2 text-xs">
          <input
            v-model="formIsDefault"
            type="checkbox"
            data-testid="personas-form-default"
          />
          {{ $t('pages.preferences.personas.form.isDefault') }}
        </label>
        <p
          v-if="formError"
          class="text-sm text-destructive"
          data-testid="personas-form-error"
        >
          {{ formError }}
        </p>
        <div class="flex gap-2">
          <UiButton size="sm" type="submit" :disabled="saving">
            <Check class="mr-1 size-3.5" /> {{ $t('common.save') }}
          </UiButton>
          <UiButton
            size="sm"
            variant="ghost"
            type="button"
            @click="cancelEdit"
          >
            <X class="mr-1 size-3.5" /> {{ $t('common.cancel') }}
          </UiButton>
        </div>
      </form>

      <!-- Persona cards -->
      <ul class="flex flex-col gap-3">
        <li
          v-for="persona in personas"
          :key="persona.id"
          class="rounded-md border p-4"
          :data-testid="`persona-card-${persona.id}`"
        >
          <!-- Edit form (inline) -->
          <form
            v-if="editing === persona.id"
            class="flex flex-col gap-3"
            data-testid="personas-edit-form"
            @submit.prevent="submitPersonaForm"
          >
            <div class="flex flex-col gap-1">
              <label
                for="persona-edit-name"
                class="text-xs font-medium text-muted-foreground"
              >
                {{ $t('pages.preferences.personas.form.name') }}
              </label>
              <UiInput id="persona-edit-name" v-model="formName" />
            </div>
            <div class="flex flex-col gap-1">
              <label
                for="persona-edit-soul"
                class="text-xs font-medium text-muted-foreground"
              >
                {{ $t('pages.preferences.personas.fragments.soul.label') }}
              </label>
              <p class="text-[11px] text-muted-foreground">
                {{ $t('pages.preferences.personas.fragments.soul.description') }}
              </p>
              <UiTextarea
                id="persona-edit-soul"
                v-model="formSoul"
                class="min-h-24 font-mono text-sm"
                spellcheck="false"
                :placeholder="$t('pages.preferences.personas.fragments.soul.placeholder')"
                data-testid="personas-form-soul"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label
                for="persona-edit-identity"
                class="text-xs font-medium text-muted-foreground"
              >
                {{ $t('pages.preferences.personas.fragments.identity.label') }}
              </label>
              <p class="text-[11px] text-muted-foreground">
                {{ $t('pages.preferences.personas.fragments.identity.description') }}
              </p>
              <UiTextarea
                id="persona-edit-identity"
                v-model="formIdentity"
                class="min-h-24 font-mono text-sm"
                spellcheck="false"
                :placeholder="$t('pages.preferences.personas.fragments.identity.placeholder')"
                data-testid="personas-form-identity"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label
                for="persona-edit-agents"
                class="text-xs font-medium text-muted-foreground"
              >
                {{ $t('pages.preferences.personas.fragments.agents.label') }}
              </label>
              <p class="text-[11px] text-muted-foreground">
                {{ $t('pages.preferences.personas.fragments.agents.description') }}
              </p>
              <UiTextarea
                id="persona-edit-agents"
                v-model="formAgents"
                class="min-h-24 font-mono text-sm"
                spellcheck="false"
                :placeholder="$t('pages.preferences.personas.fragments.agents.placeholder')"
                data-testid="personas-form-agents"
              />
            </div>
            <!-- Credential dropdown (Plan 29-D) -->
            <div class="flex flex-col gap-1">
              <label
                :for="`persona-cred-${persona.id}`"
                class="text-xs font-medium text-muted-foreground"
              >
                {{ $t('pages.preferences.personas.form.credential') }}
              </label>
              <select
                :id="`persona-cred-${persona.id}`"
                v-model="formCredentialId"
                class="h-9 rounded-md border bg-background px-2 text-sm"
                :data-testid="`persona-cred-select-${persona.id}`"
                @change="formModel = null"
              >
                <option :value="null">{{ $t('pages.preferences.personas.form.credentialGlobalOption') }}</option>
                <option v-for="cred in credentials" :key="cred.id" :value="cred.id">
                  {{ cred.display_name }}
                </option>
              </select>
            </div>
            <!-- Model dropdown (Plan 29-D-A) -->
            <div class="flex flex-col gap-1">
              <label
                :for="`persona-model-${persona.id}`"
                class="text-xs font-medium text-muted-foreground"
              >
                {{ $t('pages.preferences.personas.form.model') }}
              </label>
              <SettingsModelSelect
                :id="`persona-model-${persona.id}`"
                v-model="formModel"
                :credential-id="formCredentialId"
                :test-id="`persona-model-select-${persona.id}`"
                clearable
              />
            </div>
            <label class="flex items-center gap-2 text-xs">
              <input v-model="formIsDefault" type="checkbox" />
              {{ $t('pages.preferences.personas.form.isDefaultShort') }}
            </label>
            <p v-if="formError" class="text-sm text-destructive">
              {{ formError }}
            </p>
            <div class="flex gap-2">
              <UiButton size="sm" type="submit" :disabled="saving" :data-testid="`persona-save-${persona.id}`">
                <Check class="mr-1 size-3.5" /> {{ $t('common.save') }}
              </UiButton>
              <UiButton
                size="sm"
                variant="ghost"
                type="button"
                @click="cancelEdit"
              >
                <X class="mr-1 size-3.5" /> {{ $t('common.cancel') }}
              </UiButton>
            </div>
          </form>

          <!-- Read view -->
          <div v-else class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <h4 class="text-sm font-semibold">{{ persona.name }}</h4>
                <span
                  v-if="persona.is_default"
                  class="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                  data-testid="persona-default-badge"
                >
                  <BadgeCheck class="size-3" />
                  {{ $t('pages.preferences.personas.defaultBadge') }}
                </span>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <UiButton
                  size="sm"
                  variant="ghost"
                  :aria-label="$t('pages.preferences.personas.editAria')"
                  :data-testid="`persona-edit-${persona.id}`"
                  @click="openEdit(persona)"
                >
                  <Pencil class="size-4" />
                </UiButton>
                <UiButton
                  v-if="!persona.is_default"
                  size="sm"
                  variant="outline"
                  :disabled="personaMutating"
                  :data-testid="`persona-set-default-${persona.id}`"
                  @click="setDefaultPersona(persona)"
                >
                  {{ $t('pages.preferences.personas.setDefault') }}
                </UiButton>
                <UiButton
                  size="sm"
                  variant="ghost"
                  :aria-label="$t('pages.preferences.personas.deleteAria')"
                  :disabled="persona.is_default || personaMutating"
                  :data-testid="`persona-delete-${persona.id}`"
                  @click="deletePersona(persona)"
                >
                  <Trash2 class="size-4" />
                </UiButton>
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <div v-if="persona.soul" class="flex flex-col gap-0.5">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {{ $t('pages.preferences.personas.fragments.soul.label') }}
                </span>
                <pre class="line-clamp-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{{ persona.soul }}</pre>
              </div>
              <div v-if="persona.identity" class="flex flex-col gap-0.5">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {{ $t('pages.preferences.personas.fragments.identity.label') }}
                </span>
                <pre class="line-clamp-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{{ persona.identity }}</pre>
              </div>
              <div v-if="persona.agents" class="flex flex-col gap-0.5">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {{ $t('pages.preferences.personas.fragments.agents.label') }}
                </span>
                <pre class="line-clamp-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{{ persona.agents }}</pre>
              </div>
            </div>

            <!-- ── Persona history (Plan 36 / Wave A1) ─────────── -->
            <details
              class="mt-3 border-t pt-3"
              :data-testid="`persona-history-block-${persona.id}`"
              @toggle="onHistoryToggle(persona, $event)"
            >
              <summary class="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <History class="size-3.5" />
                {{ $t('pages.preferences.personas.history.toggle') }}
              </summary>
              <div class="mt-2">
                <p
                  v-if="historyLoading[persona.id]"
                  class="text-xs text-muted-foreground"
                >
                  {{ $t('common.loading') }}
                </p>
                <p
                  v-else-if="!historyFor(persona.id).length"
                  class="text-xs text-muted-foreground"
                  :data-testid="`persona-history-empty-${persona.id}`"
                >
                  {{ $t('pages.preferences.personas.history.empty') }}
                </p>
                <ul v-else class="flex flex-col gap-2">
                  <li
                    v-for="entry in historyFor(persona.id)"
                    :key="entry.id"
                    class="rounded-md border bg-muted/30 p-2"
                    :data-testid="`persona-history-entry-${persona.id}-${entry.id}`"
                  >
                    <div class="mb-1 flex items-center justify-between gap-2">
                      <span
                        class="font-mono text-[10px] text-muted-foreground"
                        :title="new Date(entry.created_at * 1000).toISOString()"
                      >
                        {{ formatHistoryDate(entry.created_at) }} · {{ entry.author }}
                      </span>
                      <UiButton
                        size="sm"
                        variant="outline"
                        :disabled="restoring[persona.id]"
                        :aria-label="
                          $t('pages.preferences.personas.history.restoreAria', {
                            date: formatHistoryDate(entry.created_at),
                            author: entry.author,
                          })
                        "
                        :data-testid="`persona-history-restore-${persona.id}-${entry.id}`"
                        @click="restoreSnapshot(persona, entry)"
                      >
                        {{ $t('pages.preferences.personas.history.restoreButton') }}
                      </UiButton>
                    </div>
                    <div class="flex flex-col gap-1 text-xs text-muted-foreground">
                      <div>
                        <span class="font-semibold">{{ $t('pages.preferences.personas.fragments.soul.label') }}:</span>
                        <span class="line-clamp-2 whitespace-pre-wrap">{{ entry.snapshot.soul || '—' }}</span>
                      </div>
                      <div>
                        <span class="font-semibold">{{ $t('pages.preferences.personas.fragments.identity.label') }}:</span>
                        <span class="line-clamp-2 whitespace-pre-wrap">{{ entry.snapshot.identity || '—' }}</span>
                      </div>
                      <div>
                        <span class="font-semibold">{{ $t('pages.preferences.personas.fragments.agents.label') }}:</span>
                        <span class="line-clamp-2 whitespace-pre-wrap">{{ entry.snapshot.agents || '—' }}</span>
                      </div>
                    </div>
                  </li>
                </ul>
              </div>
            </details>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Section 3: Channels ─────────────────────────────────────── -->
    <section
      v-if="!loading"
      class="flex flex-col gap-4"
      data-testid="channels-section"
    >
      <div>
        <h3 class="text-sm font-semibold">
          {{ $t('pages.preferences.channels.title') }}
        </h3>
        <p class="text-xs text-muted-foreground">
          {{ $t('pages.preferences.channels.subtitle') }}
        </p>
      </div>

      <ul class="flex flex-col gap-3">
        <li
          v-for="channel in channels"
          :key="channel.channel"
          class="rounded-md border p-4"
          :data-testid="`channel-card-${channel.channel}`"
        >
          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-sm font-semibold">{{ channel.label }}</h4>
              <span
                class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >{{ channel.channel }}</span
              >
              <span
                v-if="channel.is_default_prompt"
                class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {{ $t('pages.preferences.channels.defaultPromptBadge') }}
              </span>
              <span
                v-else
                class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                :data-testid="`channel-custom-badge-${channel.channel}`"
              >
                {{ $t('pages.preferences.channels.customPromptBadge') }}
              </span>
            </div>

            <div class="flex flex-col gap-1">
              <label
                class="text-xs font-medium text-muted-foreground"
                :for="`persona-select-${channel.channel}`"
              >
                {{ $t('pages.preferences.channels.personaLabel') }}
              </label>
              <select
                :id="`persona-select-${channel.channel}`"
                v-model="draftFor(channel).defaultPersonaId"
                class="h-9 rounded-md border bg-background px-2 text-sm"
                :data-testid="`channel-persona-select-${channel.channel}`"
              >
                <option value="">
                  {{ $t('pages.preferences.channels.personaGlobalOption') }}
                </option>
                <option
                  v-for="persona in personas"
                  :key="persona.id"
                  :value="String(persona.id)"
                >
                  {{ persona.name }}
                </option>
              </select>
            </div>

            <div class="flex flex-col gap-1">
              <label
                class="text-xs font-medium text-muted-foreground"
                :for="`prompt-${channel.channel}`"
              >
                {{ $t('pages.preferences.channels.promptLabel') }}
              </label>
              <UiTextarea
                :id="`prompt-${channel.channel}`"
                v-model="draftFor(channel).prompt"
                class="min-h-32 font-mono text-sm"
                spellcheck="false"
                :data-testid="`channel-prompt-${channel.channel}`"
              />
            </div>

            <p
              v-if="draftFor(channel).error"
              class="text-sm text-destructive"
              :data-testid="`channel-error-${channel.channel}`"
            >
              {{ draftFor(channel).error }}
            </p>

            <div class="flex flex-wrap items-center gap-2">
              <UiButton
                size="sm"
                :disabled="
                  !channelDirty(channel) || draftFor(channel).saving
                "
                :data-testid="`channel-save-${channel.channel}`"
                @click="saveChannel(channel)"
              >
                <Check class="mr-1 size-3.5" /> {{ $t('common.save') }}
              </UiButton>
              <UiButton
                v-if="!channel.is_default_prompt"
                size="sm"
                variant="ghost"
                :data-testid="`channel-reset-${channel.channel}`"
                @click="resetChannelPrompt(channel)"
              >
                <RotateCcw class="mr-1 size-3.5" />
                {{ $t('pages.preferences.channels.resetButton') }}
              </UiButton>
            </div>
          </div>
        </li>
      </ul>
    </section>

  </div>
</template>
