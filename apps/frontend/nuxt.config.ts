// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  extends: ['../../packages/holzi-ui'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // SPA — no SSR. The hermes-server serves the built dist/ statically.
  ssr: false,

  devServer: {
    port: 3001,
  },

  // Proxy /api/* to hermes-server during `nuxt dev`. Hermes listens on 8082
  // by default; e2e tests boot a hermes on a random port and override the
  // target via HOLZI_DEV_API_TARGET so the frontend's /api/* calls land on
  // the throwaway container instead of whatever's on :8082.
  nitro: {
    devProxy: {
      '/api': {
        target: process.env.HOLZI_DEV_API_TARGET ?? 'http://localhost:8082/api',
        changeOrigin: true,
      },
    },
  },
})
