import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

vi.mock('#imports', () => ({
  useLocalePath: () => (p: string) => p,
}))

import ChatHeaderPill from '~/components/chat/HeaderPill.vue'
import type { Persona } from '~/types/api'

const basePersona: Persona = {
  id: 1,
  name: 'Hermes',
  soul: '',
  identity: '',
  agents: '',
  is_default: true,
  llm_credential_id: null,
  model: null,
  created_at: 0,
  updated_at: 0,
}

describe('ChatHeaderPill.vue', () => {
  it('shows persona name and model from resolved context', () => {
    const wrapper = mount(ChatHeaderPill, {
      props: {
        personaName: 'Hermes',
        model: 'claude-opus-4-7',
        personas: [basePersona],
        override: null,
      },
    })
    expect(wrapper.text()).toContain('Hermes')
    expect(wrapper.text()).toContain('claude-opus-4-7')
  })

  it('shows override badge when override is active', () => {
    const wrapper = mount(ChatHeaderPill, {
      props: {
        personaName: 'Hermes',
        model: 'claude-opus-4-7',
        personas: [basePersona],
        override: { model: 'claude-sonnet-4-6' },
      },
    })
    expect(wrapper.text()).toContain('claude-sonnet-4-6')
    expect(wrapper.text()).toContain('components.chatHub.contextPill.overrideActive')
  })

  it('emits clear when the clear-override button is clicked', async () => {
    const wrapper = mount(ChatHeaderPill, {
      props: {
        personaName: 'Hermes',
        model: 'claude-opus-4-7',
        personas: [basePersona],
        override: { model: 'claude-sonnet-4-6' },
      },
    })
    const clearBtn = wrapper.find('[data-testid="clear-override"]')
    expect(clearBtn.exists()).toBe(true)
    await clearBtn.trigger('click')
    expect(wrapper.emitted('clear')).toBeTruthy()
  })
})
