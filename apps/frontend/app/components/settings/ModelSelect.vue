<script setup lang="ts">
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui'
import { Check, ChevronsUpDown } from 'lucide-vue-next'
import { translateError } from '~/lib/errorMessages'
import type { LlmModelChoice } from '~/types/api'

const props = defineProps<{
  modelValue: string | null
  credentialId: number | null
  disabled?: boolean
  testId?: string
  // Forwarded to the trigger so an external <label for> can target it.
  id?: string
  // Show a "use credential default" entry that resets the value to null.
  clearable?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const llm = useLlmCredentials()
const { t } = useI18n()
const models = ref<LlmModelChoice[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const open = ref(false)
const search = ref('')
let fetchToken = 0

async function load(credentialId: number | null) {
  models.value = []
  error.value = null
  const token = ++fetchToken
  if (credentialId === null) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const res = await llm.listModels(credentialId)
    if (token !== fetchToken) return
    models.value = res.models
    // Drop a stale saved model so the user sees the empty placeholder
    // rather than holding onto a value the provider no longer returns.
    if (props.modelValue && !res.models.some((m) => m.id === props.modelValue)) {
      emit('update:modelValue', null)
    }
  } catch (err: unknown) {
    if (token !== fetchToken) return
    error.value = translateError(err, t)
  } finally {
    if (token === fetchToken) loading.value = false
  }
}

watch(
  () => props.credentialId,
  (id) => {
    void load(id)
  },
  { immediate: true },
)

const selectedLabel = computed(() => {
  const m = models.value.find((x) => x.id === props.modelValue)
  return m?.label ?? ''
})

const triggerLabel = computed(() => {
  if (props.credentialId === null) return t('components.modelSelect.needsCredential')
  if (loading.value) return t('components.modelSelect.loading')
  if (error.value) return t('components.modelSelect.error')
  if (selectedLabel.value) return selectedLabel.value
  if (props.clearable && props.modelValue === null)
    return t('components.modelSelect.useDefault')
  if (models.value.length === 0) return t('components.modelSelect.empty')
  return t('components.modelSelect.placeholder')
})

const isDisabled = computed(
  () =>
    props.disabled ||
    loading.value ||
    props.credentialId === null ||
    !!error.value,
)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return models.value
  return models.value.filter(
    (m) =>
      m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
  )
})

function pick(id: string) {
  emit('update:modelValue', id)
  open.value = false
}

function clear() {
  emit('update:modelValue', null)
  open.value = false
}
</script>

<template>
  <div class="block">
    <ComboboxRoot
      v-model:open="open"
      v-model:search-term="search"
      :model-value="modelValue ?? ''"
      :disabled="isDisabled"
    >
      <ComboboxAnchor as-child>
        <ComboboxTrigger
          class="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          :class="!selectedLabel && 'text-muted-foreground'"
          :id="id"
          :data-testid="testId"
        >
          <span class="truncate text-left">{{ triggerLabel }}</span>
          <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
        </ComboboxTrigger>
      </ComboboxAnchor>

      <ComboboxPortal>
        <ComboboxContent
          position="popper"
          :side-offset="4"
          class="z-50 max-h-72 min-w-[var(--reka-combobox-trigger-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          <div class="flex items-center border-b px-3">
            <ComboboxInput
              :placeholder="$t('components.modelSelect.searchPlaceholder')"
              class="flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <ComboboxViewport class="max-h-60 overflow-y-auto p-1">
            <ComboboxItem
              v-if="clearable && !search.trim()"
              :value="''"
              class="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              @select.prevent="clear"
            >
              <ComboboxItemIndicator class="mr-2 size-4">
                <Check class="size-4" />
              </ComboboxItemIndicator>
              <span
                v-if="modelValue !== null"
                class="mr-2 inline-block size-4"
              />
              <span class="truncate text-muted-foreground">{{ $t('components.modelSelect.useDefault') }}</span>
            </ComboboxItem>
            <ComboboxEmpty
              v-if="filtered.length === 0"
              class="py-6 text-center text-sm text-muted-foreground"
            >
              {{ $t('components.modelSelect.noMatch') }}
            </ComboboxEmpty>
            <ComboboxItem
              v-for="m in filtered"
              :key="m.id"
              :value="m.id"
              class="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              @select.prevent="pick(m.id)"
            >
              <ComboboxItemIndicator class="mr-2 size-4">
                <Check class="size-4" />
              </ComboboxItemIndicator>
              <span
                v-if="modelValue !== m.id"
                class="mr-2 inline-block size-4"
              />
              <span class="truncate">{{ m.label }}</span>
            </ComboboxItem>
          </ComboboxViewport>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
    <p v-if="error" class="mt-1 text-xs text-destructive">{{ error }}</p>
  </div>
</template>
