<script setup lang="ts">
import { ref } from 'vue'
import { SplitterPanel, type SplitterPanelProps } from 'reka-ui'

const props = defineProps<SplitterPanelProps>()

const panelRef = ref<InstanceType<typeof SplitterPanel> | null>(null)

defineExpose({
  collapse: () => panelRef.value?.collapse(),
  expand: () => panelRef.value?.expand(),
  resize: (size: number) => panelRef.value?.resize(size),
})
</script>

<template>
  <SplitterPanel ref="panelRef" data-slot="resizable-panel" v-bind="props">
    <slot />
  </SplitterPanel>
</template>
