<script setup lang="ts">
import { AlertDialogAction, type AlertDialogActionProps } from 'reka-ui'
import { buttonVariants, type ButtonVariants } from '@/components/ui/button/variants'
import { cn } from '@/lib/utils'

const props = defineProps<
  AlertDialogActionProps & { class?: string; variant?: ButtonVariants['variant'] }
>()
</script>

<template>
  <AlertDialogAction
    v-bind="$attrs"
    :class="cn(buttonVariants({ variant: props.variant ?? 'default' }), props.class)"
  >
    <slot />
  </AlertDialogAction>
</template>
