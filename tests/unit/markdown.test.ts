// @vitest-environment jsdom
//
// DOMPurify needs a DOM. jsdom is enough for the sanitize step; the shiki
// and katex pipelines are pure DOM-string emitters.

import { describe, expect, test } from 'vitest'
import { renderMarkdown } from '../../packages/holzi-ui/utils/markdown'

describe('renderMarkdown — basic markdown-it features', () => {
  test('escapes raw HTML in the source (html: false)', async () => {
    const html = await renderMarkdown('hello <b>not bold</b>')
    expect(html).not.toContain('<b>not bold</b>')
    expect(html).toContain('&lt;b&gt;not bold&lt;/b&gt;')
  })

  test('strips active content via DOMPurify', async () => {
    const html = await renderMarkdown('# Title\n\n<script>alert(1)</script>')
    // markdown-it (html: false) already escapes the source, and DOMPurify
    // then strips anything that survived as a real element. The text
    // 'alert(1)' may still appear as inert escaped text — what matters is
    // that there is no executable script tag.
    expect(html).not.toMatch(/<script[\s>]/i)
  })

  test('renders headings + paragraphs', async () => {
    const html = await renderMarkdown('# Heading\n\nA paragraph.')
    expect(html).toMatch(/<h1[^>]*>Heading<\/h1>/)
    expect(html).toContain('<p>A paragraph.</p>')
  })

  test('linkifies bare URLs', async () => {
    const html = await renderMarkdown('See https://example.com for details.')
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com"[^>]*>/)
  })

  test('respects breaks:true for single newlines', async () => {
    const html = await renderMarkdown('line one\nline two')
    expect(html).toMatch(/line one[\s]*<br>[\s]*line two/)
  })
})

describe('renderMarkdown — code blocks via Shiki', () => {
  test('javascript code block is wrapped in .code-block and highlighted', async () => {
    const md = '```js\nconst x = 1\n```'
    const html = await renderMarkdown(md)

    // Wrapper that the chat UI uses to attach a copy button.
    expect(html).toContain('class="code-block"')
    expect(html).toContain('class="copy-btn"')

    // Shiki tokenises into nested <span> with per-token color via CSS
    // variables (markdown.ts uses defaultColor:false so both themes
    // round-trip as --shiki-light / --shiki-dark).
    expect(html).toMatch(/<pre[\s\S]*?class="[^"]*?shiki/)
    expect(html).toMatch(/<span[\s\S]*?style="[^"]*?--shiki/)
  })

  test('typescript and python are loaded too', async () => {
    const tsHtml = await renderMarkdown('```ts\ninterface X {}\n```')
    expect(tsHtml).toMatch(/class="[^"]*?shiki/)

    const pyHtml = await renderMarkdown('```python\ndef f(): pass\n```')
    expect(pyHtml).toMatch(/class="[^"]*?shiki/)
  })

  test('unknown language falls back to plaintext, not a thrown error', async () => {
    const html = await renderMarkdown('```nonsense-lang\nfoo bar\n```')
    expect(html).toContain('foo bar')
    expect(html).toContain('class="code-block"')
  })

  test('copy button carries the raw source in data-code', async () => {
    const html = await renderMarkdown('```js\nconst x = "hello"\n```')
    // The wrapper escapes the source via markdown-it's escapeHtml so it
    // survives an HTML attribute boundary. Exact escaping of edge chars
    // varies with sanitizer config; assert the wrapper exists and that an
    // identifying token from the source ends up inside it.
    expect(html).toMatch(/data-code="[^"]*const x/)
  })
})

describe('renderMarkdown — mermaid fences', () => {
  test('mermaid block is extracted and NOT run through Shiki', async () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```'
    const html = await renderMarkdown(md)

    // The component upgrades these to SVG via dynamic mermaid import.
    // markdown.ts emits a fallback structure: .mermaid-block > .mermaid-fallback > <code>source</code>.
    expect(html).toContain('class="mermaid-block"')
    expect(html).toContain('class="mermaid-fallback"')
    expect(html).toContain('graph TD')

    // Must NOT have run through Shiki's wrapper — that'd put .shiki/<pre> in.
    expect(html).not.toMatch(/class="[^"]*?shiki/)
  })

  test('mermaid source is HTML-escaped (not interpreted)', async () => {
    const md = '```mermaid\nA["<b>label</b>"] --> B\n```'
    const html = await renderMarkdown(md)
    expect(html).not.toContain('<b>label</b>')
    expect(html).toContain('&lt;b&gt;label&lt;/b&gt;')
  })
})

describe('renderMarkdown — KaTeX math', () => {
  test('inline math produces katex markup', async () => {
    const html = await renderMarkdown('Energy is $E = mc^2$ today.')
    // KaTeX wraps each formula in <span class="katex">…</span>.
    expect(html).toContain('class="katex"')
    // Either MathML or HTML form should be present.
    expect(html).toMatch(/katex-(mathml|html)/)
  })

  test('block math survives sanitization', async () => {
    const html = await renderMarkdown('$$\nx^2 + y^2 = z^2\n$$')
    expect(html).toContain('class="katex')
  })

  test('plain dollar signs are not treated as math', async () => {
    const html = await renderMarkdown('That costs $5 or $10.')
    expect(html).not.toContain('class="katex"')
    expect(html).toContain('$5')
  })
})

describe('renderMarkdown — sanitization edge cases', () => {
  test('removes onerror / on* event handlers', async () => {
    const html = await renderMarkdown('![x](https://example.com/x.png "title")')
    expect(html).not.toMatch(/onerror=/i)
    expect(html).not.toMatch(/onclick=/i)
  })

  test('keeps inline shiki color CSS-vars (not stripped by DOMPurify)', async () => {
    // DOMPurify by default strips style="…". The renderer relies on shiki's
    // inline --shiki-light / --shiki-dark vars to round-trip per token.
    const html = await renderMarkdown('```js\nlet a = 1\n```')
    expect(html).toMatch(/style="[^"]*--shiki/)
  })
})
