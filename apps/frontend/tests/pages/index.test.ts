import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import IndexPage from '~/pages/index.vue'

// Plan 26: `/` reads holzi.lastConversationId, validates it, and
// either redirects to /chat/:id or renders the empty hub. These tests
// guard each branch.

const apiGet = vi.fn()
vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) => apiGet(path, query),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}))

const navigateMock = vi.fn()
vi.mock('#app/composables/router', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>()
  return {
    ...mod,
    navigateTo: (...args: unknown[]) => navigateMock(...args),
  }
})

vi.mock('~/components/ChatHub.vue', () => ({
  default: {
    name: 'ChatHubStub',
    props: { conversationId: { type: Number, default: null } },
    template: '<div data-testid="chathub-stub" :data-id="conversationId === null ? \'null\' : conversationId" />',
  },
}))

beforeEach(() => {
  apiGet.mockReset()
  navigateMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('pages/index.vue', () => {
  it('renders the empty hub when no last-active id is stored', async () => {
    const wrapper = mount(IndexPage)
    await flushPromises()
    expect(apiGet).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
    const stub = wrapper.find('[data-testid="chathub-stub"]')
    expect(stub.exists()).toBe(true)
    expect(stub.attributes('data-id')).toBe('null')
  })

  it('redirects to /chat/:id when the stored conversation is reachable', async () => {
    localStorage.setItem('holzi.lastConversationId', '7')
    apiGet.mockResolvedValueOnce({ id: 7, messages: [] })
    const wrapper = mount(IndexPage)
    await flushPromises()
    expect(apiGet).toHaveBeenCalledWith('/api/conversations/7', undefined)
    // useLocalePath() can return a prefixed path (/en/chat/7) under EN —
    // assert the chat-route suffix instead of pinning the locale prefix.
    expect(navigateMock).toHaveBeenCalledTimes(1)
    const [target, opts] = navigateMock.mock.calls[0]!
    expect(target).toMatch(/\/chat\/7$/)
    expect(opts).toEqual({ replace: true })
    // The hub never mounts during a pending redirect.
    expect(wrapper.find('[data-testid="chathub-stub"]').exists()).toBe(false)
  })

  it('drops the stale pointer and renders the empty hub when the stored id 404s', async () => {
    localStorage.setItem('holzi.lastConversationId', '99')
    apiGet.mockRejectedValueOnce(Object.assign(new Error('not found'), { statusCode: 404 }))
    const wrapper = mount(IndexPage)
    await flushPromises()
    expect(navigateMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('holzi.lastConversationId')).toBeNull()
    const stub = wrapper.find('[data-testid="chathub-stub"]')
    expect(stub.exists()).toBe(true)
    expect(stub.attributes('data-id')).toBe('null')
  })

  it('ignores a malformed stored id', async () => {
    localStorage.setItem('holzi.lastConversationId', 'not-a-number')
    const wrapper = mount(IndexPage)
    await flushPromises()
    expect(apiGet).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="chathub-stub"]').exists()).toBe(true)
  })
})
