import { translateError } from '~/lib/errorMessages'
import type { InsightsPeriod, InsightsResponse } from '~/types/api'

/**
 * Plan 27: backs `/settings/insights`. One endpoint (`/api/insights`)
 * with a `period` query — switch the period and refetch.
 */
export function useInsights() {
  const api = useApi()
  const { t } = useI18n()

  const insights = ref<InsightsResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const period = ref<InsightsPeriod>('7d')

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      insights.value = await api.get<InsightsResponse>('/api/insights', {
        period: period.value,
      })
    } catch (err: unknown) {
      error.value = translateError(err, t)
    } finally {
      loading.value = false
    }
  }

  async function setPeriod(next: InsightsPeriod): Promise<void> {
    if (period.value === next) return
    period.value = next
    await load()
  }

  return { insights, loading, error, period, load, setPeriod }
}
