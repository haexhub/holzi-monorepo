export default defineNuxtConfig({
  components: [
    {
      path: './components/chat',
      prefix: 'Chat',
      pathPrefix: false,
      extensions: ['.vue'],
      global: true,
    },
    {
      path: './components/ui',
      prefix: 'Ui',
      pathPrefix: false,
      extensions: ['.vue'],
      global: true,
    },
  ],
})
