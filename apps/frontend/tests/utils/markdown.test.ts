import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '~/utils/markdown'

// shiki's first run loads grammars/themes; give these cases room.
const TIMEOUT = 20000

describe('renderMarkdown', () => {
  it('renders headings, lists, tables, links and inline code', async () => {
    const html = await renderMarkdown(
      [
        '# Title',
        '',
        '- one',
        '- two',
        '',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '[link](https://example.com)',
        '',
        'some `inline` code',
      ].join('\n'),
    )
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('<code>inline</code>')
  }, TIMEOUT)

  it('highlights fenced code with shiki and wraps it with a copy button', async () => {
    const html = await renderMarkdown('```js\nconst x = 1\n```')
    // shiki emits <pre class="shiki ...">
    expect(html).toContain('class="shiki')
    // wrapped in a copy-able container
    expect(html).toContain('code-block')
    expect(html).toContain('copy-btn')
    // the highlighted token is present
    expect(html).toContain('const')
  }, TIMEOUT)

  it('renders a mermaid fence as a readable fallback block, not highlighted code', async () => {
    const src = 'graph TD\n  A --> B'
    const html = await renderMarkdown('```mermaid\n' + src + '\n```')
    expect(html).toContain('mermaid-block')
    // raw diagram source survives so it can render or be read as fallback
    expect(html).toContain('graph TD')
    // it must NOT be treated as a shiki code block
    expect(html).not.toContain('copy-btn')
  }, TIMEOUT)

  it('renders inline KaTeX math', async () => {
    const html = await renderMarkdown('Euler: $e^{i\\pi} + 1 = 0$')
    expect(html).toContain('katex')
  }, TIMEOUT)

  it('does not emit raw script tags from markdown source', async () => {
    const html = await renderMarkdown('<script>alert("xss")</script>\n\nhello')
    expect(html).not.toContain('<script>')
    expect(html).toContain('hello')
  }, TIMEOUT)
})
