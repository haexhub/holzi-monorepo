<script setup lang="ts">
import { AlertOctagon, Loader2 } from 'lucide-vue-next'
import type { SandboxCrashedData } from '~/types/api'

const props = defineProps<{
  crash: SandboxCrashedData
  restarting: boolean
}>()

const emit = defineEmits<{
  restart: []
  dismiss: []
}>()

const { t } = useI18n({ useScope: 'global' })

const stateLabel = computed(() => {
  switch (props.crash.state) {
    case 'oom':
      return t('components.sandboxCrashCard.state.oom')
    case 'removed':
      return t('components.sandboxCrashCard.state.removed')
    case 'crashed':
    default:
      return t('components.sandboxCrashCard.state.crashed')
  }
})
</script>

<template>
  <div
    class="w-full max-w-[80%] overflow-hidden rounded-xl border border-destructive/40 text-xs"
  >
    <div
      class="flex items-center gap-2 bg-destructive/10 px-3 py-2 text-destructive"
    >
      <AlertOctagon class="size-4 shrink-0" />
      <span class="font-medium">{{ $t('components.sandboxCrashCard.title') }}</span>
      <span class="ml-auto font-medium">{{ stateLabel }}</span>
    </div>

    <div class="space-y-2 border-t bg-background px-3 py-2">
      <p class="text-muted-foreground">
        {{ $t('components.sandboxCrashCard.workspaceLabel') }}
        <span class="font-mono font-medium text-foreground">{{ crash.workspace_id }}</span>
      </p>
      <p v-if="crash.exit_code != null" class="text-muted-foreground">
        {{ $t('components.sandboxCrashCard.exitCodeLabel') }}
        <span class="font-mono font-medium text-foreground">{{ crash.exit_code }}</span>
      </p>

      <div class="flex justify-end gap-2 pt-1">
        <button
          type="button"
          class="rounded border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="restarting"
          @click="emit('dismiss')"
        >
          {{ $t('common.close') }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="restarting"
          @click="emit('restart')"
        >
          <Loader2 v-if="restarting" class="size-3.5 animate-spin" />
          <span>{{ restarting ? $t('components.sandboxCrashCard.restarting') : $t('components.sandboxCrashCard.restart') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
