import MarkdownIt from 'markdown-it'
import Shiki, { type MarkdownItShikiOptions } from '@shikijs/markdown-it'
import katex from '@vscode/markdown-it-katex'
import DOMPurify from 'dompurify'

// `shiki` itself is only a transitive dep, so derive the language type from
// the plugin's own options instead of importing it directly.
type ShikiLang = NonNullable<MarkdownItShikiOptions['langs']>[number]

// Languages preloaded into the shiki highlighter. Anything else falls back to
// plain text (see `fallbackLanguage`) instead of throwing.
const LANGS: ShikiLang[] = [
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'vue',
  'python',
  'bash',
  'shell',
  'json',
  'yaml',
  'html',
  'css',
  'sql',
  'rust',
  'go',
  'markdown',
  'diff',
  'dockerfile',
]

// markdown-it is configured once (shiki setup is async and expensive); the
// promise is reused across every render call.
let mdPromise: Promise<MarkdownIt> | null = null

async function getMarkdown(): Promise<MarkdownIt> {
  if (mdPromise) return mdPromise
  mdPromise = (async () => {
    // `html: false` escapes raw HTML in the source — assistant output is
    // Markdown, not trusted HTML. DOMPurify is the second line of defence.
    const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

    md.use(
      await Shiki({
        themes: { light: 'github-light', dark: 'github-dark' },
        // Emit CSS variables for both themes so the UI can switch with the
        // app's `.dark` class instead of re-highlighting.
        defaultColor: false,
        langs: LANGS,
        // `plaintext` is a shiki built-in; the type only lists grammar langs.
        fallbackLanguage: 'plaintext' as ShikiLang,
      }),
    )

    // KaTeX for `$inline$` and `$$block$$` math.
    md.use(katex)

    // Divert ```mermaid fences to a readable source block the component
    // upgrades to a diagram, and wrap every other code block with a copy
    // affordance carrying the raw source.
    const defaultFence = md.renderer.rules.fence!
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx]
      if (!token) return ''
      const lang = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
      if (lang === 'mermaid') {
        return (
          '<div class="mermaid-block">'
          + '<pre class="mermaid-fallback"><code>'
          + md.utils.escapeHtml(token.content)
          + '</code></pre></div>'
        )
      }
      const inner = defaultFence(tokens, idx, options, env, self)
      return (
        '<div class="code-block">'
        + '<button class="copy-btn" type="button" aria-label="Code kopieren" data-code="'
        + md.utils.escapeHtml(token.content)
        + '">Kopieren</button>'
        + inner
        + '</div>'
      )
    }

    return md
  })()
  return mdPromise
}

// Render Markdown to sanitized HTML. DOMPurify keeps the inline styles shiki
// emits and the MathML KaTeX produces, while stripping any active content.
export async function renderMarkdown(src: string): Promise<string> {
  const md = await getMarkdown()
  const raw = md.render(src ?? '')
  return DOMPurify.sanitize(raw, { ADD_ATTR: ['data-code'] })
}
