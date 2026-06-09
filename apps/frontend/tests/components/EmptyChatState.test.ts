import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Plan 30: useDiagnostics() now pulls in useI18n() for the translateError
// helper, so the i18n plugin must be present or stubbed before the
// composable runs. Pass-through `$t` is enough — these tests don't assert
// on translated copy directly.
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import EmptyChatState from '~/components/chat/EmptyChatState.vue'
import type { DiagnosticsResponse } from '~/types/api'

// Plan 20-C: EmptyChatState fetches /api/diagnostics when the user has
// credentials so it can surface "Setup unvollständig" with a link to
// /settings/diagnostics. These tests cover the matrix of credential
// state × diagnostics overall, plus the silent-fallthrough on fetch error.

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

const stubs = {
  // NuxtLink isn't registered without a Nuxt runtime; render the href so
  // tests can assert it. The default slot becomes the link's text body.
  NuxtLink: {
    name: 'NuxtLink',
    props: ['to'],
    template: '<a :href="to" data-stub-nuxtlink><slot /></a>',
  },
  // The shared shadcn-vue Button uses Radix internals that don't survive
  // happy-dom cleanly here; stub it to a plain wrapper since these tests
  // never assert on the Button itself.
  Button: {
    name: 'Button',
    props: ['size', 'asChild'],
    template: '<div data-stub-button><slot /></div>',
  },
}

function diagnostics(
  overall: DiagnosticsResponse['overall'],
  nonOkCount = 0,
): DiagnosticsResponse {
  // Plan 30 shape: id / status / code / params — `label` and `message`
  // are owned by the locale files, not the API.
  const checks: DiagnosticsResponse['checks'] = [
    { id: 'database', status: 'ok', code: 'DIAG_DB_REACHABLE', params: {} },
    { id: 'llm', status: 'ok', code: 'DIAG_LLM_ACTIVE', params: {} },
    {
      id: 'scheduler',
      status: 'ok',
      code: 'DIAG_SCHEDULER_RUNNING',
      params: {},
    },
    {
      id: 'workspace',
      status: 'ok',
      code: 'DIAG_WORKSPACE_CONFIGURED',
      params: {},
    },
    {
      id: 'sandbox',
      status: 'ok',
      code: 'DIAG_SANDBOX_CONFIGURED',
      params: {},
    },
  ]
  for (let i = 0; i < nonOkCount && i < checks.length; i++) {
    checks[i] = {
      ...checks[i],
      status: overall === 'error' ? 'error' : 'warning',
    }
  }
  return { overall, checks }
}

beforeEach(() => {
  apiGet.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('EmptyChatState', () => {
  it('renders nothing while credentials are still loading', () => {
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: null },
      global: { stubs },
    })
    expect(wrapper.text()).toBe('')
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('renders the credentials CTA and does NOT fetch diagnostics when credentials are missing', () => {
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: false },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('components.emptyChatState.welcome.title')
    expect(wrapper.text()).toContain('components.emptyChatState.welcome.cta')
    expect(wrapper.find('[data-testid="empty-state-diagnostics-banner"]').exists()).toBe(false)
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('renders just "Sag Hermes Hallo." when diagnostics overall is ok', async () => {
    apiGet.mockResolvedValueOnce(diagnostics('ok'))
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: true },
      global: { stubs },
    })
    await flushPromises()
    expect(apiGet).toHaveBeenCalledWith('/api/diagnostics', undefined)
    expect(wrapper.text()).toContain('components.emptyChatState.hello')
    expect(wrapper.find('[data-testid="empty-state-diagnostics-banner"]').exists()).toBe(false)
  })

  it('renders the diagnostics banner with plural copy for >1 finding', async () => {
    apiGet.mockResolvedValueOnce(diagnostics('warning', 2))
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: true },
      global: { stubs },
    })
    await flushPromises()
    const banner = wrapper.find('[data-testid="empty-state-diagnostics-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('components.emptyChatState.banner.title')
    expect(banner.text()).toContain('2')
    expect(banner.text()).toContain('components.emptyChatState.banner.findingPlural')
    expect(banner.attributes('href')).toBe('/settings/diagnostics')
  })

  it('renders the diagnostics banner with singular copy for exactly 1 finding', async () => {
    apiGet.mockResolvedValueOnce(diagnostics('error', 1))
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: true },
      global: { stubs },
    })
    await flushPromises()
    const banner = wrapper.find('[data-testid="empty-state-diagnostics-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('1')
    expect(banner.text()).toContain('components.emptyChatState.banner.findingSingular')
  })

  it('falls through silently when /api/diagnostics rejects', async () => {
    apiGet.mockRejectedValueOnce(new Error('connectivity'))
    const wrapper = mount(EmptyChatState, {
      props: { hasCredentials: true },
      global: { stubs },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('components.emptyChatState.hello')
    expect(wrapper.find('[data-testid="empty-state-diagnostics-banner"]').exists()).toBe(false)
  })
})
