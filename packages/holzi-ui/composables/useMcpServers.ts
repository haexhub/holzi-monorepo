import { translateError } from '~/lib/errorMessages'
import type {
  McpServer,
  McpServerCreate,
  McpServerHealth,
  McpServerList,
  McpServerUpdate,
} from '~/types/api'

/**
 * Plan 32: CRUD over `/api/mcp/servers`.
 *
 * The list is fetched on mount and re-fetched after every mutation so
 * the page never has to sort out where the canonical state lives. Each
 * action returns the updated row (or void for delete) so the caller
 * can optimistically reflect the change before the list refresh lands.
 *
 * Secrets are write-only: `credentials` and `env` go up in `create` /
 * `update` payloads; the read shape only carries `env_keys`. The
 * composable does NOT memoise credentials anywhere.
 */
export function useMcpServers() {
  const api = useApi()
  const { t } = useI18n()

  const data = ref<McpServerList | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function list(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      data.value = await api.get<McpServerList>('/api/mcp/servers')
    } catch (err: unknown) {
      error.value = translateError(err, t)
    } finally {
      loading.value = false
    }
  }

  async function create(body: McpServerCreate): Promise<McpServer> {
    const row = await api.post<McpServer>('/api/mcp/servers', body)
    await list()
    return row
  }

  async function update(id: number, body: McpServerUpdate): Promise<McpServer> {
    const row = await api.put<McpServer>(`/api/mcp/servers/${id}`, body)
    await list()
    return row
  }

  async function remove(id: number): Promise<void> {
    await api.delete<void>(`/api/mcp/servers/${id}`)
    await list()
  }

  async function restart(id: number): Promise<McpServer> {
    const row = await api.post<McpServer>(`/api/mcp/servers/${id}/restart`)
    await list()
    return row
  }

  async function health(id: number): Promise<McpServerHealth> {
    return api.get<McpServerHealth>(`/api/mcp/servers/${id}/health`)
  }

  return { data, loading, error, list, create, update, remove, restart, health }
}
