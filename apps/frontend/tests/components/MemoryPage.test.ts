import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// memory.vue calls useI18n() in setup for confirm/error/validation copy;
// the bare mount has no i18n plugin so useI18n would throw without the
// importOriginal-preserving mock. t() is a passthrough on the key.
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import MemoryPage from '~/pages/settings/memory.vue'
import type { Note } from '~/types/api'

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPut = vi.fn()
const apiDelete = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) => apiGet(path, query),
    post: (path: string, body?: unknown) => apiPost(path, body),
    put: (path: string, body?: unknown) => apiPut(path, body),
    patch: vi.fn(),
    delete: (path: string, body?: unknown) => apiDelete(path, body),
  }),
}))

const confirmFn = vi.fn()
vi.mock('~/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: (opts: unknown) => confirmFn(opts) }),
}))

// RenderedMarkdown loads shiki/mermaid lazily and is overkill for unit
// tests that only care about the layout. Stub it to a plain div so we
// can still assert on rendered content.
const stubs = {
  ChatRenderedMarkdown: {
    name: 'RenderedMarkdown',
    props: ['content'],
    template: '<div data-testid="memory-detail-body">{{ content }}</div>',
  },
}

function note(overrides: Partial<Note> & { key: string }): Note {
  return {
    id: overrides.id ?? Math.floor(Math.random() * 1_000_000),
    key: overrides.key,
    content: overrides.content ?? 'content',
    tags: overrides.tags ?? null,
    updated_at: overrides.updated_at ?? 1_700_000_000,
  }
}

describe('settings/memory.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiPut.mockReset()
    apiDelete.mockReset()
    confirmFn.mockReset()
    confirmFn.mockResolvedValue(true)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders the empty-state on first mount with no selection', async () => {
    apiGet.mockResolvedValue([])
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/notes', undefined)
    expect(wrapper.text()).toContain('pages.memory.emptyTitle')
    expect(wrapper.text()).toContain('pages.memory.empty')
  })

  it('lists notes in the sidebar with key, preview, and tags', async () => {
    apiGet.mockResolvedValue([
      note({ key: 'project.holzi', content: 'phase 2', tags: 'hermes,status' }),
    ])
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    const item = wrapper.get('[data-testid="memory-item-project.holzi"]')
    const text = item.text()
    expect(text).toContain('project.holzi')
    expect(text).toContain('phase 2')
    expect(text).toContain('hermes')
    expect(text).toContain('status')
  })

  it('shows the selected note in read mode with title + body', async () => {
    apiGet.mockResolvedValue([
      note({ key: 'k', content: '# Hello world' }),
    ])
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="memory-item-k"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="memory-detail-title"]').text()).toBe('k')
    expect(wrapper.get('[data-testid="memory-detail-body"]').text()).toContain(
      '# Hello world',
    )
  })

  it('debounces the search and forwards q as a query param', async () => {
    apiGet.mockResolvedValue([])
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()
    apiGet.mockClear()

    const search = wrapper.find('input[aria-label="pages.memory.searchAria"]')
    await search.setValue('stand')
    await search.setValue('standup')
    expect(apiGet).not.toHaveBeenCalled()

    vi.advanceTimersByTime(250)
    await flushPromises()

    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(apiGet).toHaveBeenCalledWith('/api/notes', { q: 'standup' })
  })

  it('falls back to the unfiltered list when the search is cleared', async () => {
    apiGet.mockResolvedValue([])
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    const search = wrapper.find('input[aria-label="pages.memory.searchAria"]')
    await search.setValue('foo')
    vi.advanceTimersByTime(250)
    await flushPromises()
    apiGet.mockClear()

    await search.setValue('')
    vi.advanceTimersByTime(250)
    await flushPromises()
    expect(apiGet).toHaveBeenLastCalledWith('/api/notes', undefined)
  })

  it('creates a new note via the + button and selects it', async () => {
    apiGet.mockResolvedValueOnce([])
    apiPost.mockResolvedValueOnce({})
    apiGet.mockResolvedValueOnce([
      note({ key: 'k', content: 'v', tags: 't1,t2' }),
    ])
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    await wrapper.get('button[aria-label="pages.memory.newNote"]').trigger('click')

    await wrapper.find('#memoryKey').setValue('k')
    await wrapper.find('#memoryContent').setValue('v')
    await wrapper.find('#memoryTags').setValue('t1, t2')

    await wrapper.get('button[aria-label="common.save"]').trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/api/notes', {
      key: 'k',
      content: 'v',
      tags: ['t1', 't2'],
    })
    expect(wrapper.get('[data-testid="memory-detail-title"]').text()).toBe('k')
  })

  it('edits an existing note and PUTs content + tags', async () => {
    apiGet.mockResolvedValueOnce([
      note({ key: 'k', content: 'old', tags: 'a' }),
    ])
    apiPut.mockResolvedValueOnce({})
    apiGet.mockResolvedValueOnce([
      note({ key: 'k', content: 'new', tags: 'a,b' }),
    ])
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="memory-item-k"]').trigger('click')
    await wrapper.get('button[aria-label="common.edit"]').trigger('click')

    await wrapper.find('#memoryContent').setValue('new')
    await wrapper.find('#memoryTags').setValue('a, b')

    await wrapper.get('button[aria-label="common.save"]').trigger('click')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith('/api/notes/k', {
      content: 'new',
      tags: ['a', 'b'],
    })
    expect(wrapper.get('[data-testid="memory-detail-body"]').text()).toContain('new')
  })

  it('disables the key input when editing existing notes', async () => {
    apiGet.mockResolvedValue([note({ key: 'k', content: 'x' })])
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="memory-item-k"]').trigger('click')
    await wrapper.get('button[aria-label="common.edit"]').trigger('click')

    const keyInput = wrapper.find<HTMLInputElement>('#memoryKey')
    expect(keyInput.element.readOnly).toBe(true)
    expect(keyInput.element.disabled).toBe(true)
  })

  it('cancel from edit mode returns to read mode without saving', async () => {
    apiGet.mockResolvedValue([note({ key: 'k', content: 'orig' })])
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="memory-item-k"]').trigger('click')
    await wrapper.get('button[aria-label="common.edit"]').trigger('click')
    await wrapper.find('#memoryContent').setValue('mutated')

    await wrapper.get('button[aria-label="common.cancel"]').trigger('click')
    await flushPromises()

    expect(apiPut).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="memory-detail-body"]').text()).toContain('orig')
  })

  it('url-encodes the key when deleting and clears the selection', async () => {
    apiGet.mockResolvedValueOnce([note({ key: 'foo bar', content: 'x' })])
    apiDelete.mockResolvedValueOnce({})
    apiGet.mockResolvedValueOnce([])
    confirmFn.mockResolvedValue(true)

    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="memory-item-foo bar"]').trigger('click')
    await wrapper.get('button[aria-label="common.delete"]').trigger('click')
    await flushPromises()

    expect(confirmFn).toHaveBeenCalled()
    expect(apiDelete.mock.calls[0]?.[0]).toBe('/api/notes/foo%20bar')
    expect(wrapper.text()).toContain('pages.memory.emptyTitle')
  })

  it('does not delete when the user cancels the confirm', async () => {
    apiGet.mockResolvedValue([note({ key: 'k', content: 'x' })])
    confirmFn.mockResolvedValue(false)

    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="memory-item-k"]').trigger('click')
    await wrapper.get('button[aria-label="common.delete"]').trigger('click')
    await flushPromises()

    expect(confirmFn).toHaveBeenCalled()
    expect(apiDelete).not.toHaveBeenCalled()
  })

  it('cancel-from-edit drops to empty when the note was filtered out mid-edit', async () => {
    apiGet.mockResolvedValueOnce([note({ key: 'k', content: 'orig' })])
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="memory-item-k"]').trigger('click')
    await wrapper.get('button[aria-label="common.edit"]').trigger('click')

    // Simulate a search-triggered reload that drops the active selection
    // while the user is still in edit mode (the load() stale-guard only
    // resets when mode !== 'edit', so this state is reachable).
    apiGet.mockResolvedValueOnce([])
    const search = wrapper.find('input[aria-label="pages.memory.searchAria"]')
    await search.setValue('nomatch')
    vi.advanceTimersByTime(250)
    await flushPromises()

    await wrapper.get('button[aria-label="common.cancel"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="memory-detail-title"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('pages.memory.emptyTitle')
  })

  it('falls back to empty-state when the selection is filtered out of the list', async () => {
    apiGet.mockResolvedValueOnce([note({ key: 'k', content: 'x' })])
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()

    await wrapper.get('[data-testid="memory-item-k"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="memory-detail-title"]').text()).toBe('k')

    // Typing into the search box should reload — if the new result set
    // doesn't contain the active selection, the detail pane should drop
    // back to the empty-state (no orphaned action buttons).
    apiGet.mockResolvedValueOnce([])
    const search = wrapper.find('input[aria-label="pages.memory.searchAria"]')
    await search.setValue('nomatch')
    vi.advanceTimersByTime(250)
    await flushPromises()

    expect(wrapper.find('[data-testid="memory-detail-title"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('pages.memory.emptyTitle')
  })

  it('surfaces load errors in the sidebar', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'))
    const wrapper = mount(MemoryPage, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('boom')
  })
})
