import { createPinia, setActivePinia } from 'pinia'
import { config } from '@vue/test-utils'
import { beforeEach } from 'vitest'

// Fresh Pinia per test so stores don't leak state between cases.
beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

// Plan 30 Wave 0 — provide a passthrough `$t` and `$te` for components
// that use vue-i18n's template helpers. The vue-i18n Vue plugin is not
// installed in vitest mounts; without these stubs every page that
// touches i18n would crash on render. Tests that care about which key
// was looked up can spy via vi.mock('vue-i18n', …) on useI18n().
config.global.mocks = {
  ...config.global.mocks,
  $t: (key: string) => key,
  $te: () => true,
}
