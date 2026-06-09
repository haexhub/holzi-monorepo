<script setup lang="ts">
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const colorMode = useColorMode()
const sonnerTheme = computed<'light' | 'dark'>(() =>
  colorMode.state.value === 'dark' ? 'dark' : 'light',
)
// Match the chat UI's mobile cutoff: pin notifications to bottom-center on
// narrow viewports so they don't fight the on-screen keyboard.
const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('sm')
const sonnerPosition = computed<'top-right' | 'bottom-center'>(() =>
  isMobile.value ? 'bottom-center' : 'top-right',
)
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
    <AppConfirmHost />
    <UiSonner :theme="sonnerTheme" :position="sonnerPosition" />
  </NuxtLayout>
</template>
