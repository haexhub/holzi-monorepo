import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const extensionOut = resolve(__dirname, '../extension/out/webview')

export default defineNuxtConfig({
  extends: ['../../../packages/holzi-ui'],
  compatibilityDate: '2025-07-15',
  ssr: false,
  devServer: { port: 3002 },

  nitro: {
    output: {
      dir: resolve(extensionOut, '..'),     // .../out/
      publicDir: extensionOut,               // .../out/webview/
    },
  },

  app: {
    baseURL: './',
    buildAssetsDir: '_nuxt/',
  },

  // Hash-mode routing: the webview document loads as index.html (no server to
  // map arbitrary paths), so history mode would 404 on the initial /index.html
  // path. Hash mode ignores the pathname and routes via #/… instead.
  router: {
    options: {
      hashMode: true,
    },
  },

  // No dev-proxy here — webview talks directly to a backend URL provided
  // by the extension at runtime (via postMessage).
})
