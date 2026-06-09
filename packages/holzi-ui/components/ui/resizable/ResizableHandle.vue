<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { GripVertical } from 'lucide-vue-next'
import {
  SplitterResizeHandle,
  type SplitterResizeHandleEmits,
  type SplitterResizeHandleProps,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<SplitterResizeHandleProps & {
  class?: HTMLAttributes['class']
  withHandle?: boolean
}>()
const emits = defineEmits<SplitterResizeHandleEmits>()

const delegatedProps = computed(() => {
  const { class: _, withHandle: __, ...rest } = props
  return rest
})

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SplitterResizeHandle
    data-slot="resizable-handle"
    v-bind="forwarded"
    :class="cn(
      'relative flex w-px items-center justify-center bg-border transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>div]:rotate-90',
      props.class,
    )"
  >
    <template v-if="withHandle">
      <div class="z-10 flex h-4 w-3 items-center justify-center rounded-xs border bg-border">
        <GripVertical class="size-2.5" />
      </div>
    </template>
  </SplitterResizeHandle>
</template>
