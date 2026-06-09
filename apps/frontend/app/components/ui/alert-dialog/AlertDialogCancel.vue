<script setup lang="ts">
import { AlertDialogCancel, type AlertDialogCancelProps } from 'reka-ui'
import { buttonVariants } from '@/components/ui/button/variants'
import { cn } from '@/lib/utils'

const props = defineProps<AlertDialogCancelProps & { class?: string }>()
</script>

<template>
  <AlertDialogCancel
    v-bind="$attrs"
    :class="cn(buttonVariants({ variant: 'outline' }), 'mt-2 sm:mt-0', props.class)"
  >
    <slot />
  </AlertDialogCancel>
</template>
