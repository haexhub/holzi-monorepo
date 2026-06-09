export default defineNuxtConfig({
  extends: ['../../../packages/holzi-ui'],
  compatibilityDate: '2025-07-15',
  ssr: false,
  devServer: { port: 3002 },

  // nuxt generate → static SPA. We'll wire output path to the extension's
  // out/ directory in Task 9; for now just keep the default .output/public/.

  app: {
    baseURL: './',
    buildAssetsDir: '_nuxt/',
  },

  // No dev-proxy here — webview talks directly to a backend URL provided
  // by the extension at runtime (via postMessage in Task 6).
})
