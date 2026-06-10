import type MarkdownIt from 'markdown-it'

// The whole markdown stack — markdown-it, shiki, katex, dompurify — only
// loads when the first message renders. Type-only import above keeps the
// `MarkdownIt` type without bundling the runtime; everything else is pulled
// in via dynamic imports inside getMarkdown() / renderMarkdown(). Saves
// ~700 KB-1 MB from the initial bundle (e.g. the login screen never needs
// any of this).
//
// Fine-grained Shiki imports: `@shikijs/markdown-it` (default entry) pulls
// every bundled grammar (~9 MB) into the bundle to make string-name lookups
// work at runtime. By building a highlighter from `shiki/core` with explicit
// `import('@shikijs/langs/<name>')` calls we ship only what we actually use.
// JavaScript regex engine avoids the Oniguruma WASM blob (and the
// 'wasm-unsafe-eval' CSP we used to need for it).
const LANG_LOADERS = [
  () => import('@shikijs/langs/javascript'),
  () => import('@shikijs/langs/typescript'),
  () => import('@shikijs/langs/jsx'),
  () => import('@shikijs/langs/tsx'),
  () => import('@shikijs/langs/vue'),
  () => import('@shikijs/langs/python'),
  () => import('@shikijs/langs/bash'),
  () => import('@shikijs/langs/shellscript'),
  () => import('@shikijs/langs/json'),
  () => import('@shikijs/langs/yaml'),
  () => import('@shikijs/langs/html'),
  () => import('@shikijs/langs/css'),
  () => import('@shikijs/langs/sql'),
  () => import('@shikijs/langs/rust'),
  () => import('@shikijs/langs/go'),
  () => import('@shikijs/langs/markdown'),
  () => import('@shikijs/langs/diff'),
  () => import('@shikijs/langs/dockerfile'),
]

// markdown-it is configured once (shiki setup is async and expensive); the
// promise is reused across every render call.
let mdPromise: Promise<MarkdownIt> | null = null

async function getMarkdown(): Promise<MarkdownIt> {
  if (mdPromise) return mdPromise
  mdPromise = (async () => {
    const [
      { default: MarkdownItCtor },
      { fromHighlighter },
      { createHighlighterCore },
      { createJavaScriptRegexEngine },
      { default: katex },
    ] = await Promise.all([
      import('markdown-it'),
      import('@shikijs/markdown-it/core'),
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('@vscode/markdown-it-katex'),
    ])

    // `html: false` escapes raw HTML in the source — assistant output is
    // Markdown, not trusted HTML. DOMPurify is the second line of defence.
    const md = new MarkdownItCtor({ html: false, linkify: true, breaks: true })

    const highlighter = await createHighlighterCore({
      themes: [
        import('@shikijs/themes/github-light'),
        import('@shikijs/themes/github-dark'),
      ],
      langs: LANG_LOADERS.map(load => load()),
      engine: createJavaScriptRegexEngine(),
    })

    md.use(
      fromHighlighter(highlighter, {
        themes: { light: 'github-light', dark: 'github-dark' },
        // Emit CSS variables for both themes so the UI can switch with the
        // app's `.dark` class instead of re-highlighting.
        defaultColor: false,
        fallbackLanguage: 'plaintext',
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
// DOMPurify is loaded in parallel with the markdown setup on first call; the
// browser caches the chunk so subsequent renders pay only a microtask.
let domPurifyPromise: Promise<typeof import('dompurify').default> | null = null
function getDomPurify() {
  if (!domPurifyPromise) {
    domPurifyPromise = import('dompurify').then(m => m.default)
  }
  return domPurifyPromise
}

export async function renderMarkdown(src: string): Promise<string> {
  const [md, DOMPurify] = await Promise.all([getMarkdown(), getDomPurify()])
  const raw = md.render(src ?? '')
  return DOMPurify.sanitize(raw, { ADD_ATTR: ['data-code'] })
}
