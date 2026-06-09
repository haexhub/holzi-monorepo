import { describe, expect, it } from 'vitest'
import { translateError } from '~/lib/errorMessages'

// Stub `$t` — pretend each known key returns a fixed prefix + the params,
// and unknown keys throw so we can assert the helper's fallback contract.
const KNOWN = new Set([
  'errors.GENERIC',
  'errors.NETWORK',
  'errors.UNKNOWN',
  'errors.CONVERSATION_NOT_FOUND',
  'errors.REQUEST_LIMIT_OUT_OF_RANGE',
])

function makeT(): (key: string, params?: Record<string, unknown>) => string {
  return (key, params) => {
    if (!KNOWN.has(key)) {
      // Mirror @nuxtjs/i18n behaviour in `missingWarn: 'silent'` — return
      // the key verbatim. translateError() must detect this and fall back.
      return key
    }
    // For known keys, prefix with `tr:` so translated text is always
    // distinguishable from the bare key. Real i18n returns the localized
    // string, never the key itself; the helper relies on that contract
    // to decide whether the lookup succeeded.
    if (params && Object.keys(params).length) {
      return `tr:${key}|${JSON.stringify(params)}`
    }
    return `tr:${key}`
  }
}

describe('translateError', () => {
  it('renders a bare-string detail as errors.<CODE>', () => {
    const t = makeT()
    const err = { detail: 'CONVERSATION_NOT_FOUND', status: 404 }
    expect(translateError(err, t)).toBe('tr:errors.CONVERSATION_NOT_FOUND')
  })

  it('renders a {code, params} detail with interpolation', () => {
    const t = makeT()
    const err = {
      detail: {
        code: 'REQUEST_LIMIT_OUT_OF_RANGE',
        params: { min: 1, max: 200 },
      },
      status: 400,
    }
    expect(translateError(err, t)).toBe(
      'tr:errors.REQUEST_LIMIT_OUT_OF_RANGE|{"min":1,"max":200}',
    )
  })

  it('falls back to errors.UNKNOWN + code suffix for unmapped codes', () => {
    const t = makeT()
    const err = { detail: 'NEVER_HEARD_OF_THIS', status: 500 }
    expect(translateError(err, t)).toBe(
      'tr:errors.UNKNOWN (NEVER_HEARD_OF_THIS)',
    )
  })

  it('returns errors.NETWORK for an Error without a response payload', () => {
    const t = makeT()
    const err = new TypeError('NetworkError: fetch aborted')
    expect(translateError(err, t)).toBe('tr:errors.NETWORK')
  })

  it('returns errors.UNKNOWN for null / undefined / non-error input', () => {
    const t = makeT()
    expect(translateError(null, t)).toBe('tr:errors.UNKNOWN')
    expect(translateError(undefined, t)).toBe('tr:errors.UNKNOWN')
    expect(translateError(42, t)).toBe('tr:errors.UNKNOWN')
  })

  it('unwraps nested detail from $fetch-style data envelope', () => {
    const t = makeT()
    // $fetch puts the parsed body under `data` and the parsed `detail`
    // under `data.detail` — same precedence the BE returns natively.
    const err = {
      data: { detail: 'CONVERSATION_NOT_FOUND' },
      response: { status: 404 },
    }
    expect(translateError(err, t)).toBe('tr:errors.CONVERSATION_NOT_FOUND')
  })

  it('treats an .ok=true SSE failure with no detail as GENERIC', () => {
    // Some endpoints return `{ ok: false, message: "..." }` on success-shaped
    // responses (git fetch/push). They don't carry an ErrorCode — render
    // GENERIC so the caller can still surface the message body separately.
    const t = makeT()
    expect(translateError({ ok: false, message: 'whatever' }, t)).toBe(
      'tr:errors.GENERIC',
    )
  })
})
