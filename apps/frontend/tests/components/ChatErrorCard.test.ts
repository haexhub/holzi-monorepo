import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (params) return `${key}(${JSON.stringify(params)})`
        return key
      },
    }),
  }
})

vi.mock('#imports', () => ({
  useLocalePath: () => (path: string) => path,
  navigateTo: vi.fn(),
}))

import ChatErrorCard from '~/components/chat/ErrorCard.vue'
import { ChatStreamError } from '~/composables/useChatStream'

describe('ChatErrorCard.vue', () => {
  it('renders the error code i18n key as heading', () => {
    const err = new ChatStreamError('Rate limit exceeded', {
      code: 'upstream_rate_limited',
      statusCode: 429,
    })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).toContain('errors.chat.upstream_rate_limited')
  })

  it('shows model-switch hint for upstream provider errors', () => {
    const err = new ChatStreamError('overloaded', {
      code: 'upstream_http_error',
      statusCode: 503,
    })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).toContain('errors.chat.hintModelSwitch')
  })

  it('shows model-switch hint for rate-limited errors', () => {
    const err = new ChatStreamError('rate limited', {
      code: 'upstream_rate_limited',
      statusCode: 429,
    })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).toContain('errors.chat.hintModelSwitch')
  })

  it('shows model-switch hint for timeout errors', () => {
    const err = new ChatStreamError('timeout', { code: 'upstream_timeout', statusCode: 504 })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).toContain('errors.chat.hintModelSwitch')
  })

  it('does NOT show model-switch hint for agent_error', () => {
    const err = new ChatStreamError('something broke', { code: 'agent_error', statusCode: 500 })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).not.toContain('errors.chat.hintModelSwitch')
  })

  it('does NOT show model-switch hint for unreachable errors', () => {
    const err = new ChatStreamError('connection refused', { code: 'upstream_unreachable', statusCode: 502 })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).not.toContain('errors.chat.hintModelSwitch')
  })

  it('emits dismiss when the close button is clicked', async () => {
    const err = new ChatStreamError('x', { code: 'agent_error', statusCode: 500 })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    const closeBtn = wrapper.find('[aria-label]')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })
})
