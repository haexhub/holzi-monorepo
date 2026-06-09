import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  extends: ['../../packages/holzi-ui'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // SPA — no SSR. The hermes-server serves the built dist/ statically.
  ssr: false,

  css: ['~/assets/css/tailwind.css', 'katex/dist/katex.min.css'],

  vite: {
    plugins: [tailwindcss()],
  },

  devServer: {
    port: 3001,
  },

  // Proxy /api/* to hermes-server during `nuxt dev`. Hermes listens on 8082.
  nitro: {
    devProxy: {
      '/api': {
        target: 'http://localhost:8082/api',
        changeOrigin: true,
      },
    },
  },
})
