import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return { ...orig, useI18n: () => ({ t: (k: string) => k }) }
})
vi.mock('#imports', () => ({ useLocalePath: () => (p: string) => p }))

import CommandPicker from '~/components/chat/CommandPicker.vue'
import type { Persona, ModelEntry } from '~/types/api'

const persona: Persona = {
  id: 1, name: 'Hermes', soul: '', identity: '', agents: '',
  is_default: true, llm_credential_id: null, model: null,
  created_at: 0, updated_at: 0,
}

const model: ModelEntry = {
  id: 'claude-opus-4-8', credential_id: 1, credential_name: 'Default',
  provider: 'anthropic',
  thinking: { supported: true, levels: ['low', 'medium', 'high'] },
}

const nonThinkingModel: ModelEntry = {
  id: 'gpt-4o', credential_id: 1, credential_name: 'Default',
  provider: 'openai',
  thinking: { supported: false, levels: [] },
}

// reka-ui PopoverContent is portaled to document.body and survives across
// tests; unmount every wrapper so leftover portal DOM never leaks.
const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
})

async function openPicker(props: Record<string, unknown>) {
  const wrapper = mount(CommandPicker, { props, attachTo: document.body })
  mounted.push(wrapper)
  await wrapper.find('[data-testid="command-picker-trigger"]').trigger('click')
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('CommandPicker.vue', () => {
  it('renders trigger button', () => {
    const wrapper = mount(CommandPicker, {
      props: { personas: [persona], models: [model], skills: [], override: null, skillHints: [], defaultModel: 'claude-opus-4-8' },
    })
    expect(wrapper.find('[data-testid="command-picker-trigger"]').exists()).toBe(true)
  })

  it('emits clear-conversation when action is clicked', async () => {
    const wrapper = mount(CommandPicker, {
      props: { personas: [persona], models: [model], skills: [], override: null, skillHints: [], defaultModel: 'claude-opus-4-8' },
      attachTo: document.body,
    })
    await wrapper.find('[data-testid="command-picker-trigger"]').trigger('click')
    // PopoverContent is portaled into document.body — search there.
    const clearBtn = document.querySelector('[data-testid="clear-conversation"]')
    expect(clearBtn).not.toBeNull()
    ;(clearBtn as HTMLElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('clear-conversation')).toBeTruthy()
    wrapper.unmount()
  })

  it('shows Thinking Effort for a thinking-capable effective model', async () => {
    await openPicker({
      personas: [persona], models: [model], skills: [],
      override: { model: 'claude-opus-4-8' }, skillHints: [],
      defaultModel: 'claude-opus-4-8',
    })
    const heading = document.querySelector('[data-testid="thinking-section"]')
    expect(heading).not.toBeNull()
    const levelBtns = document.querySelectorAll('[data-testid^="thinking-level-"]')
    expect(levelBtns.length).toBe(4) // none, low, medium, high
  })

  it('hides Thinking Effort when the effective model does not support thinking', async () => {
    await openPicker({
      personas: [persona], models: [model, nonThinkingModel], skills: [],
      override: { model: 'gpt-4o' }, skillHints: [],
      defaultModel: 'claude-opus-4-8',
    })
    expect(document.querySelector('[data-testid="thinking-section"]')).toBeNull()
  })

  it('falls back to defaultModel when override has no model', async () => {
    await openPicker({
      personas: [persona], models: [model, nonThinkingModel], skills: [],
      override: null, skillHints: [],
      defaultModel: 'gpt-4o', // default is non-thinking
    })
    expect(document.querySelector('[data-testid="thinking-section"]')).toBeNull()
  })

  it('clears thinkingBudget when switching to a non-thinking model', async () => {
    const wrapper = await openPicker({
      personas: [persona], models: [model, nonThinkingModel], skills: [],
      override: { model: 'claude-opus-4-8', thinkingBudget: 'high' }, skillHints: [],
      defaultModel: 'claude-opus-4-8',
    })
    // Click the non-thinking model row
    const gpt = document.querySelector('[data-testid="model-row-gpt-4o"]') as HTMLElement
    gpt.click()
    await wrapper.vm.$nextTick()
    const last = wrapper.emitted('update:override')!.at(-1)![0] as Record<string, unknown> | null
    expect(last).not.toBeNull()
    expect(last!.model).toBe('gpt-4o')
    expect(last!.thinkingBudget).toBeUndefined()
  })
})
