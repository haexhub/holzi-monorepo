import { translateError } from '~/lib/errorMessages'
import type {
  AgentTask,
  AgentTaskCreate,
  AgentTaskRunResponse,
  AgentTaskUpdate,
} from '~/types/api'

/**
 * Plan 16: thin wrapper around `/api/tasks`. Mirrors `useTasks`-style
 * composables elsewhere (Notes/Workspace) so the settings page can stay
 * mostly markup. Exposes the raw list + a small set of mutations that
 * each refresh the list on success.
 */
export function useTasks() {
  const api = useApi()
  const { t } = useI18n()
  const tasks = ref<AgentTask[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      tasks.value = await api.get<AgentTask[]>('/api/tasks')
    } catch (err: unknown) {
      error.value = translateError(err, t)
    } finally {
      loading.value = false
    }
  }

  async function create(body: AgentTaskCreate): Promise<AgentTask> {
    const created = await api.post<AgentTask>('/api/tasks', body)
    await load()
    return created
  }

  async function patch(
    id: number,
    body: AgentTaskUpdate,
  ): Promise<AgentTask> {
    const updated = await api.patch<AgentTask>(`/api/tasks/${id}`, body)
    await load()
    return updated
  }

  async function remove(id: number): Promise<void> {
    await api.delete(`/api/tasks/${id}`)
    await load()
  }

  async function runNow(id: number): Promise<AgentTaskRunResponse> {
    return api.post<AgentTaskRunResponse>(`/api/tasks/${id}/run`)
  }

  return {
    tasks,
    loading,
    error,
    load,
    create,
    patch,
    remove,
    runNow,
  }
}
