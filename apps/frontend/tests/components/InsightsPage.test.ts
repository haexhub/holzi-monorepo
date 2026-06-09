import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// insights.vue calls useI18n() in setup for the period labels; without the
// importOriginal-preserving mock the bare mount has no i18n plugin and
// useI18n throws. t() is a passthrough on the key.
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import InsightsPage from '~/pages/settings/insights.vue'
import type { InsightsResponse } from '~/types/api'

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

function insights(overrides: Partial<InsightsResponse> = {}): InsightsResponse {
  return {
    period: overrides.period ?? '7d',
    totals: overrides.totals ?? {
      runs: 12,
      input_tokens: 100_000,
      output_tokens: 200_000,
      errors: 1,
    },
    series: overrides.series ?? [
      { bucket: '2026-05-25', input_tokens: 10, output_tokens: 20, runs: 1 },
      { bucket: '2026-05-26', input_tokens: 0, output_tokens: 0, runs: 0 },
      { bucket: '2026-05-27', input_tokens: 50, output_tokens: 80, runs: 3 },
      { bucket: '2026-05-28', input_tokens: 200, output_tokens: 300, runs: 5 },
      { bucket: '2026-05-29', input_tokens: 0, output_tokens: 0, runs: 0 },
      { bucket: '2026-05-30', input_tokens: 90, output_tokens: 150, runs: 2 },
      { bucket: '2026-05-31', input_tokens: 100, output_tokens: 200, runs: 1 },
    ],
    by_model: overrides.by_model ?? [
      {
        model: 'claude-opus-4-7',
        runs: 8,
        input_tokens: 80_000,
        output_tokens: 150_000,
        errors: 0,
      },
      {
        model: 'gpt-4o',
        runs: 4,
        input_tokens: 20_000,
        output_tokens: 50_000,
        errors: 1,
      },
    ],
    by_status: overrides.by_status ?? {
      success: 11,
      error: 1,
      cancelled: 0,
      running: 0,
    },
  }
}

describe('settings/insights.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('loads /api/insights with the default 7d period and renders KPI tiles', async () => {
    apiGet.mockResolvedValue(insights())
    const wrapper = mount(InsightsPage)
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/insights', { period: '7d' })
    expect(wrapper.get('[data-testid="insights-tile-runs"]').text()).toContain(
      '12',
    )
    expect(wrapper.get('[data-testid="insights-tile-errors"]').text()).toContain(
      '1',
    )
    // Cost tile renders a known model's estimated USD.
    const cost = wrapper.get('[data-testid="insights-tile-cost"]').text()
    expect(cost).toMatch(/\$/)
  })

  it('renders one bar per bucket, including zero-fills', async () => {
    apiGet.mockResolvedValue(insights())
    const wrapper = mount(InsightsPage)
    await flushPromises()

    for (const day of [
      '2026-05-25',
      '2026-05-26',
      '2026-05-27',
      '2026-05-28',
      '2026-05-29',
      '2026-05-30',
      '2026-05-31',
    ]) {
      expect(
        wrapper.find(`[data-testid="insights-bucket-${day}"]`).exists(),
        `bar for ${day} missing`,
      ).toBe(true)
    }
  })

  it('renders the per-model table with each row', async () => {
    apiGet.mockResolvedValue(insights())
    const wrapper = mount(InsightsPage)
    await flushPromises()

    expect(
      wrapper.get('[data-testid="insights-model-claude-opus-4-7"]').exists(),
    ).toBe(true)
    expect(wrapper.get('[data-testid="insights-model-gpt-4o"]').exists()).toBe(
      true,
    )
  })

  it('clicking a different period refetches with that query', async () => {
    apiGet.mockResolvedValue(insights())
    const wrapper = mount(InsightsPage)
    await flushPromises()
    apiGet.mockClear()
    apiGet.mockResolvedValue(insights({ period: '30d' }))

    await wrapper.get('[data-testid="insights-period-30d"]').trigger('click')
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/insights', { period: '30d' })
  })

  it('renders status counts for every status', async () => {
    apiGet.mockResolvedValue(
      insights({ by_status: { success: 5, error: 2, cancelled: 1, running: 3 } }),
    )
    const wrapper = mount(InsightsPage)
    await flushPromises()

    const statusEl = wrapper.get('[data-testid="insights-by-status"]')
    expect(statusEl.text()).toContain('5') // success
    expect(statusEl.text()).toContain('2') // error
    expect(statusEl.text()).toContain('1') // cancelled
    expect(statusEl.text()).toContain('3') // running
  })

  it('shows the empty hint when no runs in window', async () => {
    apiGet.mockResolvedValue(
      insights({
        totals: { runs: 0, input_tokens: 0, output_tokens: 0, errors: 0 },
        by_model: [],
      }),
    )
    const wrapper = mount(InsightsPage)
    await flushPromises()

    expect(wrapper.get('[data-testid="insights-empty"]').exists()).toBe(true)
  })

  it('sorts per-model rows by the active column', async () => {
    apiGet.mockResolvedValue(insights())
    const wrapper = mount(InsightsPage)
    await flushPromises()

    // Default sort = runs desc → claude is first.
    let rowOrder = wrapper
      .findAll('[data-testid^="insights-model-"]')
      .map((w) => w.attributes('data-testid'))
    expect(rowOrder[0]).toBe('insights-model-claude-opus-4-7')

    await wrapper
      .get('[data-testid="insights-by-model-sort-errors"]')
      .trigger('click')
    await flushPromises()
    rowOrder = wrapper
      .findAll('[data-testid^="insights-model-"]')
      .map((w) => w.attributes('data-testid'))
    // gpt-4o has 1 error, claude has 0 → gpt-4o leads.
    expect(rowOrder[0]).toBe('insights-model-gpt-4o')
  })

  it('surfaces a load error in the dedicated banner', async () => {
    apiGet.mockRejectedValue(new Error('boom'))
    const wrapper = mount(InsightsPage)
    await flushPromises()

    // Plan 30: translateError() falls back to `errors.GENERIC` for an
    // Error with no backend ErrorCode; the passthrough `$t` returns the
    // key verbatim.
    expect(wrapper.get('[data-testid="insights-error"]').text()).toContain(
      'errors.GENERIC',
    )
  })

  it('refetches on the 60s auto-refresh tick while visible', async () => {
    apiGet.mockResolvedValue(insights())
    mount(InsightsPage)
    await flushPromises()
    apiGet.mockClear()

    await vi.advanceTimersByTimeAsync(60_000)
    await flushPromises()

    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(apiGet).toHaveBeenCalledWith('/api/insights', { period: '7d' })
  })

  it('renders zero-height bars when the period has no runs', async () => {
    apiGet.mockResolvedValue(
      insights({
        totals: { runs: 0, input_tokens: 0, output_tokens: 0, errors: 0 },
        series: [
          { bucket: '2026-05-25', input_tokens: 0, output_tokens: 0, runs: 0 },
          { bucket: '2026-05-26', input_tokens: 0, output_tokens: 0, runs: 0 },
        ],
        by_model: [],
      }),
    )
    const wrapper = mount(InsightsPage)
    await flushPromises()

    // No NaN%/Infinity% — every bucket's inner bar renders height: 0%.
    const bar = wrapper.get('[data-testid="insights-bucket-2026-05-25"]')
    const inner = bar.find('div')
    expect(inner.exists()).toBe(true)
    expect(inner.attributes('style') ?? '').toContain('height: 0%')
  })
})
