import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// logs.vue calls useI18n() in its setup for toast messages; without the
// importOriginal-preserving mock the bare vitest mount has no i18n plugin
// installed and useI18n throws. t() is a passthrough on the key.
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import LogsPage from '~/pages/settings/logs.vue'
import type { LogsResponse } from '~/types/api'

const apiGet = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) => apiGet(path, query),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}))

vi.mock('~/composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

function logs(rows: LogsResponse['rows']): LogsResponse {
  return { rows }
}

const SAMPLE_ROWS: LogsResponse['rows'] = [
  {
    timestamp: '2026-05-30T10:00:00Z',
    level: 'info',
    event: 'hermes_starting',
    version: '1.0.0',
  },
  {
    timestamp: '2026-05-30T10:00:05Z',
    level: 'warning',
    event: 'slow_upstream',
    duration_ms: 800,
  },
  {
    timestamp: '2026-05-30T10:00:10Z',
    level: 'error',
    event: 'upstream_timeout',
    error: 'TimeoutError',
  },
]

describe('settings/logs.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
    vi.useFakeTimers()
    // jsdom doesn't ship a clipboard implementation by default; the getter
    // on `navigator.clipboard` is read-only, so override it via defineProperty.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('loads /api/logs with the default tail + min_level and renders rows', async () => {
    apiGet.mockResolvedValue(logs(SAMPLE_ROWS))
    const wrapper = mount(LogsPage)
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/logs', {
      tail: 100,
      min_level: 'info',
    })
    expect(wrapper.get('[data-testid="logs-row-0"]').text()).toContain(
      'hermes_starting',
    )
    expect(wrapper.get('[data-testid="logs-row-2"]').text()).toContain(
      'upstream_timeout',
    )
  })

  it('switching min_level refetches with the new query', async () => {
    apiGet.mockResolvedValue(logs(SAMPLE_ROWS))
    const wrapper = mount(LogsPage)
    await flushPromises()
    apiGet.mockClear()
    apiGet.mockResolvedValue(logs([SAMPLE_ROWS[2]!]))

    await wrapper.get('[data-testid="logs-level-error"]').trigger('click')
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/logs', {
      tail: 100,
      min_level: 'error',
    })
  })

  it('switching tail refetches with the new size', async () => {
    apiGet.mockResolvedValue(logs(SAMPLE_ROWS))
    const wrapper = mount(LogsPage)
    await flushPromises()
    apiGet.mockClear()
    apiGet.mockResolvedValue(logs(SAMPLE_ROWS))

    await wrapper.get('[data-testid="logs-tail-1000"]').trigger('click')
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/logs', {
      tail: 1000,
      min_level: 'info',
    })
  })

  it('substring search filters the rendered rows', async () => {
    apiGet.mockResolvedValue(logs(SAMPLE_ROWS))
    const wrapper = mount(LogsPage)
    await flushPromises()

    const search = wrapper.get('[data-testid="logs-search"]')
    await search.setValue('upstream_timeout')
    await flushPromises()

    expect(wrapper.find('[data-testid="logs-row-0"]').exists()).toBe(true)
    // After filtering only one row remains; subsequent indices fall away.
    expect(wrapper.find('[data-testid="logs-row-1"]').exists()).toBe(false)
  })

  it('renders the disabled banner on a 503 from /api/logs', async () => {
    apiGet.mockRejectedValue({ statusCode: 503, message: 'log file unset' })
    const wrapper = mount(LogsPage)
    await flushPromises()

    expect(wrapper.get('[data-testid="logs-disabled"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="logs-error"]').exists()).toBe(false)
  })

  it('renders a generic error on non-503 failures', async () => {
    apiGet.mockRejectedValue(new Error('network gone'))
    const wrapper = mount(LogsPage)
    await flushPromises()

    // Plan 30: translateError() falls back to `errors.GENERIC` for an
    // Error with no backend ErrorCode; the passthrough `$t` stub returns
    // the key verbatim, so the banner shows the key.
    expect(wrapper.get('[data-testid="logs-error"]').text()).toContain(
      'errors.GENERIC',
    )
  })

  it('copy button writes the visible rows to the clipboard and toasts', async () => {
    apiGet.mockResolvedValue(logs(SAMPLE_ROWS))
    const wrapper = mount(LogsPage)
    await flushPromises()

    await wrapper.get('[data-testid="logs-copy"]').trigger('click')
    await flushPromises()

    expect(navigator.clipboard.writeText).toHaveBeenCalled()
    const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string
    expect(written.split('\n').length).toBe(3)
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('shows the empty state when the file has no rows yet', async () => {
    apiGet.mockResolvedValue(logs([]))
    const wrapper = mount(LogsPage)
    await flushPromises()

    expect(wrapper.get('[data-testid="logs-empty"]').exists()).toBe(true)
  })

  it('shows a no-match line when a search filters everything out', async () => {
    apiGet.mockResolvedValue(logs(SAMPLE_ROWS))
    const wrapper = mount(LogsPage)
    await flushPromises()

    await wrapper.get('[data-testid="logs-search"]').setValue('zzz-nothing')
    await flushPromises()

    expect(wrapper.get('[data-testid="logs-no-match"]').exists()).toBe(true)
  })

  it('copy-all writes only the visible rows after a search filter', async () => {
    apiGet.mockResolvedValue(logs(SAMPLE_ROWS))
    const wrapper = mount(LogsPage)
    await flushPromises()

    await wrapper
      .get('[data-testid="logs-search"]')
      .setValue('upstream_timeout')
    await flushPromises()
    await wrapper.get('[data-testid="logs-copy"]').trigger('click')
    await flushPromises()

    const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string
    expect(written.split('\n').length).toBe(1)
    expect(written).toContain('upstream_timeout')
    expect(written).not.toContain('hermes_starting')
  })

  it('refetches on the 5s auto-refresh tick while visible', async () => {
    apiGet.mockResolvedValue(logs(SAMPLE_ROWS))
    mount(LogsPage)
    await flushPromises()
    apiGet.mockClear()

    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()

    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(apiGet).toHaveBeenCalledWith('/api/logs', {
      tail: 100,
      min_level: 'info',
    })
  })

  it('drops _raw from the detail span on malformed lines (no duplication)', async () => {
    const raw = '<<not json>>'
    apiGet.mockResolvedValue(logs([{ _raw: raw }]))
    const wrapper = mount(LogsPage)
    await flushPromises()

    const row = wrapper.get('[data-testid="logs-row-0"]')
    // The event slot already carries _raw; counting occurrences guards
    // against the prior bug where the detail span re-stringified it.
    expect(row.text().split(raw).length - 1).toBe(1)
  })
})
