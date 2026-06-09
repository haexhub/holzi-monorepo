import { translateError } from '~/lib/errorMessages'
import type { LogRow, LogsResponse } from '~/types/api'

export type LogLevelFilter = 'info' | 'warning' | 'error'
export type LogTailSize = 100 | 500 | 1000

/**
 * Plan 27: backs `/settings/logs`. Pure read — pulls the last N rows
 * from `/api/logs`, filtered by severity. Auto-refresh lives on the
 * page itself (paused while the tab is hidden).
 */
export function useLogs() {
  const api = useApi()
  const { t } = useI18n()

  const rows = ref<LogRow[]>([])
  const loading = ref(false)
  // Two error channels: a 503 from "log file unset" deserves a friendly
  // "configure HERMES_LOG_FILE" empty state, separate from generic
  // network / auth errors.
  const error = ref<string | null>(null)
  const disabled = ref(false)
  const minLevel = ref<LogLevelFilter>('info')
  const tail = ref<LogTailSize>(100)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await api.get<LogsResponse>('/api/logs', {
        tail: tail.value,
        min_level: minLevel.value,
      })
      rows.value = res.rows
      disabled.value = false
    } catch (err: unknown) {
      const status = (err as { statusCode?: number; status?: number })
        ?.statusCode
      if (status === 503) {
        disabled.value = true
        rows.value = []
      } else {
        error.value = translateError(err, t)
      }
    } finally {
      loading.value = false
    }
  }

  async function setMinLevel(next: LogLevelFilter): Promise<void> {
    if (minLevel.value === next) return
    minLevel.value = next
    await load()
  }

  async function setTail(next: LogTailSize): Promise<void> {
    if (tail.value === next) return
    tail.value = next
    await load()
  }

  return {
    rows,
    loading,
    error,
    disabled,
    minLevel,
    tail,
    load,
    setMinLevel,
    setTail,
  }
}
