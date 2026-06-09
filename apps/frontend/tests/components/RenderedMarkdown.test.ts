import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import RenderedMarkdown from '~/components/chat/RenderedMarkdown.vue'

const TIMEOUT = 20000
// shiki's async init can take a moment on first run, so poll rather than
// awaiting a fixed number of microtask turns.
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: TIMEOUT, interval: 25 })

// mermaid is dynamically imported by the component; control it per test.
const mermaidRender = vi.fn()
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) => mermaidRender(...args),
  },
}))

describe('RenderedMarkdown.vue', () => {
  beforeEach(() => {
    mermaidRender.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders markdown into the DOM', async () => {
    const wrapper = mount(RenderedMarkdown, { props: { content: '# Hello\n\n- a\n- b' } })
    await waitFor(() => expect(wrapper.find('h1').exists()).toBe(true))
    expect(wrapper.find('h1').text()).toBe('Hello')
    expect(wrapper.findAll('li')).toHaveLength(2)
  }, TIMEOUT)

  it('shows a copy button for code blocks and copies the code on click', async () => {
    const wrapper = mount(RenderedMarkdown, { props: { content: '```js\nconst x = 1\n```' } })
    await waitFor(() => expect(wrapper.find('.copy-btn').exists()).toBe(true))
    await wrapper.find('.copy-btn').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const x = 1')
  }, TIMEOUT)

  it('does not create live script or img nodes from dangerous markdown', async () => {
    const wrapper = mount(RenderedMarkdown, {
      props: { content: '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\nok' },
    })
    await waitFor(() => expect(wrapper.text()).toContain('ok'))
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
  }, TIMEOUT)

  it('renders a mermaid diagram to SVG when mermaid succeeds', async () => {
    mermaidRender.mockResolvedValue({ svg: '<svg id="diagram"></svg>' })
    const wrapper = mount(RenderedMarkdown, {
      props: { content: '```mermaid\ngraph TD\n  A --> B\n```' },
    })
    await waitFor(() => expect(wrapper.find('svg').exists()).toBe(true))
    expect(mermaidRender).toHaveBeenCalled()
  }, TIMEOUT)

  it('keeps a readable fallback when mermaid rendering fails', async () => {
    mermaidRender.mockRejectedValue(new Error('boom'))
    const wrapper = mount(RenderedMarkdown, {
      props: { content: '```mermaid\ngraph TD\n  A --> B\n```' },
    })
    await waitFor(() => expect(wrapper.text()).toContain('graph TD'))
    expect(wrapper.find('svg').exists()).toBe(false)
  }, TIMEOUT)
})
