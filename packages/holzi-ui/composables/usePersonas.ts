import type {
  Persona,
  PersonaCreate,
  PersonaHistoryListResponse,
  PersonaListResponse,
  PersonaUpdate,
} from '~/types/api'

/**
 * Thin REST wrapper around `/api/personas`. Backed by the Plan 29-A
 * personas + channel_prompts tables; the page combines this with
 * `useChannels` to render `/settings/preferences`.
 *
 * `history` + `restoreHistory` (Plan 36 / Wave A1) expose the per-persona
 * snapshot list and the one-click restore endpoint that re-applies a past
 * snapshot to the live row.
 */
export function usePersonas() {
  const api = useApi()

  return {
    list: () => api.get<PersonaListResponse>('/api/personas'),

    create: (body: PersonaCreate) =>
      api.post<Persona>('/api/personas', body),

    update: (id: number, body: PersonaUpdate) =>
      api.put<Persona>(`/api/personas/${id}`, body),

    delete: (id: number) =>
      api.delete<void>(`/api/personas/${id}`),

    history: (id: number) =>
      api.get<PersonaHistoryListResponse>(`/api/personas/${id}/history`),

    restoreHistory: (personaId: number, snapshotId: number) =>
      api.post<Persona>(
        `/api/personas/${personaId}/history/${snapshotId}/restore`,
      ),
  }
}
