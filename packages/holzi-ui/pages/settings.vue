<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { settingsNav } from '~/lib/settingsNav'

// Parent layout for /settings/* — owns the page chrome (header, back
// button, theme toggle, sidebar/top-nav). The child pages render the
// section content inside `<NuxtPage />`.
//
// Navigation is route-based (NuxtLink) so deep links + the browser
// back button work naturally. `active-class` styles the current entry.
// `localePath()` rewrites `/settings/foo` to `/en/settings/foo` when
// the active locale is EN — without it, clicking any link would drop
// the user back to the default locale.
//
// Layout:
//  - desktop (md+): sticky sidebar on the left (stays visible while
//    long content like the LLM section scrolls), content on the right
//  - mobile: horizontally scrollable top tabs, content below

const localePath = useLocalePath()
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 p-6">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold">{{ $t('pages.settings.title') }}</h1>
        <p class="text-sm text-muted-foreground">
          {{ $t('pages.settings.subtitle') }}
        </p>
      </div>
      <div class="flex items-center gap-1">
        <ThemeToggle />
        <NuxtLink :to="localePath('/')">
          <UiButton variant="ghost" size="sm">
            <ArrowLeft class="mr-1 size-4" />
            {{ $t('common.back') }}
          </UiButton>
        </NuxtLink>
      </div>
    </header>

    <!-- Mobile: horizontal scroll tabs -->
    <nav
      class="-mx-6 overflow-x-auto border-b md:hidden"
      :aria-label="$t('nav.aria.mobile')"
    >
      <div class="flex gap-1 px-6">
        <NuxtLink
          v-for="item in settingsNav"
          :key="item.to"
          :to="localePath(item.to)"
          active-class="border-foreground text-foreground"
          class="flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <component :is="item.icon" class="size-4" />
          {{ $t(item.labelKey) }}
        </NuxtLink>
      </div>
    </nav>

    <div class="flex flex-1 gap-8">
      <!-- Desktop: sidebar (sticky so it stays in view on long sections) -->
      <nav
        class="sticky top-6 hidden h-fit w-52 shrink-0 flex-col gap-0.5 self-start md:flex"
        :aria-label="$t('nav.aria.desktop')"
      >
        <NuxtLink
          v-for="item in settingsNav"
          :key="item.to"
          :to="localePath(item.to)"
          active-class="bg-muted text-foreground"
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <component :is="item.icon" class="size-4" />
          {{ $t(item.labelKey) }}
        </NuxtLink>
      </nav>

      <main class="min-w-0 flex-1">
        <NuxtPage />
      </main>
    </div>
  </div>
</template>
