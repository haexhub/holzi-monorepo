import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// McpServersSection calls useI18n() in setup for validation/toast/confirm/
// status copy; the bare mount has no i18n plugin so useI18n would throw
// without the importOriginal-preserving mock. t() passes the key through.
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import McpServersSection from '~/components/settings/McpServersSection.vue'
import type {
  McpServer,
  McpServerList,
  McpServerStatus,
  McpServerTransport,
} from '~/types/api'

// Plan 32 contract guards for the MCP-servers CRUD section:
//   - mounts and renders the empty state
//   - opens the form, validates required fields, submits create
//   - lists servers with status / transport pills and env_keys
//   - Restart triggers POST .../restart and surfaces a toast on failure
//   - Delete confirms then DELETEs
//   - Toggle enabled flips via PUT { enabled }
//   - Edit opens the form pre-filled, doesn't auto-fill credentials,
//     omits credentials in PUT until the user types

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPut = vi.fn()
const apiDelete = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string) => apiGet(path),
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

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('~/composables/useToast', () => ({
  useToast: () => ({
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

function server(overrides: Partial<McpServer> & { name: string }): McpServer {
  return {
    id: overrides.id ?? 1,
    name: overrides.name,
    display_name: overrides.display_name ?? overrides.name,
    transport: (overrides.transport ?? 'http') as McpServerTransport,
    url: overrides.url ?? 'https://example.com',
    command_argv: overrides.command_argv ?? null,
    env_keys: overrides.env_keys ?? [],
    enabled: overrides.enabled ?? true,
    status: (overrides.status ?? 'ready') as McpServerStatus,
    last_error: overrides.last_error ?? null,
    created_at: overrides.created_at ?? 1_700_000_000,
    updated_at: overrides.updated_at ?? 1_700_000_000,
  }
}

function listResponse(items: McpServer[]): McpServerList {
  return { servers: items, total: items.length }
}

describe('components/settings/McpServersSection.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiPut.mockReset()
    apiDelete.mockReset()
    confirmFn.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
    confirmFn.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fetches the server list on mount and renders the empty state', async () => {
    apiGet.mockResolvedValue(listResponse([]))
    const wrapper = mount(McpServersSection)
    await flushPromises()
    expect(apiGet).toHaveBeenCalledWith('/api/mcp/servers')
    expect(wrapper.find('[data-testid="mcp-servers-empty"]').exists()).toBe(
      true,
    )
  })

  it('renders a server card with status, transport, env_keys and url', async () => {
    apiGet.mockResolvedValue(
      listResponse([
        server({
          id: 1,
          name: 'fs',
          display_name: 'Filesystem',
          transport: 'stdio',
          url: null,
          command_argv: ['npx', '-y', '@x/y', '/tmp'],
          env_keys: ['GITHUB_TOKEN', 'DEBUG'],
          status: 'ready',
        }),
      ]),
    )
    const wrapper = mount(McpServersSection)
    await flushPromises()
    const row = wrapper.get('[data-testid="mcp-server-fs"]')
    expect(row.text()).toContain('Filesystem')
    expect(row.get('[data-testid="mcp-server-status-fs"]').text()).toContain(
      'components.mcpServersSection.status.ready',
    )
    expect(row.get('[data-testid="mcp-server-transport-fs"]').text()).toContain(
      'stdio',
    )
    // Env keys surface as names only.
    expect(row.text()).toContain('GITHUB_TOKEN')
    expect(row.text()).toContain('DEBUG')
    // Argv is rendered visibly so the user can see what's running.
    expect(row.text()).toContain('npx -y @x/y /tmp')
  })

  it('shows crash details when expanded', async () => {
    apiGet.mockResolvedValue(
      listResponse([
        server({
          id: 1,
          name: 'broken',
          status: 'crashed',
          last_error: 'RuntimeError: handshake refused',
        }),
      ]),
    )
    const wrapper = mount(McpServersSection)
    await flushPromises()
    const errorBox = wrapper.get('[data-testid="mcp-server-error-broken"]')
    // Collapsed by default — the pre element only renders on expand.
    expect(errorBox.find('pre').exists()).toBe(false)
    await errorBox.get('button').trigger('click')
    expect(errorBox.find('pre').text()).toContain('handshake refused')
  })

  it('opens the create form and POSTs an http server', async () => {
    apiGet.mockResolvedValue(listResponse([]))
    apiPost.mockResolvedValue(server({ name: 'fresh', id: 7 }))
    const wrapper = mount(McpServersSection)
    await flushPromises()

    await wrapper.get('[data-testid="mcp-server-new"]').trigger('click')
    await wrapper
      .get('[data-testid="mcp-server-name"]')
      .setValue('fresh-srv')
    await wrapper
      .get('[data-testid="mcp-server-display-name"]')
      .setValue('Fresh')
    await wrapper.get('[data-testid="mcp-server-url"]').setValue('https://x.test')
    await wrapper
      .get('[data-testid="mcp-server-credentials"]')
      .setValue('bearer-abc')

    await wrapper.get('[data-testid="mcp-server-form-submit"]').trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/api/mcp/servers', {
      name: 'fresh-srv',
      display_name: 'Fresh',
      transport: 'http',
      url: 'https://x.test',
      credentials: 'bearer-abc',
      enabled: true,
    })
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('rejects an invalid slug client-side without POSTing', async () => {
    apiGet.mockResolvedValue(listResponse([]))
    const wrapper = mount(McpServersSection)
    await flushPromises()
    await wrapper.get('[data-testid="mcp-server-new"]').trigger('click')
    await wrapper
      .get('[data-testid="mcp-server-name"]')
      .setValue('Bad Slug')
    await wrapper
      .get('[data-testid="mcp-server-display-name"]')
      .setValue('x')
    await wrapper.get('[data-testid="mcp-server-url"]').setValue('https://x')
    await wrapper.get('[data-testid="mcp-server-form-submit"]').trigger('click')
    await flushPromises()
    expect(apiPost).not.toHaveBeenCalled()
    expect(
      wrapper.get('[data-testid="mcp-server-form-error"]').text(),
    ).toContain('components.mcpServersSection.errors.slugInvalid')
  })

  it('omits credentials from edit-PUT when the user did not retype', async () => {
    apiGet.mockResolvedValue(
      listResponse([
        server({
          id: 5,
          name: 'keep-cred',
          display_name: 'Keep',
          transport: 'http',
          url: 'https://k',
        }),
      ]),
    )
    apiPut.mockResolvedValue(server({ id: 5, name: 'keep-cred' }))
    const wrapper = mount(McpServersSection)
    await flushPromises()
    await wrapper
      .get('[data-testid="mcp-server-edit-keep-cred"]')
      .trigger('click')
    // The credentials field stays empty by default on edit, and the
    // form must NOT send `credentials` (omitted = unchanged).
    await wrapper
      .get('[data-testid="mcp-server-display-name"]')
      .setValue('Keep v2')
    await wrapper.get('[data-testid="mcp-server-form-submit"]').trigger('click')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledTimes(1)
    const [path, body] = apiPut.mock.calls[0]
    expect(path).toBe('/api/mcp/servers/5')
    expect(body).not.toHaveProperty('credentials')
    expect(body).toMatchObject({
      display_name: 'Keep v2',
      url: 'https://k',
    })
  })

  it('sends credentials=null when the user explicitly clears the field', async () => {
    apiGet.mockResolvedValue(
      listResponse([
        server({
          id: 6,
          name: 'clear-cred',
          transport: 'http',
          url: 'https://c',
        }),
      ]),
    )
    apiPut.mockResolvedValue(server({ id: 6, name: 'clear-cred' }))
    const wrapper = mount(McpServersSection)
    await flushPromises()
    await wrapper
      .get('[data-testid="mcp-server-edit-clear-cred"]')
      .trigger('click')
    await wrapper
      .get('[data-testid="mcp-server-credentials-clear"]')
      .trigger('click')
    await wrapper.get('[data-testid="mcp-server-form-submit"]').trigger('click')
    await flushPromises()

    const [, body] = apiPut.mock.calls[0]
    expect(body.credentials).toBeNull()
  })

  it('Restart-Button calls /restart and toasts success', async () => {
    apiGet.mockResolvedValue(
      listResponse([server({ id: 8, name: 'restart-me' })]),
    )
    apiPost.mockResolvedValue(server({ id: 8, name: 'restart-me' }))
    const wrapper = mount(McpServersSection)
    await flushPromises()
    await wrapper
      .get('[data-testid="mcp-server-restart-restart-me"]')
      .trigger('click')
    await flushPromises()
    expect(apiPost).toHaveBeenCalledWith(
      '/api/mcp/servers/8/restart',
      undefined,
    )
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('Delete confirms then DELETEs', async () => {
    apiGet.mockResolvedValue(
      listResponse([server({ id: 9, name: 'to-del' })]),
    )
    apiDelete.mockResolvedValue(undefined)
    const wrapper = mount(McpServersSection)
    await flushPromises()
    await wrapper
      .get('[data-testid="mcp-server-delete-to-del"]')
      .trigger('click')
    await flushPromises()
    expect(confirmFn).toHaveBeenCalled()
    expect(apiDelete).toHaveBeenCalledWith('/api/mcp/servers/9', undefined)
  })

  it('skips the DELETE when the user cancels the confirm', async () => {
    apiGet.mockResolvedValue(
      listResponse([server({ id: 10, name: 'spared' })]),
    )
    confirmFn.mockResolvedValueOnce(false)
    const wrapper = mount(McpServersSection)
    await flushPromises()
    await wrapper
      .get('[data-testid="mcp-server-delete-spared"]')
      .trigger('click')
    await flushPromises()
    expect(apiDelete).not.toHaveBeenCalled()
  })

  it('toggles enabled via PUT { enabled: false }', async () => {
    apiGet.mockResolvedValue(
      listResponse([server({ id: 11, name: 'toggle', enabled: true })]),
    )
    apiPut.mockResolvedValue(server({ id: 11, name: 'toggle', enabled: false }))
    const wrapper = mount(McpServersSection)
    await flushPromises()
    await wrapper
      .get('[data-testid="mcp-server-toggle-toggle"]')
      .trigger('click')
    await flushPromises()
    expect(apiPut).toHaveBeenCalledWith('/api/mcp/servers/11', {
      enabled: false,
    })
  })

  it('switches between http and stdio transport fields in the create form', async () => {
    apiGet.mockResolvedValue(listResponse([]))
    const wrapper = mount(McpServersSection)
    await flushPromises()
    await wrapper.get('[data-testid="mcp-server-new"]').trigger('click')
    // Default = http → URL field is present, command field is not.
    expect(wrapper.find('[data-testid="mcp-server-url"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mcp-server-command"]').exists()).toBe(
      false,
    )
    await wrapper
      .get('[data-testid="mcp-server-transport-stdio"]')
      .trigger('click')
    expect(wrapper.find('[data-testid="mcp-server-url"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mcp-server-command"]').exists()).toBe(
      true,
    )
  })
})
