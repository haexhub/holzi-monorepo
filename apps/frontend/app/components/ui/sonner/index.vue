<script setup lang="ts">
import { Toaster as SonnerToaster, type ToasterProps } from 'vue-sonner'
import 'vue-sonner/style.css'

const props = defineProps<ToasterProps>()
</script>

<template>
  <SonnerToaster
    class="toaster group"
    :rich-colors="props.richColors ?? true"
    :close-button="props.closeButton ?? true"
    v-bind="$attrs"
  />
</template>
