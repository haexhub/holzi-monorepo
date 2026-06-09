import type { ModelsResponse } from '~/types/api'

export function useModels() {
  const api = useApi()
  return {
    list: () => api.get<ModelsResponse>('/api/models'),
  }
}
