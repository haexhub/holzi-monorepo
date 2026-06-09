import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Read the raw JSON via fs — a plain `import de from '…json'` is
// intercepted by @nuxtjs/i18n's vite plugin and rewritten into a
// pre-compiled AST, which would defeat the leaf-shape check below.
const here = dirname(fileURLToPath(import.meta.url))
const localesDir = resolve(here, '../../i18n/locales')
const de = JSON.parse(readFileSync(resolve(localesDir, 'de.json'), 'utf8'))
const en = JSON.parse(readFileSync(resolve(localesDir, 'en.json'), 'utf8'))

// Plan 30 Wave 0 — EN-completeness contract.
//
// Both locales must expose the exact same set of leaf keys; missing keys
// in either direction would let German wording leak into the English UI
// (or vice versa), since Nuxt-i18n's default fallback would substitute
// the other locale silently. See "EN-Vollständigkeit" in plan 30 §Open
// Questions.

type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json }

function collectLeafPaths(node: Json, prefix = ''): string[] {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return [prefix]
  }
  const paths: string[] = []
  for (const [key, value] of Object.entries(node)) {
    const next = prefix === '' ? key : `${prefix}.${key}`
    paths.push(...collectLeafPaths(value, next))
  }
  return paths
}

describe('i18n locale parity', () => {
  it('de.json and en.json expose the exact same key set', () => {
    const deKeys = new Set(collectLeafPaths(de as Json))
    const enKeys = new Set(collectLeafPaths(en as Json))

    const missingInEn = [...deKeys].filter((k) => !enKeys.has(k)).sort()
    const missingInDe = [...enKeys].filter((k) => !deKeys.has(k)).sort()

    expect(
      { missingInEn, missingInDe },
      `locale key sets diverged — missingInEn=${JSON.stringify(missingInEn)}, missingInDe=${JSON.stringify(missingInDe)}`,
    ).toEqual({ missingInEn: [], missingInDe: [] })
  })

  it('every leaf value is a non-empty string in both locales', () => {
    function collectBadLeaves(node: Json, locale: 'de' | 'en', prefix = ''): string[] {
      if (node === null || typeof node !== 'object' || Array.isArray(node)) {
        if (typeof node !== 'string' || node.length === 0) {
          return [`${locale}:${prefix} (got ${typeof node})`]
        }
        return []
      }
      const bad: string[] = []
      for (const [key, value] of Object.entries(node)) {
        const next = prefix === '' ? key : `${prefix}.${key}`
        bad.push(...collectBadLeaves(value, locale, next))
      }
      return bad
    }
    const bad = [
      ...collectBadLeaves(de as Json, 'de'),
      ...collectBadLeaves(en as Json, 'en'),
    ]
    expect(bad).toEqual([])
  })
})
