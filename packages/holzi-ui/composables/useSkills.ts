import { translateError } from '~/lib/errorMessages'
import type {
  Skill,
  SkillCreate,
  SkillListResponse,
  SkillUpdate,
} from '~/types/api'

/**
 * Plan 33 / Plan 37: CRUD over `/api/skills`.
 *
 * Plan 37 dropped the per-persona activation layer (`listForPersona` /
 * `setForPersona`). Skills are now a global catalog; the `enabled` flag
 * controls whether a skill appears in the agent's catalog index.
 */
export function useSkills() {
  const api = useApi()
  const { t } = useI18n()

  const data = ref<SkillListResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function list(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      data.value = await api.get<SkillListResponse>('/api/skills')
    } catch (err: unknown) {
      error.value = translateError(err, t)
    } finally {
      loading.value = false
    }
  }

  async function create(body: SkillCreate): Promise<Skill> {
    const row = await api.post<Skill>('/api/skills', body)
    await list()
    return row
  }

  async function update(id: number, body: SkillUpdate): Promise<Skill> {
    const row = await api.put<Skill>(`/api/skills/${id}`, body)
    await list()
    return row
  }

  async function remove(id: number): Promise<void> {
    await api.delete<void>(`/api/skills/${id}`)
    await list()
  }

  return {
    data,
    loading,
    error,
    list,
    create,
    update,
    remove,
  }
}
