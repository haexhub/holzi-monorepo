import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import McpInstallApprovalDetails from '~/components/chat/McpInstallApprovalDetails.vue'

describe('McpInstallApprovalDetails.vue', () => {
  it('renders an http server with its URL and no command line', () => {
    const wrapper = mount(McpInstallApprovalDetails, {
      props: {
        params: {
          name: 'github',
          display_name: 'GitHub MCP',
          transport: 'http',
          url: 'https://api.example/mcp',
        },
      },
    })
    expect(wrapper.get('[data-testid="mcp-install-transport"]').text()).toBe('http')
    expect(wrapper.text()).toContain('mcp:github')
    expect(wrapper.text()).toContain('GitHub MCP')
    expect(wrapper.get('[data-testid="mcp-install-url"]').text()).toContain(
      'https://api.example/mcp',
    )
    expect(wrapper.find('[data-testid="mcp-install-command"]').exists()).toBe(false)
  })

  it('renders a stdio server with its joined command and no URL', () => {
    const wrapper = mount(McpInstallApprovalDetails, {
      props: {
        params: {
          name: 'filesystem',
          transport: 'stdio',
          command_argv: ['npx', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      },
    })
    expect(wrapper.get('[data-testid="mcp-install-transport"]').text()).toBe('stdio')
    expect(wrapper.get('[data-testid="mcp-install-command"]').text()).toBe(
      'npx @modelcontextprotocol/server-filesystem /tmp',
    )
    expect(wrapper.find('[data-testid="mcp-install-url"]').exists()).toBe(false)
  })

  it('lists env keys without ever showing their (redacted) values', () => {
    const wrapper = mount(McpInstallApprovalDetails, {
      props: {
        params: {
          name: 'github',
          transport: 'stdio',
          command_argv: ['npx', 'server-github'],
          env: { GITHUB_TOKEN: '[redacted]', LOG_LEVEL: '[redacted]' },
        },
      },
    })
    const env = wrapper.get('[data-testid="mcp-install-env"]')
    expect(env.text()).toContain('GITHUB_TOKEN')
    expect(env.text()).toContain('LOG_LEVEL')
    // Even the redaction placeholder isn't echoed for values (keys only).
    expect(env.text()).not.toContain('[redacted]')
  })

  it('shows a credentials marker when credentials were set', () => {
    const wrapper = mount(McpInstallApprovalDetails, {
      props: {
        params: {
          name: 'github',
          transport: 'http',
          url: 'https://api.example/mcp',
          credentials: '[redacted, 16 chars]',
        },
      },
    })
    const creds = wrapper.get('[data-testid="mcp-install-credentials"]')
    expect(creds.text()).toContain('components.mcpInstallApprovalDetails.credentialsHidden')
  })

  it('omits env and credentials rows when absent', () => {
    const wrapper = mount(McpInstallApprovalDetails, {
      props: {
        params: {
          name: 'filesystem',
          transport: 'stdio',
          command_argv: ['npx', 'server-filesystem'],
        },
      },
    })
    expect(wrapper.find('[data-testid="mcp-install-env"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mcp-install-credentials"]').exists()).toBe(false)
  })

  it('tolerates null params without throwing', () => {
    const wrapper = mount(McpInstallApprovalDetails, { props: { params: null } })
    expect(wrapper.find('[data-testid="mcp-install-details"]').exists()).toBe(true)
  })
})
