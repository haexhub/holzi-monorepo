<script setup lang="ts">
const { $vscode } = useNuxtApp()

function onFirstMessage(text: string) {
  const title = text.trim().replace(/\s+/g, ' ').slice(0, 50) || 'New Chat'
  $vscode.post({ type: 'set_title', title })
}
</script>

<template>
  <ChatHub @first-message="onFirstMessage" />
</template>
