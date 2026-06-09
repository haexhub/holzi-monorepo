import { translateError } from '~/lib/errorMessages'
import type { McpHealthResponse } from '~/types/api'

/**
 * Plan 31: poll the agent's MCP streamable-HTTP surface health. Single
 * request per call — the `/settings/skills` page calls this once on mount
 * and again whenever the user hits the Refresh button on the MCP card.
 * `lastCheckedAt` is captured so the card can render "vor 3 s".
 */
export function useMcpHealth() {
  const api = useApi()
  const { t } = useI18n()

  const data = ref<McpHealthResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const lastCheckedAt = ref<number | null>(null)

  async function check(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      data.value = await api.get<McpHealthResponse>('/api/mcp/health')
      lastCheckedAt.value = Date.now()
    } catch (err: unknown) {
      error.value = translateError(err, t)
    } finally {
      loading.value = false
    }
  }

  return { data, loading, error, lastCheckedAt, check }
}
