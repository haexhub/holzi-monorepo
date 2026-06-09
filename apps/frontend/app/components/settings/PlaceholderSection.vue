<script setup lang="ts">
import { settingsNav } from '~/lib/settingsNav'

const route = useRoute()
// settingsNav stores the canonical path (`/settings/memory`). With
// strategy `prefix_except_default`, the live path may carry an `/en/`-
// style locale prefix that we need to strip before lookup.
const canonicalPath = computed(() =>
  route.path.replace(/^\/[a-z]{2}(\/|$)/, '/'),
)
const item = computed(() => settingsNav.find((n) => n.to === canonicalPath.value))
</script>

<template>
  <div v-if="item" class="flex flex-col gap-4">
    <div class="flex items-center gap-2">
      <component :is="item.icon" class="size-5 text-muted-foreground" />
      <h2 class="text-base font-semibold">{{ $t(item.labelKey) }}</h2>
    </div>
    <p v-if="item.upcomingKey" class="text-sm text-muted-foreground">
      {{ $t(item.upcomingKey) }}
    </p>
    <div class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      {{ $t('pages.settings.placeholder.notImplemented') }}
    </div>
  </div>
</template>
