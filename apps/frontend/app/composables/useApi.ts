import { useAuthStore } from '~/stores/auth'

/**
 * Thin wrapper around `$fetch` that injects the Bearer token and surfaces
 * 401s by clearing the stored token. Use for plain REST (`/api/conversations`,
 * `/api/notes`, `/api/workspace/*`). For SSE streaming (`/api/chat`) use
 * `sendChatMessage` instead — `$fetch` can't expose a ReadableStream.
 *
 * The path is intentionally typed as a wide `string` (cast to any when
 * forwarding) to avoid Nuxt's typed-routes inference path-explosion.
 */
type FetchMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export function useApi() {
  const auth = useAuthStore()

  async function request<T>(
    path: string,
    options: {
      method?: FetchMethod
      body?: unknown
      query?: Record<string, unknown>
    } = {},
  ): Promise<T> {
    if (!auth.isAuthenticated) {
      throw new Error('not authenticated')
    }
    try {
      // Erase $fetch's typed-routes inference (which blows up the TS type
      // depth budget) by casting to a plain function. We're an SPA, so
      // request paths are dynamic anyway.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f = $fetch as any
      return (await f(path, {
        method: options.method,
        body: options.body,
        query: options.query,
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
      })) as T
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode
      if (status === 401) {
        auth.clear()
      }
      throw err
    }
  }

  return {
    get: <T>(path: string, query?: Record<string, unknown>) =>
      request<T>(path, { method: 'GET', query }),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'POST', body }),
    put: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'PUT', body }),
    patch: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'PATCH', body }),
    // DELETE with a body is unusual but explicitly used by Plan 13's
    // `/api/workspace/file` so the destructive call can carry both the
    // path and the `conversation_id` for the resulting `user[conv-N]:`
    // commit message — the same shape as create/update/rename.
    delete: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'DELETE', body }),
  }
}
