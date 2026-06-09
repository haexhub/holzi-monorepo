/**
 * Plan 30 Task 3 — backend error-code → localized message helper.
 *
 * The Hermes backend emits one of these shapes from every HTTPException:
 *   - bare string `detail: "CONVERSATION_NOT_FOUND"` — a code from
 *     `hermes.errors.ErrorCode`
 *   - dict `detail: { code: "...", params: {...} }` — same code plus
 *     interpolation values for the i18n template
 *
 * The frontend keeps a 1:1 mapping under `errors.<CODE>` in each locale
 * (see `tests/i18n/error-codes.test.ts` for the enforcement). Anything the
 * mapping doesn't cover falls back to `errors.UNKNOWN` plus the raw code in
 * parens — surfacing the code at least lets the user paste it into a bug
 * report.
 *
 * The function intentionally tolerates several wrapping shapes so callers
 * can pass whatever their HTTP layer throws (raw `$fetch` error, plain
 * `{ detail }` object, `Error` instance, `null`).
 */

export type TranslateFn = (
  key: string,
  params?: Record<string, unknown>,
) => string

type ErrorEnvelope = {
  detail?: unknown
  data?: { detail?: unknown } | null
  message?: unknown
  status?: number
}

function asEnvelope(error: unknown): ErrorEnvelope | null {
  if (error == null || typeof error !== 'object') return null
  return error as ErrorEnvelope
}

function extractDetail(
  error: unknown,
): { code: string | null; params: Record<string, unknown> } {
  const env = asEnvelope(error)
  if (env === null) return { code: null, params: {} }

  // Prefer the top-level `detail` (raw HTTPException response body) but
  // also unwrap `data.detail` — that's where ofetch / $fetch parks the
  // parsed JSON body on FetchError.
  const detail = env.detail ?? env.data?.detail ?? null
  if (typeof detail === 'string' && detail.length > 0) {
    return { code: detail, params: {} }
  }
  if (detail !== null && typeof detail === 'object') {
    const obj = detail as { code?: unknown; params?: unknown }
    if (typeof obj.code === 'string' && obj.code.length > 0) {
      const params =
        obj.params !== null
        && typeof obj.params === 'object'
        && !Array.isArray(obj.params)
          ? (obj.params as Record<string, unknown>)
          : {}
      return { code: obj.code, params }
    }
  }
  return { code: null, params: {} }
}

function isNetworkError(error: unknown): boolean {
  // The fetch/network layer surfaces TypeError on connect failures
  // (no response, name lookup, CORS, abort). Detect by name so we don't
  // hard-code a particular message string.
  if (error instanceof TypeError) return true
  const env = asEnvelope(error)
  if (env === null) return false
  // ofetch sets `status: 0` when the request never got a response back.
  if (env.status === 0) return true
  return false
}

/**
 * Render a localized message for an error from the Hermes backend.
 *
 * - Known `ErrorCode` → `errors.<CODE>` (with params).
 * - Unknown code → `errors.UNKNOWN (CODE)`.
 * - Network-shaped error → `errors.NETWORK`.
 * - Anything else → `errors.GENERIC`.
 */
export function translateError(error: unknown, t: TranslateFn): string {
  // Non-objects (null, undefined, bare numbers/strings the caller
  // managed to pass in) carry no metadata we can decode.
  if (error === null || error === undefined || typeof error !== 'object') {
    return t('errors.UNKNOWN')
  }

  const { code, params } = extractDetail(error)
  if (code !== null) {
    const key = `errors.${code}`
    const translated = t(key, params)
    // Nuxt-i18n in `missingWarn: 'silent'` returns the missing key
    // verbatim, so we treat a passthrough as "no translation exists".
    if (translated !== key) return translated
    return `${t('errors.UNKNOWN')} (${code})`
  }

  if (isNetworkError(error)) {
    return t('errors.NETWORK')
  }

  return t('errors.GENERIC')
}
