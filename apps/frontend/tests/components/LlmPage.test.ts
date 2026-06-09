import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// vue-i18n needs the same importOriginal treatment as PreferencesPage —
// without it, the partial mock would shadow createI18n and break the
// plugin chain during the @nuxtjs/i18n init that runs in the nuxt env.
const setLocaleMock = vi.fn()
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({
      t: (key: string) => key,
      locale: { value: 'de' },
      locales: {
        value: [
          { code: 'de', name: 'Deutsch' },
          { code: 'en', name: 'English' },
        ],
      },
      setLocale: setLocaleMock,
    }),
  }
})

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPut = vi.fn()
const apiDelete = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (p: string, q?: Record<string, unknown>) => apiGet(p, q),
    post: (p: string, b?: unknown) => apiPost(p, b),
    put: (p: string, b?: unknown) => apiPut(p, b),
    patch: vi.fn(),
    delete: (p: string, b?: unknown) => apiDelete(p, b),
  }),
}))

import LlmPage from '~/pages/settings/llm.vue'

describe('settings/llm.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiPut.mockReset()
    apiDelete.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders i18n keys for title, description and empty list', async () => {
    apiGet.mockResolvedValue([])
    const wrapper = mount(LlmPage)
    // Wait until the empty-state path is reached (loading flipped to
    // false, credentials list resolved empty).
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('pages.llm.list.empty')
    })
    const text = wrapper.text()
    expect(text).toContain('pages.llm.title')
    expect(text).toContain('pages.llm.description')
    expect(text).toContain('pages.llm.list.heading')
    expect(text).toContain('pages.llm.addKey.heading')
    expect(text).toContain('pages.llm.oauth.heading')
    // No raw German strings left in the migrated page.
    expect(text).not.toContain('LLM-Credentials')
    expect(text).not.toContain('Vorhanden')
    expect(text).not.toContain('Noch keine Credentials')
    expect(text).not.toContain('API-Key hinzufügen')
    expect(text).not.toContain('Claude (OAuth)')
  })
})
