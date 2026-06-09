import { translateError } from '~/lib/errorMessages'
import type {
  AgentRun,
  DiagnosticsResponse,
  SandboxCrash,
} from '~/types/api'

/**
 * Plan 20 + 20-A: thin wrapper around the three Diagnostics-page
 * endpoints: `/api/diagnostics`, `/api/runs?status=error` (Recent
 * Failures), and `/api/sandbox/crashes` (Plan 20-A: persistent
 * sandbox-crash log). Each endpoint owns its own loading/error refs so
 * one failing endpoint doesn't collapse the other two.
 */
export function useDiagnostics() {
  const api = useApi()
  const { t } = useI18n()

  const diagnostics = ref<DiagnosticsResponse | null>(null)
  const diagnosticsLoading = ref(false)
  const diagnosticsError = ref<string | null>(null)

  const failures = ref<AgentRun[]>([])
  const failuresLoading = ref(false)
  const failuresError = ref<string | null>(null)

  const crashes = ref<SandboxCrash[]>([])
  const crashesLoading = ref(false)
  const crashesError = ref<string | null>(null)

  async function loadDiagnostics(): Promise<void> {
    diagnosticsLoading.value = true
    diagnosticsError.value = null
    try {
      diagnostics.value = await api.get<DiagnosticsResponse>('/api/diagnostics')
    } catch (err: unknown) {
      diagnosticsError.value = translateError(err, t)
    } finally {
      diagnosticsLoading.value = false
    }
  }

  async function loadFailures(limit = 20): Promise<void> {
    failuresLoading.value = true
    failuresError.value = null
    try {
      failures.value = await api.get<AgentRun[]>('/api/runs', {
        status: 'error',
        limit,
      })
    } catch (err: unknown) {
      failuresError.value = translateError(err, t)
    } finally {
      failuresLoading.value = false
    }
  }

  async function loadCrashes(limit = 20): Promise<void> {
    crashesLoading.value = true
    crashesError.value = null
    try {
      crashes.value = await api.get<SandboxCrash[]>('/api/sandbox/crashes', {
        limit,
      })
    } catch (err: unknown) {
      crashesError.value = translateError(err, t)
    } finally {
      crashesLoading.value = false
    }
  }

  async function loadAll(): Promise<void> {
    await Promise.all([loadDiagnostics(), loadFailures(), loadCrashes()])
  }

  return {
    diagnostics,
    diagnosticsLoading,
    diagnosticsError,
    failures,
    failuresLoading,
    failuresError,
    crashes,
    crashesLoading,
    crashesError,
    loadDiagnostics,
    loadFailures,
    loadCrashes,
    loadAll,
  }
}
