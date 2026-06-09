<script setup lang="ts">
import { renderMarkdown } from '~/utils/markdown'

const props = defineProps<{ content: string }>()

const root = ref<HTMLElement | null>(null)
const html = ref('')

// Guards against an older async render landing after a newer one.
let renderToken = 0
let mermaidSeq = 0

async function render() {
  const token = ++renderToken
  const out = await renderMarkdown(props.content)
  if (token !== renderToken) return
  html.value = out
  await nextTick()
  await upgradeMermaid()
}

async function upgradeMermaid() {
  const el = root.value
  if (!el) return
  const blocks = el.querySelectorAll<HTMLElement>('.mermaid-block')
  if (blocks.length === 0) return

  // mermaid is large and only needed when a diagram is present, so load it
  // lazily. If it fails to load, the readable source fallback stays in place.
  let mermaid
  try {
    mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
  }
  catch {
    return
  }

  for (const block of Array.from(blocks)) {
    if (block.dataset.rendered) continue
    const source = block.querySelector('.mermaid-fallback')?.textContent ?? ''
    if (!source.trim()) continue
    try {
      // Globally unique id: mermaid injects a temp node with this id while
      // rendering, so two message instances must not collide.
      const id = `holzi-mermaid-${Date.now()}-${mermaidSeq++}-${Math.random().toString(36).slice(2)}`
      const { svg } = await mermaid.render(id, source)
      block.innerHTML = svg
      block.dataset.rendered = 'true'
    }
    catch {
      // Leave the fallback <pre> so the diagram source stays readable.
    }
  }
}

function onClick(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest<HTMLElement>('.copy-btn')
  if (!button) return
  const code = button.dataset.code ?? ''
  navigator.clipboard?.writeText(code)
}

watch(() => props.content, render, { immediate: true })
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html — output is sanitized by renderMarkdown -->
  <div ref="root" class="rendered-markdown" @click="onClick" v-html="html" />
</template>
