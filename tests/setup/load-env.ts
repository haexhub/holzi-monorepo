import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(fileURLToPath(import.meta.url), '..')

// Search order: tests/.env.test first (suite-local), then repo-root .env.test
// (where a user might keep a single secrets file shared across tooling).
const candidates = [
  resolve(here, '..', '.env.test'),
  resolve(here, '..', '..', '.env.test'),
]

/**
 * Loads .env.test into process.env BEFORE vitest collects tests, so
 * describe.skipIf(!process.env.HOLZI_TEST_LLM_API_KEY) sees the right value.
 * Only sets keys that aren't already in the environment — explicit env wins.
 */
for (const path of candidates) {
  if (!existsSync(path)) continue
  const text = readFileSync(path, 'utf-8')
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // Strip surrounding quotes if present.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
  break  // First match wins; don't merge two .env.test files.
}
