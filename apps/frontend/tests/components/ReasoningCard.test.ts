import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ReasoningCard from '~/components/chat/ReasoningCard.vue'
import { useReasoningPreference } from '~/composables/useReasoningPreference'

describe('ReasoningCard.vue', () => {
  beforeEach(() => {
    // Reset the shared preference between tests (collapsed by default).
    window.localStorage.clear()
    useReasoningPreference().setShowReasoningByDefault(false)
  })

  it('is collapsed by default and expands on click', async () => {
    const wrapper = mount(ReasoningCard, {
      props: { content: 'first I considered the options' },
    })
    // Header label always visible; the reasoning text hidden while collapsed.
    expect(wrapper.text()).toContain('components.reasoningCard.title')
    expect(wrapper.text()).not.toContain('first I considered')

    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toContain('first I considered the options')
  })

  it('starts expanded when the show-by-default preference is on', () => {
    useReasoningPreference().setShowReasoningByDefault(true)
    const wrapper = mount(ReasoningCard, {
      props: { content: 'visible immediately' },
    })
    expect(wrapper.text()).toContain('visible immediately')
  })

  it('shows a thinking indicator while streaming', () => {
    const wrapper = mount(ReasoningCard, {
      props: { content: 'partial', streaming: true },
    })
    expect(wrapper.text()).toContain('components.reasoningCard.thinking')
  })
})
