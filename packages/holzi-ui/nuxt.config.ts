export default defineNuxtConfig({
  modules: ['@pinia/nuxt', '@vueuse/nuxt', '@nuxtjs/i18n'],

  components: [
    { path: './components/chat', prefix: 'Chat', pathPrefix: false, extensions: ['.vue'], global: true },
    { path: './components/ui', prefix: 'Ui', pathPrefix: false, extensions: ['.vue'], global: true },
  ],

  imports: {
    dirs: ['utils', 'composables', 'stores', 'lib'],
  },

  i18n: {
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
})
