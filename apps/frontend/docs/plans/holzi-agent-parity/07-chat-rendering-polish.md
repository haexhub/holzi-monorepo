# Plan 07: Chat Rendering Polish

Status: implemented and merged on 2026-05-27. Frontend-only
([holzi-frontend#30](https://github.com/haexhub/holzi-frontend/pull/30),
squash-merged); no backend changes — `MessageResponse.ts` already ships the
timestamp. CodeRabbit: unavailable for this PR (org review rate limit reached);
per the CR-rate-limit fallback the changes were self-reviewed on the PR, which
caught one real issue (the streaming bubble routed through shiki on every
chunk), fixed in b277b82 before merge. Stack (confirmed
with the user, chosen for a polished result over minimal bundle):
`markdown-it` + `@shikijs/markdown-it` (shiki, dual github-light/dark themes) +
`@vscode/markdown-it-katex` + `katex` + `dompurify` + `mermaid` (lazy-loaded).
KaTeX math was added to scope at the user's request (parity with hermes-webui);
it was not in the original plan. Streaming bubbles stay plain text and are
upgraded to rendered Markdown once the turn is persisted.

Verification (frontend repo root, `holzi-frontend/`):

- `pnpm test` (81 passing, incl. new `tests/utils/markdown.test.ts` and
  `tests/components/{RenderedMarkdown,ChatMessage}.test.ts` — the project's
  first component tests, enabled by adding `@vitejs/plugin-vue` to vitest)
- `pnpm typecheck`
- `pnpm build` (verified shiki/mermaid/katex bundle and code-split cleanly)

## Goal

Render assistant output like a serious work surface: Markdown, syntax
highlighting, code copy, Mermaid, and timestamps.

## Why

Agent answers often contain code, tables, structured notes, and diagrams. Plain
text bubbles make Holzi feel less capable than the agent actually is.

## Scope

Frontend:

- Add safe Markdown rendering for assistant messages.
- Add syntax highlighting for fenced code blocks.
- Add Copy button for code blocks.
- Add message timestamps.
- Add Mermaid rendering for fenced `mermaid` blocks.

Backend:

- Ensure message timestamps are present in API response. If already present,
  no backend change.

Tests:

- Rendering does not execute HTML/script.
- Code block copy button appears.
- Mermaid block falls back gracefully if rendering fails.

## Suggested Libraries

Pick conservative dependencies:

- Markdown: `markdown-it` or `micromark` ecosystem
- Sanitizing: `dompurify` if rendering HTML
- Highlighting: `shiki` or `highlight.js`
- Mermaid: `mermaid`

Prefer a simple local `RenderedMarkdown.vue` component so chat rendering stays
contained.

## Suggested Implementation

1. Add dependencies.
2. Create `app/components/chat/RenderedMarkdown.vue`.
3. In `ChatMessage.vue`:
   - user messages can stay plain text
   - assistant messages use rendered Markdown
   - tool messages remain separate until Tool Cards land
4. Add timestamp display using existing `ts` when available.
5. Add code block copy affordance.
6. Add Mermaid support only for trusted Markdown output after sanitizing.

## Acceptance Criteria

- Assistant Markdown renders headings, lists, tables, links, inline code, and
  fenced code blocks.
- Code blocks have copy buttons.
- Mermaid diagrams render or show a readable fallback.
- User-supplied dangerous HTML does not execute.
- Text layout remains readable on mobile.

## Out Of Scope

- Tool cards.
- Attachments.
- Rich editing.

## Files Likely Touched

- Frontend:
  - `package.json`
  - `pnpm-lock.yaml`
  - `app/components/chat/ChatMessage.vue`
  - `app/components/chat/RenderedMarkdown.vue`
  - `tests/`
