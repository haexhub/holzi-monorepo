<script setup lang="ts">
// /settings has no own UI — redirect to the first tab. The parent
// settings.vue keeps the tab nav rendered during the redirect so the
// flash is invisible.
definePageMeta({
  middleware: () => navigateTo('/settings/llm', { replace: true }),
})
</script>

<template><div /></template>
