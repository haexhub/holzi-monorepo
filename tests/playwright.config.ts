import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './ui',
  // The UI tests boot Hermes via the same helper as the vitest suites; running
  // them serially keeps container counts manageable and avoids port collisions.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [['github']] : [['list']],
  use: {
    headless: true,
    actionTimeout: 5_000,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
