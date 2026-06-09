<script setup lang="ts">
import { ref } from 'vue'
import { useVModel } from '@vueuse/core'
import { cn } from '@/lib/utils'

const props = defineProps<{
  defaultValue?: string
  modelValue?: string
  class?: string
}>()

const emits = defineEmits<{
  'update:modelValue': [payload: string]
}>()

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})

const el = ref<HTMLTextAreaElement | null>(null)
defineExpose({ el })
</script>

<template>
  <textarea
    ref="el"
    v-model="modelValue"
    :class="cn('flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', props.class)"
  />
</template>
