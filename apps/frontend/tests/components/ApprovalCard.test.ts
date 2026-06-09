import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ApprovalCard from '~/components/chat/ApprovalCard.vue'

const baseApproval = {
  name: 'cross_channel_send',
  arguments: { channel: 'signal', message: 'hi' },
  reason: 'Sends a real message to your linked Signal account.',
}

function clickByLabel(buttons: ReturnType<ReturnType<typeof mount>['findAll']>, label: string) {
  const btn = buttons.find((b) => b.text().includes(label))
  if (!btn) throw new Error(`button with label "${label}" not found`)
  return btn
}

describe('ApprovalCard.vue', () => {
  it('shows the risk reason, tool name and arguments while pending', () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    expect(wrapper.text()).toContain('components.approvalCard.title')
    expect(wrapper.text()).toContain('linked Signal account')
    expect(wrapper.text()).toContain('cross_channel_send')
    // Arguments are rendered.
    expect(wrapper.text()).toContain('channel')
    expect(wrapper.text()).toContain('signal')
  })

  it('renders the four Plan 21 decision buttons', () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).toEqual(
      expect.arrayContaining([
        'components.approvalCard.actions.deny',
        'components.approvalCard.actions.allowOnce',
        'components.approvalCard.actions.allowSession',
        expect.stringContaining('components.approvalCard.actions.allowAlways'),
      ]),
    )
  })

  it('emits each decision with no reason when the textarea stays hidden', async () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    const buttons = wrapper.findAll('button')

    await clickByLabel(buttons, 'components.approvalCard.actions.deny').trigger('click')
    await clickByLabel(buttons, 'components.approvalCard.actions.allowOnce').trigger('click')
    await clickByLabel(buttons, 'components.approvalCard.actions.allowSession').trigger('click')
    await clickByLabel(buttons, 'components.approvalCard.actions.allowAlways').trigger('click')

    expect(wrapper.emitted('decide')).toEqual([
      [{ decision: 'deny' }],
      [{ decision: 'allow_once' }],
      [{ decision: 'allow_session' }],
      [{ decision: 'allow_always' }],
    ])
  })

  it('round-trips a reason from the textarea into the emit payload', async () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    // Textarea is collapsed by default — expand it via the "Mit Begründung" link.
    const expand = wrapper
      .findAll('button')
      .find((b) => b.text().includes('components.approvalCard.withReason'))
    expect(expand).toBeTruthy()
    await expand!.trigger('click')

    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    await textarea.setValue('  this would page oncall  ')

    await clickByLabel(wrapper.findAll('button'), 'components.approvalCard.actions.deny').trigger('click')

    // Reason is trimmed before emit.
    expect(wrapper.emitted('decide')).toEqual([
      [{ decision: 'deny', reason: 'this would page oncall' }],
    ])
  })

  it('caps the reason textarea at 500 characters', async () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('components.approvalCard.withReason'))!
      .trigger('click')
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('maxlength')).toBe('500')
  })

  it('disables every decision button while a decision is submitting', () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'submitting' },
    })
    const buttons = wrapper
      .findAll('button')
      .filter((b) => !b.text().includes('components.approvalCard.withReason'))
    expect(buttons.length).toBe(4)
    for (const button of buttons) {
      expect(button.attributes('disabled')).toBeDefined()
    }
  })

  it('renders specialized mcp_install details instead of the raw JSON block', () => {
    const wrapper = mount(ApprovalCard, {
      props: {
        approval: {
          name: 'mcp_install',
          arguments: {
            name: 'filesystem',
            transport: 'stdio',
            command_argv: ['npx', 'server-filesystem', '/tmp'],
          },
          reason: 'Installs an external MCP server.',
        },
        status: 'pending',
      },
    })
    expect(wrapper.find('[data-testid="mcp-install-details"]').exists()).toBe(true)
    // The generic raw-JSON <pre> is suppressed for mcp_install.
    expect(wrapper.find('pre').exists()).toBe(false)
    expect(wrapper.text()).toContain('stdio')
    expect(wrapper.text()).toContain('npx server-filesystem /tmp')
    // Buttons are still the four generic Plan-21 decisions.
    expect(
      wrapper.findAll('button').filter((b) => !b.text().includes('components.approvalCard.withReason')),
    ).toHaveLength(4)
  })

  it('keeps the raw JSON block for non-mcp_install tools', () => {
    const wrapper = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'pending' },
    })
    expect(wrapper.find('[data-testid="mcp-install-details"]').exists()).toBe(false)
    expect(wrapper.find('pre').exists()).toBe(true)
  })

  it('hides the buttons and shows a verdict once decided', () => {
    const allowed = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'allowed' },
    })
    expect(allowed.findAll('button')).toHaveLength(0)
    expect(allowed.text()).toContain('components.approvalCard.verdict.allowed')

    const denied = mount(ApprovalCard, {
      props: { approval: baseApproval, status: 'denied' },
    })
    expect(denied.findAll('button')).toHaveLength(0)
    expect(denied.text()).toContain('components.approvalCard.verdict.denied')
  })
})
