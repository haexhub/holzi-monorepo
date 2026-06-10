import { execFile as execFileCb } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFile = promisify(execFileCb)
const here = dirname(fileURLToPath(import.meta.url))
const composeFile = resolve(here, '..', 'docker-compose.test.yml')

// Use podman-compose by default — that's what's locally available and what
// the hermes-server image was built against. Override with
// HOLZI_TEST_COMPOSE_CMD='docker compose' if you have a docker-side image.
const COMPOSE_CMD = (process.env.HOLZI_TEST_COMPOSE_CMD ?? 'podman-compose').split(' ')

export interface HermesHandle {
  baseUrl: string
  authToken: string
  /** Fresh seeded AES master key (hex), in case a test needs to read it back. */
  secretKey: string
  /** Tear the container down. Idempotent. */
  stop: () => Promise<void>
}

function compose(project: string, args: string[], env: NodeJS.ProcessEnv) {
  const [cmd, ...rest] = COMPOSE_CMD
  // `-p` scopes the compose project so each startHermes() invocation owns its
  // own set of containers — otherwise `down -v` would tear down peers that
  // happen to be running the same compose file (e.g. another test suite in
  // parallel, or a stale developer-started one).
  return execFile(cmd, [...rest, '-p', project, '-f', composeFile, ...args], {
    env: { ...process.env, ...env },
    timeout: 120_000,
  })
}

async function waitForHealthy(baseUrl: string, signal: AbortSignal) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('aborted')
    try {
      const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`hermes never became healthy at ${baseUrl}`)
}

/**
 * Boot a fresh isolated hermes container for the duration of a test session.
 * Returns connection details and a teardown handle.
 *
 * Fresh per call: random auth token + AES key + port (so multiple suites can
 * run in parallel without colliding on 18082).
 */
export async function startHermes(): Promise<HermesHandle> {
  const authToken = `test-${randomBytes(24).toString('hex')}`
  const secretKey = randomBytes(32).toString('hex')
  // Random port in 18000–18999 to allow parallel suites.
  const port = 18000 + Math.floor(Math.random() * 1000)
  // Unique compose project per invocation so down -v only tears down THIS
  // container, never a peer's. Also avoids container_name collisions when
  // two suites try to start at once.
  const project = `holzi-test-${randomBytes(6).toString('hex')}`
  const env = {
    HOLZI_TEST_AUTH_TOKEN: authToken,
    HOLZI_TEST_SECRET_KEY: secretKey,
    HOLZI_TEST_HERMES_PORT: String(port),
  }
  await compose(project, ['up', '-d'], env)

  const baseUrl = `http://localhost:${port}`
  const ctrl = new AbortController()
  try {
    await waitForHealthy(baseUrl, ctrl.signal)
  } catch (err) {
    // Capture logs + tear the half-started stack down before rethrowing —
    // otherwise an unhealthy hermes leaves an orphaned container behind.
    const { stdout } = await compose(project, ['logs', '--no-color', 'hermes'], env)
      .catch(() => ({ stdout: '(no logs)' }))
    await compose(project, ['down', '-v', '--remove-orphans'], env).catch(() => {})
    throw new Error(`${(err as Error).message}\n--- hermes logs ---\n${stdout}`)
  }

  return {
    baseUrl,
    authToken,
    secretKey,
    stop: async () => {
      ctrl.abort()
      await compose(project, ['down', '-v', '--remove-orphans'], env).catch(() => {})
    },
  }
}
