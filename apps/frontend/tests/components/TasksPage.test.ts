import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// tasks.vue calls useI18n() in setup for validation/error/confirm copy; the
// bare mount has no i18n plugin so useI18n would throw without the
// importOriginal-preserving mock. t() passes the key through.
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import TasksPage from '~/pages/settings/tasks.vue'
import type { AgentTask } from '~/types/api'

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPatch = vi.fn()
const apiDelete = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) => apiGet(path, query),
    post: (path: string, body?: unknown) => apiPost(path, body),
    patch: (path: string, body?: unknown) => apiPatch(path, body),
    put: vi.fn(),
    delete: (path: string, body?: unknown) => apiDelete(path, body),
  }),
}))

const confirmFn = vi.fn()
vi.mock('~/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: (opts: unknown) => confirmFn(opts) }),
}))

function task(overrides: Partial<AgentTask> & { id: number; title: string }): AgentTask {
  return {
    id: overrides.id,
    title: overrides.title,
    prompt: overrides.prompt ?? 'do the thing',
    due_at: overrides.due_at ?? 2_000_000_000,
    schedule: overrides.schedule ?? null,
    timezone: overrides.timezone ?? 'UTC',
    enabled: overrides.enabled ?? true,
    last_run_at: overrides.last_run_at ?? null,
    last_status: overrides.last_status ?? null,
    last_run_id: overrides.last_run_id ?? null,
    created_at: overrides.created_at ?? 1_700_000_000,
    updated_at: overrides.updated_at ?? 1_700_000_000,
  }
}

describe('settings/tasks.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiPatch.mockReset()
    apiDelete.mockReset()
    confirmFn.mockReset()
    confirmFn.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the empty-state when there are no tasks', async () => {
    apiGet.mockResolvedValue([])
    const wrapper = mount(TasksPage)
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/tasks', undefined)
    expect(wrapper.text()).toContain('pages.tasks.emptyList')
    expect(wrapper.text()).toContain('pages.tasks.emptyTitle')
  })

  it('lists tasks with title + schedule chip', async () => {
    apiGet.mockResolvedValue([
      task({
        id: 1,
        title: 'daily summary',
        schedule: '0 8 * * *',
        timezone: 'UTC',
        due_at: 2_000_000_000,
      }),
      task({ id: 2, title: 'one-shot', due_at: 2_000_000_000 }),
    ])
    const wrapper = mount(TasksPage)
    await flushPromises()

    const item1 = wrapper.get('[data-testid="task-item-1"]')
    expect(item1.text()).toContain('daily summary')
    expect(item1.text()).toContain('0 8 * * *')

    const item2 = wrapper.get('[data-testid="task-item-2"]')
    expect(item2.text()).toContain('one-shot')
  })

  it('selecting a task switches the right pane to read mode', async () => {
    apiGet.mockResolvedValue([
      task({ id: 1, title: 't', prompt: 'hello' }),
    ])
    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('[data-testid="task-item-1"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="task-detail-title"]').text()).toBe('t')
    expect(wrapper.text()).toContain('hello')
  })

  it('creates a one-shot task via + button and POSTs the body', async () => {
    apiGet.mockResolvedValueOnce([])
    apiPost.mockResolvedValueOnce(task({ id: 9, title: 'wake up' }))
    apiGet.mockResolvedValueOnce([task({ id: 9, title: 'wake up' })])

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('button[aria-label="pages.tasks.newTask"]').trigger('click')
    await wrapper.find('#taskTitle').setValue('wake up')
    await wrapper.find('#taskPrompt').setValue('say good morning')
    // Mode defaults to 'once' on create.
    await wrapper.find('#taskDueAt').setValue('2099-01-01T10:00')

    await wrapper.get('[data-testid="task-save"]').trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledTimes(1)
    const [path, body] = apiPost.mock.calls[0]
    expect(path).toBe('/api/tasks')
    expect(body).toMatchObject({
      title: 'wake up',
      prompt: 'say good morning',
      schedule: null,
      enabled: true,
    })
    expect(body.due_at).toBeGreaterThan(0)
  })

  it('switches form to cron mode and sends schedule + clears due_at', async () => {
    apiGet.mockResolvedValueOnce([])
    apiPost.mockResolvedValueOnce(task({ id: 9, title: 'daily', schedule: '0 8 * * *' }))
    apiGet.mockResolvedValueOnce([
      task({ id: 9, title: 'daily', schedule: '0 8 * * *' }),
    ])

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('button[aria-label="pages.tasks.newTask"]').trigger('click')
    await wrapper.find('#taskTitle').setValue('daily')
    await wrapper.find('#taskPrompt').setValue('summary')

    // Flip to cron mode.
    const radios = wrapper.findAll('input[type="radio"]')
    await radios[1].setValue()
    await flushPromises()

    await wrapper.find('#taskCron').setValue('0 8 * * *')

    await wrapper.get('[data-testid="task-save"]').trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledTimes(1)
    const [, body] = apiPost.mock.calls[0]
    expect(body).toMatchObject({
      title: 'daily',
      prompt: 'summary',
      due_at: null,
      schedule: '0 8 * * *',
    })
  })

  it('pauses an enabled task via the toggle button', async () => {
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't', enabled: true })])
    apiPatch.mockResolvedValueOnce(task({ id: 1, title: 't', enabled: false }))
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't', enabled: false })])

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('[data-testid="task-item-1"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="task-toggle-enabled"]').trigger('click')
    await flushPromises()

    expect(apiPatch).toHaveBeenCalledWith('/api/tasks/1', {
      enabled: false,
      clear_due_at: false,
      clear_schedule: false,
    })
  })

  it('runs a task now via the play button', async () => {
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't' })])
    apiPost.mockResolvedValueOnce({ task_id: 1, status: 'queued' })
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't', last_status: 'success' })])

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('[data-testid="task-item-1"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="task-run-now"]').trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/api/tasks/1/run', undefined)
  })

  it('deletes a task after confirmation', async () => {
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't' })])
    apiDelete.mockResolvedValueOnce(undefined)
    apiGet.mockResolvedValueOnce([])
    confirmFn.mockResolvedValue(true)

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('[data-testid="task-item-1"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="task-delete"]').trigger('click')
    await flushPromises()

    expect(apiDelete).toHaveBeenCalledWith('/api/tasks/1', undefined)
    expect(confirmFn).toHaveBeenCalled()
  })

  it('aborts delete when the user declines the confirmation', async () => {
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't' })])
    confirmFn.mockResolvedValue(false)

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('[data-testid="task-item-1"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="task-delete"]').trigger('click')
    await flushPromises()

    expect(confirmFn).toHaveBeenCalled()
    expect(apiDelete).not.toHaveBeenCalled()
  })

  it('edits a recurring task and PATCHes with clear_due_at=true', async () => {
    // Regression: the `clear_*` flags carry the load-bearing mode-switch
    // signal. For a same-mode cron edit we expect `clear_due_at: true`
    // (clear the materialised due_at — backend recomputes) and
    // `clear_schedule: false`. The opposite for a same-mode one-shot edit.
    apiGet.mockResolvedValueOnce([
      task({
        id: 1,
        title: 'daily',
        schedule: '0 8 * * *',
        due_at: 1_700_000_000,
      }),
    ])
    apiPatch.mockResolvedValueOnce(
      task({ id: 1, title: 'daily', schedule: '0 9 * * *' }),
    )
    apiGet.mockResolvedValueOnce([
      task({ id: 1, title: 'daily', schedule: '0 9 * * *' }),
    ])

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('[data-testid="task-item-1"]').trigger('click')
    await flushPromises()

    await wrapper.get('button[aria-label="common.edit"]').trigger('click')
    await wrapper.find('#taskCron').setValue('0 9 * * *')

    await wrapper.get('[data-testid="task-save"]').trigger('click')
    await flushPromises()

    expect(apiPatch).toHaveBeenCalledTimes(1)
    const [path, body] = apiPatch.mock.calls[0]
    expect(path).toBe('/api/tasks/1')
    expect(body).toMatchObject({
      title: 'daily',
      schedule: '0 9 * * *',
      due_at: null,
      clear_due_at: true,
      clear_schedule: false,
    })
  })

  it('renders the load-error in the sidebar when GET fails', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'))

    const wrapper = mount(TasksPage)
    await flushPromises()

    // Plan 30: composables route fetch failures through translateError(),
    // which falls back to `errors.GENERIC` for an Error with no backend
    // ErrorCode. The passthrough `$t` stub returns the key verbatim.
    expect(wrapper.text()).toContain('errors.GENERIC')
  })

  it('surfaces a run-now failure as an action error in the detail header', async () => {
    apiGet.mockResolvedValueOnce([task({ id: 1, title: 't' })])
    apiPost.mockRejectedValueOnce(new Error('upstream down'))

    const wrapper = mount(TasksPage)
    await flushPromises()

    await wrapper.get('[data-testid="task-item-1"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="task-run-now"]').trigger('click')
    await flushPromises()

    const banner = wrapper.get('[data-testid="task-action-error"]')
    expect(banner.text()).toContain('upstream down')
    // Sidebar list stays intact — the failure shouldn't replace it.
    expect(wrapper.get('[data-testid="task-item-1"]').exists()).toBe(true)
  })
})
