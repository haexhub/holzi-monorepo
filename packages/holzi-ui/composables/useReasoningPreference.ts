
/**
 * Whether reasoning cards start expanded ("show reasoning by default").
 *
 * Persisted in localStorage only — there's no backend preference yet (Plan 10
 * keeps it client-side first). Cards are collapsed by default; flipping this on
 * opens new reasoning cards as they appear. A module-level ref keeps every
 * card and the settings toggle in sync within the session.
 */
const STORAGE_KEY = 'holzi.showReasoningByDefault'

function readInitial(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(STORAGE_KEY) === 'true'
}

const showReasoningByDefault = ref(readInitial())

export function useReasoningPreference() {
  function setShowReasoningByDefault(value: boolean) {
    showReasoningByDefault.value = value
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(value))
    }
  }

  return { showReasoningByDefault, setShowReasoningByDefault }
}
