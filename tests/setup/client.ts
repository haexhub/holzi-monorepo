import type { HermesHandle } from './hermes'

/**
 * Minimal typed fetch wrapper for tests. Throws on non-2xx (with body) so
 * assertions stay simple — wrap in try/catch when you want to assert on the
 * error.
 */
export function makeClient(handle: HermesHandle) {
  async function request<T = unknown>(
    path: string,
    init: RequestInit & { rawResponse?: boolean } = {},
  ): Promise<T> {
    const url = `${handle.baseUrl}${path}`
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${handle.authToken}`,
        ...(init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(init.headers ?? {}),
      },
    })
    if (init.rawResponse) return res as unknown as T
    if (!res.ok) {
      const body = await res.text().catch(() => '<no body>')
      throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`)
    }
    if (res.status === 204) return undefined as T
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) return (await res.json()) as T
    return (await res.text()) as T
  }

  /** Fetch the raw Response without throwing — for status-code assertions. */
  function raw(path: string, init: RequestInit = {}) {
    return request<Response>(path, { ...init, rawResponse: true })
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
    patch: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    raw,
  }
}

export type ApiClient = ReturnType<typeof makeClient>
