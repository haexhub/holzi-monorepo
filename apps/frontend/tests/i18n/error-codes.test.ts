import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Plan 30 Task 3 — pin the FE↔BE error-code coverage.
//
// The backend's `hermes.errors.ErrorCode` enum is the contract. Every
// value must be renderable on the FE as `errors.<VALUE>` in both locales,
// otherwise an HTTP error from the backend would surface as a fallback
// "Unknown error (CODE)" until someone notices the missing translation.
//
// We parse the enum directly from the backend source instead of going
// through the OpenAPI schema: the codes only appear in OpenAPI as
// free-form `detail` strings in examples, not as a typed schema, so the
// generated `app/types/api.ts` doesn't carry them.
//
// CI doesn't check out the sibling Holzi repo, so we ship a committed
// snapshot (`error-codes.snapshot.json`) and read from that. When the
// live backend file IS available (local dev), an extra assertion catches
// drift between the snapshot and the source of truth.

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '../..')
const SNAPSHOT_PATH = resolve(here, 'error-codes.snapshot.json')
const BACKEND_ENUM_PATH = resolve(REPO_ROOT, '../Holzi/src/hermes/errors.py')

function parseEnumValues(src: string): string[] {
  const codes: string[] = []
  const memberRe = /^ {4}([A-Z][A-Z0-9_]*)\s*=\s*"([A-Z0-9_]+)"/gm
  let m: RegExpExecArray | null
  while ((m = memberRe.exec(src)) !== null) {
    codes.push(m[2])
  }
  return codes
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as {
  codes: string[]
}
const codes = snapshot.codes

const localesDir = resolve(REPO_ROOT, 'i18n/locales')
const de = JSON.parse(readFileSync(resolve(localesDir, 'de.json'), 'utf8'))
const en = JSON.parse(readFileSync(resolve(localesDir, 'en.json'), 'utf8'))

describe('errors.<ErrorCode> i18n coverage', () => {
  it('snapshot carries the baseline codes', () => {
    expect(codes.length).toBeGreaterThan(30)
    expect(codes).toContain('CONVERSATION_NOT_FOUND')
    expect(codes).toContain('WORKSPACE_GIT_COMMAND_FAILED')
    expect(codes).toContain('DIAG_SANDBOX_CONFIGURED')
  })

  it('snapshot matches live backend enum (when sibling repo is present)', () => {
    if (!existsSync(BACKEND_ENUM_PATH)) {
      return
    }
    const live = parseEnumValues(readFileSync(BACKEND_ENUM_PATH, 'utf8'))
    expect(
      live,
      'tests/i18n/error-codes.snapshot.json is stale — regenerate from ../Holzi/src/hermes/errors.py',
    ).toEqual(codes)
  })

  for (const code of codes) {
    it(`de + en provide errors.${code}`, () => {
      expect(de.errors?.[code], `de.errors.${code}`).toBeTypeOf('string')
      expect(en.errors?.[code], `en.errors.${code}`).toBeTypeOf('string')
      expect((de.errors?.[code] as string).length).toBeGreaterThan(0)
      expect((en.errors?.[code] as string).length).toBeGreaterThan(0)
    })
  }
})
