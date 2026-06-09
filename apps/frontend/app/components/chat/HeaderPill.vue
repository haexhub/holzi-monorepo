<script setup lang="ts">
import { ChevronDown, X } from 'lucide-vue-next'
import {
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui'
import type { Persona } from '~/types/api'

const props = defineProps<{
  personaName: string | null
  model: string
  personas: Persona[]
  override: { model?: string; personaId?: number } | null
}>()

const emit = defineEmits<{
  clear: []
  'update:override': [value: { model?: string; personaId?: number } | null]
}>()

const { t } = useI18n({ useScope: 'global' })
const open = ref(false)

const pickerModel = ref('')
const pickerPersonaId = ref<number | undefined>(undefined)

function openPicker() {
  pickerModel.value = props.override?.model ?? ''
  pickerPersonaId.value = props.override?.personaId
  open.value = true
}

function applyPicker() {
  const next: { model?: string; personaId?: number } = {}
  if (pickerModel.value.trim()) next.model = pickerModel.value.trim()
  if (pickerPersonaId.value !== undefined) next.personaId = pickerPersonaId.value
  emit('update:override', Object.keys(next).length ? next : null)
  open.value = false
}

const displayPersonaName = computed(() => {
  if (props.override?.personaId != null) {
    return props.personas.find((p) => p.id === props.override!.personaId)?.name ?? props.personaName
  }
  return props.personaName
})

const displayModel = computed(() => props.override?.model ?? props.model)
const hasOverride = computed(() => !!props.override && Object.keys(props.override).length > 0)
</script>

<template>
  <div class="flex items-center">
    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted"
          :class="hasOverride ? 'border-primary/50 bg-primary/10 text-primary' : 'text-muted-foreground'"
          :aria-label="t('components.chatHub.contextPill.aria')"
          @click="openPicker"
        >
          <span class="max-w-[8rem] truncate">{{ displayPersonaName ?? '—' }}</span>
          <span class="opacity-40">·</span>
          <span class="max-w-[10rem] truncate font-mono">{{ displayModel }}</span>
          <ChevronDown class="size-3 opacity-60" />
          <span v-if="hasOverride" class="sr-only">{{ t('components.chatHub.contextPill.overrideActive') }}</span>
        </button>
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverContent
          :side-offset="8"
          class="z-50 w-72 rounded-lg border bg-popover p-4 shadow-md"
          align="end"
        >
          <div class="space-y-4">
            <div class="space-y-1.5">
              <label class="text-xs font-medium text-muted-foreground">
                {{ t('components.chatHub.contextPill.personaLabel') }}
              </label>
              <select
                v-model="pickerPersonaId"
                class="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              >
                <option :value="undefined">— {{ t('components.chatHub.contextPill.personaLabel') }} —</option>
                <option v-for="p in personas" :key="p.id" :value="p.id">
                  {{ p.name }}
                </option>
              </select>
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-medium text-muted-foreground">
                {{ t('components.chatHub.contextPill.modelLabel') }}
              </label>
              <input
                v-model="pickerModel"
                type="text"
                class="w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono placeholder:font-sans placeholder:text-muted-foreground"
                :placeholder="t('components.chatHub.contextPill.modelPlaceholder')"
              />
            </div>
            <button
              type="button"
              class="w-full rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
              @click="applyPicker"
            >
              {{ t('components.chatHub.contextPill.apply') }}
            </button>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>

    <button
      v-if="hasOverride"
      type="button"
      class="-ml-1 rounded-full p-0.5 text-primary/70 hover:text-primary"
      :aria-label="t('components.chatHub.contextPill.clearOverride')"
      data-testid="clear-override"
      @click.stop="emit('clear')"
    >
      <X class="size-3" />
    </button>
  </div>
</template>
