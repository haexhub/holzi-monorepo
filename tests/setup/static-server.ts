import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

export interface StaticHandle {
  url: string
  stop: () => Promise<void>
}

/**
 * Tiny static file server for the built webview / frontend artifacts. We
 * deliberately don't pull in `serve` or similar — keeping the dep tree
 * small + avoiding shell processes for cleaner Playwright control.
 *
 * Falls back to /index.html for unknown paths so Vue's hash-mode router and
 * the frontend's history-mode router both work without a real backend.
 */
export async function serveStatic(rootDir: string): Promise<StaticHandle> {
  const root = resolve(rootDir)
  const server: Server = createServer((req, res) => {
    const reqPath = (req.url ?? '/').split('?')[0]!
    // Strip leading slash, normalize, prevent path traversal
    let rel = normalize(decodeURIComponent(reqPath)).replace(/^\/+/, '')
    if (rel === '' || rel === '/') rel = 'index.html'
    let file = join(root, rel)
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden')
      return
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html')
    } catch {
      // not found → SPA fallback to index.html so client-side routing works
      file = join(root, 'index.html')
    }
    try {
      statSync(file)
    } catch {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise((r) => server.close(() => r())),
  }
}
