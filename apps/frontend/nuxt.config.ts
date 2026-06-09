import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  extends: ['../../packages/holzi-ui'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // SPA — no SSR. The hermes-server serves the built dist/ statically.
  ssr: false,

  modules: ['@pinia/nuxt', '@vueuse/nuxt', '@nuxtjs/i18n'],

  css: ['~/assets/css/tailwind.css', 'katex/dist/katex.min.css'],

  // Plan 30 Wave 0 — bilingual UI. Cookie + browser-locale detection;
  // manual pick in /settings/preferences overrides. EN-completeness is
  // enforced by tests/i18n/keys.test.ts; no fallback-on-missing.
  i18n: {
    // Default-Locale (de) bleibt unter `/`, non-default bekommt /en/.
    // User-Preference (2026-06-04, überstimmt Plan 30's no_prefix).
    strategy: 'prefix_except_default',
    defaultLocale: 'de',
    locales: [
      { code: 'de', name: 'Deutsch', file: 'de.json' },
      { code: 'en', name: 'English', file: 'en.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_locale',
      redirectOn: 'root',
    },
  },

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
