<script setup lang="ts">
import { Check, Slash, Trash2 } from 'lucide-vue-next'
import {
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui'
import type { ModelEntry, Persona } from '~/types/api'

interface Skill { slug: string; name: string }

const props = defineProps<{
  personas: Persona[]
  models: ModelEntry[]
  skills: Skill[]
  override: { model?: string; personaId?: number; thinkingBudget?: 'low' | 'medium' | 'high' } | null
  skillHints: string[]
  defaultModel: string
}>()

const emit = defineEmits<{
  'update:override': [value: typeof props.override]
  'update:skillHints': [value: string[]]
  'clear-conversation': []
}>()

const { t } = useI18n({ useScope: 'global' })
const open = ref(false)

function selectModel(id: string) {
  const next = { ...props.override, model: id }
  const picked = props.models.find((m) => m.id === id)
  if (!picked?.thinking.supported) delete next.thinkingBudget
  emit('update:override', Object.keys(next).length ? next : null)
  open.value = false
}

function selectPersona(id: number) {
  emit('update:override', { ...props.override, personaId: id })
  open.value = false
}

function selectThinking(level: 'low' | 'medium' | 'high' | null) {
  const next = { ...props.override }
  if (level === null) delete next.thinkingBudget
  else next.thinkingBudget = level
  emit('update:override', Object.keys(next).length ? next : null)
  open.value = false
}

function toggleSkill(slug: string) {
  const current = new Set(props.skillHints)
  if (current.has(slug)) current.delete(slug)
  else current.add(slug)
  emit('update:skillHints', [...current])
}

function clearConversation() {
  open.value = false
  emit('clear-conversation')
}

// The model that will actually run this turn: explicit override wins,
// otherwise the persona/context-resolved default.
const effectiveModelId = computed(() => props.override?.model ?? props.defaultModel)
const effectiveModel = computed(() =>
  props.models.find((m) => m.id === effectiveModelId.value),
)
// Unknown model (not in the list) -> treat as no thinking support; the
// backend will drop any budget anyway, and we can't offer levels we
// don't know.
const thinkingSupported = computed(() => effectiveModel.value?.thinking.supported ?? false)
const thinkingLevels = computed<readonly string[]>(() =>
  thinkingSupported.value ? ['none', ...effectiveModel.value!.thinking.levels] : [],
)
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :aria-label="t('components.chatHub.composerToolbar.commands')"
        data-testid="command-picker-trigger"
      >
        <Slash class="size-4" />
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        side="top"
        align="start"
        :side-offset="8"
        class="z-50 w-80 max-h-[480px] overflow-y-auto rounded-lg border bg-popover p-2 shadow-lg"
      >
        <!-- Model section -->
        <p class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {{ t('components.chatHub.commandPicker.sections.model') }}
        </p>
        <template v-if="models.length">
          <button
            v-for="m in models"
            :key="`${m.credential_id}:${m.id}`"
            :data-testid="`model-row-${m.id}`"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            @click="selectModel(m.id)"
          >
            <Check
              class="size-3.5 shrink-0"
              :class="override?.model === m.id ? 'opacity-100' : 'opacity-0'"
            />
            <span class="flex-1 truncate font-mono text-xs">{{ m.id }}</span>
            <span class="text-xs text-muted-foreground">{{ m.credential_name }}</span>
          </button>
        </template>
        <p v-else class="px-2 py-1.5 text-xs text-muted-foreground">
          {{ t('components.chatHub.commandPicker.noModels') }}
        </p>

        <div class="my-1.5 border-t" />

        <!-- Persona section -->
        <p class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {{ t('components.chatHub.commandPicker.sections.persona') }}
        </p>
        <button
          v-for="p in personas"
          :key="p.id"
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          @click="selectPersona(p.id)"
        >
          <Check
            class="size-3.5 shrink-0"
            :class="override?.personaId === p.id ? 'opacity-100' : 'opacity-0'"
          />
          {{ p.name }}
        </button>

        <!-- Thinking Effort section -->
        <template v-if="thinkingSupported">
          <div class="my-1.5 border-t" />
          <p
            data-testid="thinking-section"
            class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
          >
            {{ t('components.chatHub.commandPicker.sections.thinkingEffort') }}
          </p>
          <button
            v-for="level in thinkingLevels"
            :key="level"
            type="button"
            :data-testid="`thinking-level-${level}`"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            @click="selectThinking(level === 'none' ? null : (level as 'low' | 'medium' | 'high'))"
          >
            <Check
              class="size-3.5 shrink-0"
              :class="(level === 'none' ? !override?.thinkingBudget : override?.thinkingBudget === level) ? 'opacity-100' : 'opacity-0'"
            />
            {{ t(`components.chatHub.commandPicker.thinkingEffort.${level}`) }}
          </button>
        </template>

        <template v-if="skills.length">
          <div class="my-1.5 border-t" />

          <!-- Skills section -->
          <p class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {{ t('components.chatHub.commandPicker.sections.skills') }}
          </p>
          <button
            v-for="s in skills"
            :key="s.slug"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            @click="toggleSkill(s.slug)"
          >
            <Check
              class="size-3.5 shrink-0"
              :class="skillHints.includes(s.slug) ? 'opacity-100' : 'opacity-0'"
            />
            {{ s.name }}
          </button>
        </template>

        <div class="my-1.5 border-t" />

        <!-- Actions section -->
        <p class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {{ t('components.chatHub.commandPicker.sections.actions') }}
        </p>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
          data-testid="clear-conversation"
          @click="clearConversation"
        >
          <Trash2 class="size-3.5" />
          {{ t('components.chatHub.commandPicker.clearConversation') }}
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
