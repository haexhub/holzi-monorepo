import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// Plan 30 Wave 0: ToolCallCard's script uses useI18n() for the status label;
// stub it with a passthrough so tests assert on the i18n key.
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import ToolCallCard from '~/components/chat/ToolCallCard.vue'

describe('ToolCallCard.vue', () => {
  it('renders a collapsed success summary and expands to show the result', async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: {
          name: 'notes.find',
          arguments: { query: 'status' },
          status: 'success',
          result: 'found 3 notes',
          error: null,
        },
      },
    })
    // Collapsed: name + status visible, details hidden.
    expect(wrapper.text()).toContain('notes.find')
    expect(wrapper.text()).toContain('components.toolCallCard.status.success')
    expect(wrapper.text()).not.toContain('found 3 notes')

    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toContain('found 3 notes')
    expect(wrapper.text()).toContain('status') // argument value
  })

  it('renders an error card and shows the error text when expanded', async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: {
          name: 'shell.run',
          arguments: {},
          status: 'error',
          result: null,
          error: 'error: command not found',
        },
      },
    })
    expect(wrapper.text()).toContain('shell.run')
    expect(wrapper.text()).toContain('components.toolCallCard.status.error')

    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toContain('command not found')
  })

  it('shows a running state and is not expandable without details', async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: {
          name: 'web.search',
          arguments: {},
          status: 'running',
          result: null,
          error: null,
        },
      },
    })
    expect(wrapper.text()).toContain('web.search')
    expect(wrapper.text()).toContain('components.toolCallCard.status.running')
    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()
    // Clicking a detail-less card does nothing.
    await button.trigger('click')
    expect(wrapper.find('pre').exists()).toBe(false)
  })

  it('is expandable while running if arguments are present', async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        toolCall: {
          name: 'web.search',
          arguments: { q: 'holzi' },
          status: 'running',
          result: null,
          error: null,
        },
      },
    })
    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toContain('holzi')
  })
})
