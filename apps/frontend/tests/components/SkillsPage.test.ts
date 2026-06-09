import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// skills.vue + its SkillsSection/McpServersSection children call useI18n() in
// setup; the bare mount has no i18n plugin so useI18n would throw without the
// importOriginal-preserving mock. t() passes the key through; useLocalePath()
// is auto-imported from the nuxt test env (same as PreferencesPage).
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import SkillsPage from '~/pages/settings/skills.vue'
import type {
  McpHealthResponse,
  ToolInfo,
  ToolsResponse,
} from '~/types/api'

// Plan 31 contract guards:
//   - both endpoints fired on mount, in parallel
//   - MCP card status, URL, tool count + refresh
//   - tool list alphabetic, source pill, approval badge only when set
//   - parameter toggle opens/closes the JSON viewer
//   - Configure buttons disabled with the right tooltip
//   - one endpoint failing doesn't hide the other section

const apiGet = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) => apiGet(path, query),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('~/composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

function tool(overrides: Partial<ToolInfo> & { name: string }): ToolInfo {
  return {
    name: overrides.name,
    description: overrides.description ?? `${overrides.name} does things`,
    requires_approval: overrides.requires_approval ?? false,
    risk_reason: overrides.risk_reason ?? null,
    parameters_schema:
      overrides.parameters_schema ??
      ({
        type: 'object',
        properties: { foo: { type: 'string' } },
      } as ToolInfo['parameters_schema']),
    source: overrides.source ?? 'builtin',
  }
}

function tools(list: ToolInfo[]): ToolsResponse {
  return { tools: list, total: list.length }
}

function mcpHealth(
  overrides: Partial<McpHealthResponse> = {},
): McpHealthResponse {
  return {
    status: overrides.status ?? 'ok',
    url: overrides.url ?? '/mcp',
    tool_count: overrides.tool_count ?? 3,
    message: overrides.message ?? 'bereit',
  }
}

function setupGet(
  toolsResult: ToolsResponse | Error,
  mcpResult: McpHealthResponse | Error,
) {
  apiGet.mockImplementation((path: string) => {
    if (path === '/api/tools') {
      return toolsResult instanceof Error
        ? Promise.reject(toolsResult)
        : Promise.resolve(toolsResult)
    }
    if (path === '/api/mcp/health') {
      return mcpResult instanceof Error
        ? Promise.reject(mcpResult)
        : Promise.resolve(mcpResult)
    }
    // Plan 32: the page now also mounts <McpServersSection>, which
    // fetches /api/mcp/servers on mount. The Plan 31 tests don't care
    // about that surface; resolve with an empty list so the section's
    // empty-state renders without affecting the assertions below.
    if (path === '/api/mcp/servers') {
      return Promise.resolve({ servers: [], total: 0 })
    }
    // Plan 33: <SkillsSection> fetches /api/skills on mount. Same
    // treatment — resolve with an empty list.
    if (path === '/api/skills') {
      return Promise.resolve({ skills: [] })
    }
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

describe('settings/skills.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
    // Stub clipboard so the copy button doesn't blow up in jsdom.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads /api/tools and /api/mcp/health on mount and renders both sections', async () => {
    setupGet(
      tools([tool({ name: 'save_note' }), tool({ name: 'web_search' })]),
      mcpHealth(),
    )
    const wrapper = mount(SkillsPage)
    await flushPromises()

    expect(apiGet).toHaveBeenCalledWith('/api/tools', undefined)
    expect(apiGet).toHaveBeenCalledWith('/api/mcp/health', undefined)

    expect(wrapper.find('[data-testid="mcp-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tools-section"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="tools-count"]').text()).toContain(
      'pages.skills.tools.count',
    )
    expect(wrapper.get('[data-testid="mcp-tool-count"]').text()).toContain(
      'pages.skills.mcpEndpoint.toolsExposed',
    )
  })

  it('shows MCP status active / inactive based on the response', async () => {
    setupGet(tools([]), mcpHealth({ status: 'ok' }))
    const wrapper = mount(SkillsPage)
    await flushPromises()
    expect(wrapper.get('[data-testid="mcp-status"]').text()).toContain('pages.skills.mcpEndpoint.active')
    expect(wrapper.get('[data-testid="mcp-url"]').text()).toBe('/mcp')

    setupGet(
      tools([]),
      mcpHealth({ status: 'error', message: 'nicht initialisiert' }),
    )
    const wrapper2 = mount(SkillsPage)
    await flushPromises()
    expect(wrapper2.get('[data-testid="mcp-status"]').text()).toContain(
      'pages.skills.mcpEndpoint.inactive',
    )
  })

  it('refresh button triggers a second /api/mcp/health call', async () => {
    setupGet(tools([]), mcpHealth())
    const wrapper = mount(SkillsPage)
    await flushPromises()
    const healthCallsBefore = apiGet.mock.calls.filter(
      (args) => args[0] === '/api/mcp/health',
    ).length
    await wrapper.get('[data-testid="mcp-refresh"]').trigger('click')
    await flushPromises()
    const healthCallsAfter = apiGet.mock.calls.filter(
      (args) => args[0] === '/api/mcp/health',
    ).length
    expect(healthCallsAfter).toBe(healthCallsBefore + 1)
  })

  it('configure-MCP button is enabled and jumps to the MCP-servers section', async () => {
    setupGet(tools([]), mcpHealth())
    const wrapper = mount(SkillsPage, { attachTo: document.body })
    await flushPromises()
    const btn = wrapper.get('[data-testid="mcp-configure"]')
    // Plan 32 activated this button — it now scrolls to the MCP-servers
    // section anchor instead of being disabled.
    expect(btn.attributes('disabled')).toBeUndefined()
    // The MCP-servers section is mounted with the anchor id the button
    // scrolls to, so the linkage is testable end-to-end.
    expect(
      wrapper.find('[data-testid="mcp-servers-section"]').exists(),
    ).toBe(true)
    expect(document.getElementById('mcp-section')).not.toBeNull()
    wrapper.unmount()
  })

  it('renders the tool list in the order returned by the backend with source pill', async () => {
    // Backend already sorts; the page just renders the array. Pass sorted
    // input so the DOM-order assertion verifies the contract.
    const sorted: ToolInfo[] = [
      tool({ name: 'read_user_guide' }),
      tool({ name: 'save_note' }),
      tool({ name: 'web_search' }),
    ]
    setupGet(tools(sorted), mcpHealth())
    const wrapper = mount(SkillsPage)
    await flushPromises()

    const rows = wrapper
      .findAll('li[data-testid^="tool-"]')
      .map((el) => el.attributes('data-testid')!)
      .map((id) => id.slice('tool-'.length))
    expect(rows).toEqual(['read_user_guide', 'save_note', 'web_search'])

    for (const name of rows) {
      const pill = wrapper.get(`[data-testid="tool-source-${name}"]`)
      expect(pill.text()).toContain('built-in')
    }
  })

  it('shows the approval badge only on requires_approval tools', async () => {
    setupGet(
      tools([
        tool({
          name: 'send_signal_message',
          requires_approval: true,
          risk_reason: 'sends a message to another channel',
        }),
        tool({ name: 'save_note' }),
      ]),
      mcpHealth(),
    )
    const wrapper = mount(SkillsPage)
    await flushPromises()
    expect(
      wrapper.find('[data-testid="tool-approval-send_signal_message"]').exists(),
    ).toBe(true)
    expect(
      wrapper.find('[data-testid="tool-approval-save_note"]').exists(),
    ).toBe(false)
    // Risk reason is rendered for the approval-gated tool.
    expect(wrapper.get('[data-testid="tool-send_signal_message"]').text()).toContain(
      'sends a message to another channel',
    )
  })

  it('toggles the parameter JSON viewer on click', async () => {
    setupGet(
      tools([
        tool({
          name: 'save_note',
          parameters_schema: {
            type: 'object',
            properties: { key: { type: 'string' } },
          } as ToolInfo['parameters_schema'],
        }),
      ]),
      mcpHealth(),
    )
    const wrapper = mount(SkillsPage)
    await flushPromises()
    // Collapsed initially.
    expect(
      wrapper.find('[data-testid="tool-schema-save_note"]').exists(),
    ).toBe(false)
    await wrapper.get('[data-testid="tool-toggle-save_note"]').trigger('click')
    expect(
      wrapper.get('[data-testid="tool-schema-save_note"]').text(),
    ).toContain('"key"')
    await wrapper.get('[data-testid="tool-toggle-save_note"]').trigger('click')
    expect(
      wrapper.find('[data-testid="tool-schema-save_note"]').exists(),
    ).toBe(false)
  })

  it('falls back to "keine Parameter" when the tool has an empty schema', async () => {
    setupGet(
      tools([
        tool({
          name: 'list_notes',
          parameters_schema: {
            type: 'object',
            properties: {},
          } as ToolInfo['parameters_schema'],
        }),
      ]),
      mcpHealth(),
    )
    const wrapper = mount(SkillsPage)
    await flushPromises()
    await wrapper
      .get('[data-testid="tool-toggle-list_notes"]')
      .trigger('click')
    expect(
      wrapper.get('[data-testid="tool-schema-list_notes"]').text(),
    ).toContain('pages.skills.tools.noParams')
  })

  it('disables each built-in Configure button (no per-tool config surface today)', async () => {
    setupGet(tools([tool({ name: 'save_note' })]), mcpHealth())
    const wrapper = mount(SkillsPage)
    await flushPromises()
    const btn = wrapper.get('[data-testid="tool-configure-save_note"]')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toContain('pages.skills.tools.builtinNoConfig')
  })

  it('enables Configure for mcp-sourced tools and jumps to the server card', async () => {
    setupGet(
      tools([tool({ name: 'filesystem__read_file', source: 'mcp:filesystem' })]),
      mcpHealth(),
    )
    const wrapper = mount(SkillsPage)
    await flushPromises()
    const btn = wrapper.get(
      '[data-testid="tool-configure-filesystem__read_file"]',
    )
    // Plan 32 sprungpunkt: MCP-sourced tools' Configure button is active.
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('surfaces an /api/tools error without hiding the MCP card', async () => {
    setupGet(new Error('tools boom'), mcpHealth())
    const wrapper = mount(SkillsPage)
    await flushPromises()
    // Plan 30: composables route fetch failures through translateError(),
    // which falls back to `errors.GENERIC` for a plain Error.
    expect(wrapper.get('[data-testid="tools-error"]').text()).toContain(
      'errors.GENERIC',
    )
    // MCP card still renders normally.
    expect(wrapper.get('[data-testid="mcp-status"]').text()).toContain('pages.skills.mcpEndpoint.active')
  })

  it('shows the MCP error banner without hiding the tool list', async () => {
    setupGet(tools([tool({ name: 'save_note' })]), new Error('mcp boom'))
    const wrapper = mount(SkillsPage)
    await flushPromises()
    expect(wrapper.get('[data-testid="mcp-error"]').text()).toContain(
      'errors.GENERIC',
    )
    expect(wrapper.get('[data-testid="tool-save_note"]').exists()).toBe(true)
  })
})
