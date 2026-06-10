import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each test file boots its own hermes container — file-level parallelism
    // multiplies docker startup and port collisions. Serial is the right
    // default; override with --pool=threads --no-isolate if you need speed.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    include: ['api/**/*.test.ts', 'agent/**/*.test.ts'],
    // Playwright tests use their own runner (npx playwright test), not vitest.
    exclude: ['ui/**', 'node_modules/**'],
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
})
