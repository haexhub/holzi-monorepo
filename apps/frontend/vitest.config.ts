import { defineVitestConfig } from '@nuxt/test-utils/config'

// Nuxt environment gives Vue auto-imports (ref, computed, watch, …),
// Nuxt composable auto-imports (useApi, useConfirm, …), and component
// auto-imports (<UiButton>, <UiAlertDialog>, …) inside vitest, matching what
// `nuxt dev` and `nuxt build` see at runtime.
export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    include: ['tests/**/*.test.ts'],
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
})
