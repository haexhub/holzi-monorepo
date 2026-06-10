import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return { ...orig, useI18n: () => ({ t: (k: string) => k }) }
})

const apiGet = vi.fn((path: string) => {
  if (path === '/api/conversations') return Promise.resolve([])
  return Promise.resolve({ id: 1, messages: [] })
})

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: apiGet,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}))

vi.mock('~/composables/useChatStream', async (importOriginal) => {
  const orig = await importOriginal<typeof import('~/composables/useChatStream')>()
  return {
    ...orig,
    sendChatMessage: vi.fn(async (_payload, callbacks) => {
      callbacks.onSession?.(1)
      return { conversationId: 1, runId: null, text: '', cancelled: false }
    }),
  }
})

describe('ChatHub first-message emit', () => {
  it('emits first-message exactly once, on the first send of a new chat', async () => {
    const { default: ChatHub } = await import('@holzi/ui/components/chat/Hub.vue')
    const wrapper = mount(ChatHub, {
      global: {
        stubs: {
          ChatConversationList: true,
          Teleport: true,
        },
      },
    })

    const composer = wrapper.findComponent({ name: 'ChatComposer' })
    await composer.vm.$emit('send', { text: 'Hello there', files: [] })
    await composer.vm.$emit('send', { text: 'Second message', files: [] })

    expect(wrapper.emitted('first-message')).toEqual([['Hello there']])
  })
})
