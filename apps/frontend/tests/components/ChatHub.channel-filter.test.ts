import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return { ...orig, useI18n: () => ({ t: (k: string) => k }) }
})

vi.mock('~/stores/lastConversation', () => ({
  useLastConversationStore: () => ({ remember: vi.fn(), lastId: null }),
}))

vi.mock('~/stores/auth', () => ({
  useAuthStore: () => ({ logout: vi.fn(), user: { name: 'Test' } }),
}))

const mockGet = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: mockGet,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}))

describe('ChatHub channel filtering', () => {
  it('shows web and cline conversations, excludes task', async () => {
    const fakeConversations = [
      { id: 1, channel: 'web', title: 'Web chat', updated_at: 1000, bookmarked: false, expires_at: null, started_at: 900 },
      { id: 2, channel: 'cline', title: 'VS Code', updated_at: 999, bookmarked: false, expires_at: null, started_at: 899 },
      { id: 3, channel: 'task', title: 'Scheduled', updated_at: 998, bookmarked: false, expires_at: null, started_at: 898 },
    ]

    mockGet.mockResolvedValue(fakeConversations)

    const { default: ChatHub } = await import('@holzi/ui/components/chat/Hub.vue')
    const wrapper = mount(ChatHub, {
      global: {
        stubs: {
          ChatConversationList: {
            name: 'ChatConversationList',
            props: ['conversations', 'activeId'],
            template: '<div><span v-for="c in conversations" :key="c.id" :data-channel="c.channel">{{ c.id }}</span></div>',
          },
          Teleport: true,
        },
      },
    })

    await vi.waitFor(() => {
      const spans = wrapper.findAll('[data-channel]')
      expect(spans.length).toBeGreaterThan(0)
    })

    const channels = wrapper.findAll('[data-channel]').map(s => s.attributes('data-channel'))
    expect(channels).toContain('web')
    expect(channels).toContain('cline')
    expect(channels).not.toContain('task')
  })
})
