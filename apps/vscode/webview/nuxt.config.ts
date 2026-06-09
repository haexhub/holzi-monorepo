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

  // No dev-proxy here — webview talks directly to a backend URL provided
  // by the extension at runtime (via postMessage).
})
