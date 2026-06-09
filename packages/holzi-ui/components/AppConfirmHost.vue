<script setup lang="ts">
const { t } = useI18n()
const confirmQueue = useConfirmQueue()
const promptQueue = usePromptQueue()

const currentConfirm = computed(() => confirmQueue.value[0] ?? null)
const currentPrompt = computed(() => promptQueue.value[0] ?? null)

const confirmOpen = computed(() => currentConfirm.value !== null)
const promptOpen = computed(() => currentPrompt.value !== null)

// reka emits update:open=false on ESC / pointer-outside / close-button.
// Treat any auto-close while a request is still in the queue as cancel.
function onConfirmOpenChange(next: boolean) {
  if (!next && currentConfirm.value) {
    resolveConfirm(currentConfirm.value.id, false)
  }
}
function onPromptOpenChange(next: boolean) {
  if (!next && currentPrompt.value) {
    resolvePrompt(currentPrompt.value.id, null)
  }
}

function onConfirm() {
  if (currentConfirm.value) resolveConfirm(currentConfirm.value.id, true)
}
function onCancelConfirm() {
  if (currentConfirm.value) resolveConfirm(currentConfirm.value.id, false)
}

const promptInput = ref('')
const promptInputEl = ref<HTMLInputElement | null>(null)

watch(currentPrompt, async (req) => {
  if (req) {
    promptInput.value = req.defaultValue ?? ''
    await nextTick()
    promptInputEl.value?.focus()
    promptInputEl.value?.select()
  }
})

function submitPrompt() {
  if (currentPrompt.value) resolvePrompt(currentPrompt.value.id, promptInput.value)
}
function cancelPrompt() {
  if (currentPrompt.value) resolvePrompt(currentPrompt.value.id, null)
}
</script>

<template>
  <UiAlertDialog :open="confirmOpen" @update:open="onConfirmOpenChange">
    <UiAlertDialogContent v-if="currentConfirm" data-testid="confirm-dialog">
      <UiAlertDialogHeader>
        <UiAlertDialogTitle>{{ currentConfirm.title }}</UiAlertDialogTitle>
        <UiAlertDialogDescription v-if="currentConfirm.description">
          {{ currentConfirm.description }}
        </UiAlertDialogDescription>
      </UiAlertDialogHeader>
      <UiAlertDialogFooter>
        <UiButton
          type="button"
          variant="outline"
          data-testid="confirm-cancel"
          @click="onCancelConfirm"
        >
          {{ currentConfirm.cancelLabel ?? t('common.cancel') }}
        </UiButton>
        <UiButton
          type="button"
          :variant="currentConfirm.destructive ? 'destructive' : 'default'"
          data-testid="confirm-action"
          @click="onConfirm"
        >
          {{ currentConfirm.confirmLabel ?? (currentConfirm.destructive ? t('common.delete') : t('common.confirm')) }}
        </UiButton>
      </UiAlertDialogFooter>
    </UiAlertDialogContent>
  </UiAlertDialog>

  <UiDialog :open="promptOpen" @update:open="onPromptOpenChange">
    <UiDialogContent v-if="currentPrompt" data-testid="prompt-dialog">
      <UiDialogHeader>
        <UiDialogTitle>{{ currentPrompt.title }}</UiDialogTitle>
        <UiDialogDescription v-if="currentPrompt.description">
          {{ currentPrompt.description }}
        </UiDialogDescription>
      </UiDialogHeader>
      <form class="grid gap-3" @submit.prevent="submitPrompt">
        <input
          ref="promptInputEl"
          v-model="promptInput"
          type="text"
          :placeholder="currentPrompt.placeholder"
          data-testid="prompt-input"
          class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
        <UiDialogFooter>
          <UiButton
            type="button"
            variant="outline"
            data-testid="prompt-cancel"
            @click="cancelPrompt"
          >
            {{ currentPrompt.cancelLabel ?? t('common.cancel') }}
          </UiButton>
          <UiButton type="submit" data-testid="prompt-confirm">
            {{ currentPrompt.confirmLabel ?? t('common.ok') }}
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
