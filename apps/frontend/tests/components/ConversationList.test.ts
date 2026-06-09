import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key,
    }),
  }
})

import ConversationList from '~/components/chat/ConversationList.vue'
import type { Conversation } from '~/types/api'

// Plan 26: deep-links rely on `select` carrying the row id so the
// parent can `navigateTo(/chat/<id>)`. These tests guard that emit
// contract — without it the URL would never change on click.

function conversation(overrides: Partial<Conversation> & { id: number }): Conversation {
  return {
    id: overrides.id,
    title: overrides.title ?? `Chat #${overrides.id}`,
    channel: overrides.channel ?? 'web',
    bookmarked: overrides.bookmarked ?? false,
    message_count: overrides.message_count ?? 0,
    started_at: overrides.started_at ?? 1_700_000_000,
    updated_at: overrides.updated_at ?? 1_700_000_000,
    expires_at: overrides.expires_at ?? null,
  }
}

// useConfirm pulls in a global dialog host that doesn't exist in the test
// environment; stub it so the click handlers can run without it.
vi.mock('~/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: () => Promise.resolve(true) }),
}))

describe('ConversationList', () => {
  it('emits select with the row id on click', async () => {
    const conversations = [
      conversation({ id: 1, title: 'Erstes Gespräch' }),
      conversation({ id: 2, title: 'Zweites Gespräch' }),
    ]
    const wrapper = mount(ConversationList, {
      props: { conversations, activeId: null },
    })
    const rows = wrapper.findAll('[role="button"]')
    expect(rows.length).toBe(2)
    await rows[1]!.trigger('click')
    const emitted = wrapper.emitted('select')
    expect(emitted).toBeTruthy()
    expect(emitted!.length).toBe(1)
    expect(emitted![0]).toEqual([2])
  })

  it('emits select on keyboard Enter for accessibility', async () => {
    const conversations = [conversation({ id: 5 })]
    const wrapper = mount(ConversationList, {
      props: { conversations, activeId: null },
    })
    const row = wrapper.get('[role="button"]')
    await row.trigger('keydown', { key: 'Enter' })
    const emitted = wrapper.emitted('select')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([5])
  })

  it('emits new-chat from the "new" button (used by Plan 26 to route back to /)', async () => {
    const wrapper = mount(ConversationList, {
      props: { conversations: [], activeId: null },
    })
    // The header has the new-chat button — find it by i18n key.
    const buttons = wrapper.findAll('button')
    const neu = buttons.find((b) => b.text().includes('components.conversationList.new'))
    expect(neu).toBeTruthy()
    await neu!.trigger('click')
    expect(wrapper.emitted('new-chat')).toBeTruthy()
  })
})
