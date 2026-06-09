import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// workspaces.vue calls useI18n() in setup for prompt/confirm/toast copy and
// the sandbox-state labels; the bare mount has no i18n plugin so useI18n
// would throw without the importOriginal-preserving mock. t() passes the key
// through (and interpolation params are dropped, which the assertions allow).
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import WorkspacesPage from '~/pages/settings/workspaces.vue'
import type { Workspace } from '~/types/api'

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPatch = vi.fn()
const apiDelete = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) => apiGet(path, query),
    post: (path: string, body?: unknown) => apiPost(path, body),
    put: vi.fn(),
    patch: (path: string, body?: unknown) => apiPatch(path, body),
    delete: (path: string, body?: unknown) => apiDelete(path, body),
  }),
}))

const confirmFn = vi.fn()
vi.mock('~/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: (opts: unknown) => confirmFn(opts) }),
}))

const promptFn = vi.fn()
vi.mock('~/composables/usePromptDialog', () => ({
  usePromptDialog: () => ({ prompt: (opts: unknown) => promptFn(opts) }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('~/composables/useToast', () => ({
  useToast: () => ({
    success: (msg: string) => toastSuccess(msg),
    error: (msg: string) => toastError(msg),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

function workspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    id: overrides.id,
    display_name: overrides.display_name ?? overrides.id,
    created_at: overrides.created_at ?? 1_700_000_000,
    archived_at: overrides.archived_at ?? null,
    sandbox: overrides.sandbox ?? { state: 'absent', exit_code: null },
    disk: overrides.disk ?? { used_mb: null, quota_mb: null },
    git: overrides.git ?? { is_repo: false, branch: null, dirty: false },
  }
}

describe('settings/workspaces.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiPatch.mockReset()
    apiDelete.mockReset()
    confirmFn.mockReset()
    promptFn.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
    confirmFn.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the empty-state on first mount with no workspaces', async () => {
    apiGet.mockResolvedValue([])
    const wrapper = mount(WorkspacesPage)
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/workspaces', undefined)
    expect(wrapper.text()).toContain('pages.workspaces.emptyTitle')
    expect(wrapper.text()).toContain('pages.workspaces.emptyList')
  })

  it('lists workspaces with display name, slug, and dirty-git badge', async () => {
    apiGet.mockResolvedValue([
      workspace({
        id: 'project-a',
        display_name: 'Projekt A',
        sandbox: { state: 'running', exit_code: null },
        disk: { used_mb: 42, quota_mb: null },
        git: { is_repo: true, branch: 'main', dirty: true },
      }),
    ])
    const wrapper = mount(WorkspacesPage)
    await flushPromises()

    const item = wrapper.get('[data-testid="workspace-item-project-a"]')
    const text = item.text()
    expect(text).toContain('Projekt A')
    expect(text).toContain('project-a')
    expect(text).toContain('42 MiB')
    expect(text).toContain('main')
    expect(text).toContain('pages.workspaces.list.dirty')
  })

  it('opens the detail pane on click and shows sandbox status', async () => {
    apiGet.mockResolvedValue([
      workspace({
        id: 'ws-1',
        display_name: 'WS 1',
        sandbox: { state: 'running', exit_code: null },
      }),
    ])
    const wrapper = mount(WorkspacesPage)
    await flushPromises()

    await wrapper.get('[data-testid="workspace-item-ws-1"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="workspace-detail-title"]').text()).toBe(
      'WS 1',
    )
    expect(wrapper.text()).toContain('pages.workspaces.sandbox.states.running')
  })

  it('creates a workspace via the prompt dialog and reloads the list', async () => {
    apiGet
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([workspace({ id: 'fresh', display_name: 'Fresh' })])
    promptFn
      .mockResolvedValueOnce('fresh')
      .mockResolvedValueOnce('Fresh')
    apiPost.mockResolvedValue(workspace({ id: 'fresh', display_name: 'Fresh' }))

    const wrapper = mount(WorkspacesPage)
    await flushPromises()

    await wrapper.get('[data-testid="workspace-create-button"]').trigger('click')
    await flushPromises()

    expect(promptFn).toHaveBeenCalledTimes(2)
    expect(apiPost).toHaveBeenCalledWith('/api/workspaces', {
      id: 'fresh',
      display_name: 'Fresh',
    })
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('cancels the create flow when the user aborts the slug prompt', async () => {
    apiGet.mockResolvedValue([])
    promptFn.mockResolvedValueOnce(null)
    const wrapper = mount(WorkspacesPage)
    await flushPromises()

    await wrapper.get('[data-testid="workspace-create-button"]').trigger('click')
    await flushPromises()

    expect(promptFn).toHaveBeenCalledTimes(1)
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('renames via PATCH and reloads', async () => {
    apiGet
      .mockResolvedValueOnce([
        workspace({ id: 'rename-me', display_name: 'Old' }),
      ])
      .mockResolvedValueOnce([
        workspace({ id: 'rename-me', display_name: 'New' }),
      ])
    apiPatch.mockResolvedValue(
      workspace({ id: 'rename-me', display_name: 'New' }),
    )

    const wrapper = mount(WorkspacesPage)
    await flushPromises()

    await wrapper.get('[data-testid="workspace-item-rename-me"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="workspace-rename-button"]').trigger('click')
    await flushPromises()

    const input = wrapper.get('[data-testid="workspace-rename-form"] input')
    await input.setValue('New')
    await wrapper.get('[data-testid="workspace-rename-form"]').trigger('submit')
    await flushPromises()

    expect(apiPatch).toHaveBeenCalledWith('/api/workspaces/rename-me', {
      display_name: 'New',
    })
  })

  it('archives via DELETE when the confirm dialog returns true', async () => {
    apiGet
      .mockResolvedValueOnce([
        workspace({ id: 'archive-me', display_name: 'Bye' }),
      ])
      .mockResolvedValueOnce([])
    apiDelete.mockResolvedValue(undefined)

    const wrapper = mount(WorkspacesPage)
    await flushPromises()

    await wrapper.get('[data-testid="workspace-item-archive-me"]').trigger('click')
    await flushPromises()
    await wrapper
      .get('[data-testid="workspace-archive-button"]')
      .trigger('click')
    await flushPromises()

    expect(confirmFn).toHaveBeenCalled()
    expect(apiDelete).toHaveBeenCalledWith(
      '/api/workspaces/archive-me',
      undefined,
    )
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('does NOT call DELETE when the confirm dialog returns false', async () => {
    apiGet.mockResolvedValue([
      workspace({ id: 'safe', display_name: 'Safe' }),
    ])
    confirmFn.mockResolvedValueOnce(false)
    const wrapper = mount(WorkspacesPage)
    await flushPromises()

    await wrapper.get('[data-testid="workspace-item-safe"]').trigger('click')
    await flushPromises()
    await wrapper
      .get('[data-testid="workspace-archive-button"]')
      .trigger('click')
    await flushPromises()

    expect(confirmFn).toHaveBeenCalled()
    expect(apiDelete).not.toHaveBeenCalled()
  })

  it('restarts the sandbox via POST .../restart', async () => {
    apiGet
      .mockResolvedValueOnce([
        workspace({
          id: 'restart-me',
          display_name: 'Restart Me',
          sandbox: { state: 'crashed', exit_code: 137 },
        }),
      ])
      .mockResolvedValueOnce([
        workspace({
          id: 'restart-me',
          display_name: 'Restart Me',
          sandbox: { state: 'running', exit_code: null },
        }),
      ])
    apiPost.mockResolvedValue({
      workspace_id: 'restart-me',
      state: 'running',
      exit_code: null,
    })

    const wrapper = mount(WorkspacesPage)
    await flushPromises()

    await wrapper.get('[data-testid="workspace-item-restart-me"]').trigger('click')
    await flushPromises()
    await wrapper
      .get('[data-testid="workspace-restart-button"]')
      .trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith(
      '/api/workspaces/restart-me/sandbox/restart',
      undefined,
    )
    expect(toastSuccess).toHaveBeenCalled()
  })
})
