<script setup lang="ts">
// Plan 32-A: a readable rendering of an `mcp_install` approval's parameters,
// so the user can eyeball what server the agent wants to register without
// squinting at a raw JSON blob. The backend has already redacted secrets
// (`credentials` → "[redacted, N chars]", `env` values → "[redacted]"), so
// this component only ever sees masked values — it shows env *keys* and a
// "credentials set" marker, never plaintext.
const props = defineProps<{
  params: Record<string, unknown> | null | undefined
}>()

const p = computed(() => props.params ?? {})

const name = computed(() => String(p.value.name ?? ''))
const displayName = computed(() => {
  const d = p.value.display_name
  return typeof d === 'string' && d.trim() ? d.trim() : ''
})
const transport = computed(() => String(p.value.transport ?? ''))
const url = computed(() => (typeof p.value.url === 'string' ? p.value.url : ''))
const commandArgv = computed(() => {
  const a = p.value.command_argv
  return Array.isArray(a) ? a.map((x) => String(x)) : []
})
const envKeys = computed(() => {
  const e = p.value.env
  return e && typeof e === 'object' ? Object.keys(e as Record<string, unknown>) : []
})
// Redacted to a non-empty string by the backend whenever credentials were set.
const hasCredentials = computed(() => {
  const c = p.value.credentials
  return typeof c === 'string' && c.length > 0
})
</script>

<template>
  <div class="space-y-1.5" data-testid="mcp-install-details">
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        data-testid="mcp-install-transport"
      >
        {{ transport }}
      </span>
      <code class="font-mono text-[11px] text-muted-foreground">mcp:{{ name }}</code>
      <span v-if="displayName" class="text-muted-foreground">{{ displayName }}</span>
    </div>

    <p
      v-if="transport === 'http' && url"
      class="break-all font-mono text-xs text-muted-foreground"
      data-testid="mcp-install-url"
    >
      {{ url }}
    </p>
    <p
      v-else-if="transport === 'stdio' && commandArgv.length > 0"
      class="break-all font-mono text-xs text-muted-foreground"
      data-testid="mcp-install-command"
    >
      {{ commandArgv.join(' ') }}
    </p>

    <p
      v-if="envKeys.length > 0"
      class="text-xs text-muted-foreground"
      data-testid="mcp-install-env"
    >
      {{ $t('components.mcpInstallApprovalDetails.envLabel') }}
      <code
        v-for="key in envKeys"
        :key="key"
        class="ml-1 font-mono"
      >{{ key }}</code>
    </p>

    <p
      v-if="hasCredentials"
      class="text-xs text-muted-foreground"
      data-testid="mcp-install-credentials"
    >
      {{ $t('components.mcpInstallApprovalDetails.credentialsLabel') }} <span class="font-mono">{{ $t('components.mcpInstallApprovalDetails.credentialsHidden') }}</span>
    </p>
  </div>
</template>
