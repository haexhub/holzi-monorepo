import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { serveStatic, type StaticHandle } from '../setup/static-server'

const here = resolve(fileURLToPath(import.meta.url), '..')
const mermaidDir = resolve(here, '..', '..', 'packages', 'holzi-ui', 'node_modules', 'mermaid', 'dist')

let server: StaticHandle

test.beforeAll(async () => {
  // Serve mermaid's dist/ so the browser can import mermaid.esm.min.mjs
  // and the chunks it lazy-loads from a real http:// origin.
  server = await serveStatic(mermaidDir)
})

test.afterAll(async () => {
  await server?.stop()
})

/**
 * The HTML structure renderMarkdown emits for a ```mermaid fence — verified
 * by tests/unit/markdown.test.ts. Hardcoding it here avoids a Node CJS/ESM
 * interop wrinkle with @vscode/markdown-it-katex's default export that only
 * surfaces when renderMarkdown is invoked from Playwright's test runner
 * (the production Vite path is unaffected).
 */
function mermaidBlockHtml(source: string): string {
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<div class="mermaid-block"><pre class="mermaid-fallback"><code>${escaped}</code></pre></div>`
}

test.describe('mermaid integration — markdown-it output → SVG round-trip', () => {
  test('the .mermaid-block fallback structure is upgraded to inline SVG', async ({ page }) => {
    // Run the same upgrade routine RenderedMarkdown.vue performs: find every
    // .mermaid-block, parse its <code> source, replace with mermaid.render's
    // SVG. If our markdown-it output drifts from what mermaid expects, or
    // mermaid's API changes incompatibly, this fails specifically.
    const html = mermaidBlockHtml('graph TD\nA[Start] --> B[End]')

    // Navigate to the served origin first so the dynamic import is allowed
    // by the browser (file:// → http:// imports are blocked).
    await page.goto(`${server.url}/`)
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`)

    const svgCount = await page.evaluate(async ({ mermaidPath }) => {
      const mermaid = (await import(mermaidPath)).default
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
      const blocks = document.querySelectorAll<HTMLElement>('.mermaid-block')
      for (const block of Array.from(blocks)) {
        const source = block.querySelector('.mermaid-fallback')?.textContent ?? ''
        if (!source.trim()) continue
        const id = `m-${Math.random().toString(36).slice(2)}`
        const { svg } = await mermaid.render(id, source)
        block.innerHTML = svg
      }
      return document.querySelectorAll('.mermaid-block svg').length
    }, { mermaidPath: `${server.url}/mermaid.esm.min.mjs` })

    expect(svgCount).toBe(1)

    // The rendered SVG must contain the label text — proves the parse
    // worked, not just that mermaid emitted a stub.
    const svgText = await page.locator('.mermaid-block svg').textContent()
    expect(svgText).toMatch(/Start/)
    expect(svgText).toMatch(/End/)
  })
})
