<script setup lang="ts">
import {
  AlertTriangle,
  ArrowRight,
  KeyRound,
  MessageCircle,
} from 'lucide-vue-next'

// `null` = credentials list still loading. We don't want to flash the
// "Start by adding credentials" CTA before the request resolves, so
// render nothing in that case.
const props = defineProps<{
  hasCredentials: boolean | null
}>()

// Plan 20-C: pull /api/diagnostics so the empty state can surface a banner
// when the user has credentials but some subsystem is non-ok (Docker-host
// default = workspace/sandbox warning). The Credentials-CTA stays the
// priority — banner only renders when hasCredentials === true.
const { diagnostics, loadDiagnostics } = useDiagnostics()
const localePath = useLocalePath()

// One-shot: the `diagnostics.value === null` guard means we never re-fetch
// after the first load. A `true → false → true` transition keeps the cached
// value — fine here because the EmptyState is unmounted as soon as the user
// sends a first message; credentials don't flip at runtime in the chat-
// empty surface.
watch(
  () => props.hasCredentials,
  (val) => {
    if (val === true && diagnostics.value === null) {
      void loadDiagnostics()
    }
  },
  { immediate: true },
)

const findingCount = computed(() => {
  const d = diagnostics.value
  if (!d || d.overall === 'ok') return 0
  // Defensive: an older hermes-server can return a payload without `checks`
  // (pre-Plan-20 schema). Fall back to 0 instead of crashing the empty state.
  return d.checks?.filter((c) => c.status !== 'ok').length ?? 0
})

const showBanner = computed(
  () => props.hasCredentials === true && findingCount.value > 0,
)
</script>

<template>
  <div
    v-if="hasCredentials !== null"
    class="flex flex-col items-center gap-4 py-16 text-center"
  >
    <template v-if="hasCredentials === false">
      <div class="rounded-full bg-muted p-3 text-muted-foreground">
        <KeyRound class="size-6" />
      </div>
      <div class="space-y-1">
        <h2 class="text-base font-semibold">{{ $t('components.emptyChatState.welcome.title') }}</h2>
        <p class="max-w-sm text-sm text-muted-foreground">
          {{ $t('components.emptyChatState.welcome.body') }}
        </p>
      </div>
      <!-- Use as-child so the link is the interactive root — otherwise
           we end up with <a><button>, which is invalid HTML and breaks
           keyboard/screen-reader semantics. -->
      <UiButton as-child size="sm">
        <NuxtLink :to="localePath('/settings/llm')">
          {{ $t('components.emptyChatState.welcome.cta') }}
          <ArrowRight class="ml-1 size-4" />
        </NuxtLink>
      </UiButton>
    </template>

    <template v-else>
      <div class="rounded-full bg-muted p-3 text-muted-foreground">
        <MessageCircle class="size-6" />
      </div>
      <p class="text-sm text-muted-foreground">
        {{ $t('components.emptyChatState.hello') }}
      </p>
      <NuxtLink
        v-if="showBanner"
        :to="localePath('/settings/diagnostics')"
        data-testid="empty-state-diagnostics-banner"
        class="group mt-2 flex max-w-md items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-left text-sm transition-colors hover:bg-amber-500/10"
      >
        <AlertTriangle
          class="size-5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <span class="flex-1">
          <span class="font-medium">{{ $t('components.emptyChatState.banner.title') }}</span>
          <span class="block text-muted-foreground">
            {{ findingCount }}
            {{ findingCount === 1
              ? $t('components.emptyChatState.banner.findingSingular')
              : $t('components.emptyChatState.banner.findingPlural') }}
            {{ $t('components.emptyChatState.banner.suffix') }}
          </span>
        </span>
        <ArrowRight
          class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </NuxtLink>
    </template>
  </div>
</template>
