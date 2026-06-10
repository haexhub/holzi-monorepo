import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

// Plan 30 Wave 0: the page uses useI18n() for the toast message; stub it
// so the test asserts on the i18n key.
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import ChatIdPage from '~/pages/chat/[id].vue'

// Plan 26: deep-link route `/chat/:id`. The page parses the param,
// validates the conversation via /api/conversations/:id, and hands the
// id to <ChatHub>. On 404 it toasts and redirects to `/`.

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

const toastError = vi.fn()
vi.mock('~/composables/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

// A reactive params ref so the page's `computed(() => route.params.id)`
// actually re-fires when the test mutates the value (the page watches
// the computed to re-validate on back/forward).
const routeParams = ref<Record<string, string | string[] | undefined>>({ id: '42' })
const navigateMock = vi.fn()
vi.mock('#app/composables/router', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>()
  return {
    ...mod,
    useRoute: () => ({
      get params() {
        return routeParams.value
      },
    }),
    navigateTo: (...args: unknown[]) => navigateMock(...args),
  }
})

// ChatHub does a lot on mount (resizable refs, useApi calls, …). The
// /chat/:id page-level concerns are entirely about validation + the
// id we hand to the hub, so stub the hub down to a marker element.
vi.mock('~/components/ChatHub.vue', () => ({
  default: {
    name: 'ChatHubStub',
    props: ['conversationId'],
    template: '<div data-testid="chathub-stub" :data-id="conversationId" />',
  },
}))

beforeEach(() => {
  apiGet.mockReset()
  toastError.mockReset()
  navigateMock.mockReset()
  routeParams.value = { id: '42' }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('pages/chat/[id].vue', () => {
  it('validates the id against the API and mounts ChatHub on success', async () => {
    apiGet.mockResolvedValueOnce({ id: 42, messages: [] })
    const wrapper = mount(ChatIdPage)
    await flushPromises()
    expect(apiGet).toHaveBeenCalledWith('/api/conversations/42', undefined)
    const stub = wrapper.find('[data-testid="chathub-stub"]')
    expect(stub.exists()).toBe(true)
    expect(stub.attributes('data-id')).toBe('42')
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('toasts + redirects to / on 404', async () => {
    const err = Object.assign(new Error('not found'), { statusCode: 404 })
    apiGet.mockRejectedValueOnce(err)
    const wrapper = mount(ChatIdPage)
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith('pages.chat.notFound')
    // useLocalePath() may return '/en' under the EN locale — match either.
    expect(navigateMock).toHaveBeenLastCalledWith(expect.stringMatching(/^\/(en\/?)?$/), { replace: true })
    // No hub mounted while invalid.
    expect(wrapper.find('[data-testid="chathub-stub"]').exists()).toBe(false)
  })

  it('rejects non-numeric ids and redirects to / without an API call', async () => {
    routeParams.value = { id: 'does-not-exist' }
    mount(ChatIdPage)
    await flushPromises()
    expect(apiGet).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('pages.chat.notFound')
    // useLocalePath() may return '/en' under the EN locale — match either.
    expect(navigateMock).toHaveBeenLastCalledWith(expect.stringMatching(/^\/(en\/?)?$/), { replace: true })
  })

  it('does NOT redirect on 401 (auth middleware owns that path)', async () => {
    const err = Object.assign(new Error('unauthorized'), { statusCode: 401 })
    apiGet.mockRejectedValueOnce(err)
    mount(ChatIdPage)
    await flushPromises()
    expect(toastError).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('re-validates when the route param changes', async () => {
    apiGet.mockResolvedValue({ id: 0, messages: [] })
    mount(ChatIdPage)
    await flushPromises()
    expect(apiGet).toHaveBeenCalledWith('/api/conversations/42', undefined)
    routeParams.value = { id: '99' }
    await flushPromises()
    expect(apiGet).toHaveBeenCalledWith('/api/conversations/99', undefined)
  })
})
