import type {
  ChannelPrompt,
  ChannelPromptListResponse,
  ChannelPromptUpdate,
} from '~/types/api'

/**
 * Thin REST wrapper around `/api/channels`. The backend seeds one row
 * per channel key from `hermes.personas.CHANNEL_REGISTRY` on boot, so
 * `list()` always returns the same N rows in the same canonical order
 * (today: `web`, `task`).
 */
export function useChannels() {
  const api = useApi()

  return {
    list: () => api.get<ChannelPromptListResponse>('/api/channels'),

    update: (channel: string, body: ChannelPromptUpdate) =>
      api.put<ChannelPrompt>(
        `/api/channels/${encodeURIComponent(channel)}`,
        body,
      ),

    reset: (channel: string) =>
      api.post<ChannelPrompt>(
        `/api/channels/${encodeURIComponent(channel)}/reset`,
      ),
  }
}
