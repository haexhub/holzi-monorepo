import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { visualizer } from 'rollup-plugin-visualizer'

const __dirname = dirname(fileURLToPath(import.meta.url))
const extensionOut = resolve(__dirname, '../extension/out/webview')
const analyze = process.env.BUNDLE_ANALYZE === '1'

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

  // Run `BUNDLE_ANALYZE=1 pnpm run generate` to produce bundle-stats.html
  // (treemap) and bundle-stats.json (raw module sizes) next to nuxt.config.
  // Attached only to the client build — Nuxt runs Vite twice (SSR shell +
  // client) and a top-level vite.plugins entry would get overwritten by the
  // smaller SSR pass.
  hooks: analyze
    ? {
        'vite:extendConfig'(viteConfig, env) {
          if (!env.isClient) return
          viteConfig.plugins = viteConfig.plugins || []
          viteConfig.plugins.push(
            visualizer({
              filename: resolve(__dirname, 'bundle-stats.html'),
              template: 'treemap',
              gzipSize: true,
              brotliSize: true,
              sourcemap: true,
            }),
            visualizer({
              filename: resolve(__dirname, 'bundle-stats.json'),
              template: 'raw-data',
              gzipSize: true,
              brotliSize: true,
              sourcemap: true,
            }),
          )
        },
      }
    : undefined,
})
