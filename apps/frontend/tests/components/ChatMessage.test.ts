import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatMessage from '~/components/chat/ChatMessage.vue'

// Stub the (async, shiki-backed) Markdown renderer so these tests stay fast
// and focused on ChatMessage's routing.
const stubs = {
  ChatRenderedMarkdown: {
    name: 'RenderedMarkdown',
    props: ['content'],
    template: '<div class="rm-stub">{{ content }}</div>',
  },
  ChatToolCallCard: {
    name: 'ToolCallCard',
    props: ['toolCall'],
    template: '<div class="tcc-stub">{{ toolCall.name }}</div>',
  },
  ChatReasoningCard: {
    name: 'ReasoningCard',
    props: ['content', 'streaming'],
    template: '<div class="rc-stub">{{ content }}</div>',
  },
}

describe('ChatMessage.vue', () => {
  it('renders assistant messages through RenderedMarkdown', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'assistant', content: '# Hi' } },
      global: { stubs },
    })
    expect(wrapper.find('.rm-stub').exists()).toBe(true)
    expect(wrapper.find('.rm-stub').text()).toBe('# Hi')
  })

  it('renders attachment chips on a user message', () => {
    const wrapper = mount(ChatMessage, {
      props: {
        message: {
          role: 'user',
          content: 'see attached',
          attachments: [
            {
              id: 1,
              conversation_id: 7,
              message_id: 3,
              filename: 'server.log',
              content_type: 'text/plain',
              size: 4096,
              created_at: 0,
            },
          ],
        },
      },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('server.log')
    expect(wrapper.text()).toContain('4.0 KB')
  })

  it('renders user messages as plain text, not Markdown', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'user', content: '# not a heading' } },
      global: { stubs },
    })
    expect(wrapper.find('.rm-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('# not a heading')
  })

  it('keeps the streaming bubble plain even though it is an assistant message', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'assistant', content: '# live token' }, plain: true },
      global: { stubs },
    })
    expect(wrapper.find('.rm-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('# live token')
  })

  it('shows a timestamp when ts is provided', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'assistant', content: 'hi', ts: 1716800000 }, canRetry: false },
      global: { stubs },
    })
    const ts = wrapper.find('.message-ts')
    expect(ts.exists()).toBe(true)
    expect(ts.text()).toMatch(/\d/)
  })

  it('omits the timestamp when ts is absent (e.g. streaming bubble)', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'assistant', content: 'streaming…' } },
      global: { stubs },
    })
    expect(wrapper.find('.message-ts').exists()).toBe(false)
  })

  it('renders a tool turn as a ToolCallCard, not a text bubble', () => {
    const wrapper = mount(ChatMessage, {
      props: {
        message: {
          role: 'tool',
          content: 'found 3 notes',
          tool_call: {
            call_id: 'c1',
            name: 'notes.find',
            arguments: { q: 'x' },
            status: 'success',
            result: 'found 3 notes',
            error: null,
          },
        },
      },
      global: { stubs },
    })
    const card = wrapper.find('.tcc-stub')
    expect(card.exists()).toBe(true)
    expect(card.text()).toBe('notes.find')
  })

  it('hides an empty assistant turn (the tool-call request placeholder)', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'assistant', content: '', ts: 1716800000 } },
      global: { stubs },
    })
    expect(wrapper.find('div').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('renders a persisted reasoning card above an assistant answer', () => {
    const wrapper = mount(ChatMessage, {
      props: {
        message: {
          role: 'assistant',
          content: 'The answer is 42.',
          reasoning: 'I worked through the math.',
        },
      },
      global: { stubs },
    })
    const card = wrapper.find('.rc-stub')
    expect(card.exists()).toBe(true)
    expect(card.text()).toBe('I worked through the math.')
    // The answer bubble still renders alongside the reasoning card.
    expect(wrapper.find('.rm-stub').text()).toBe('The answer is 42.')
  })

  it('renders a reasoning-only assistant turn (no text bubble) instead of hiding it', () => {
    const wrapper = mount(ChatMessage, {
      props: {
        message: { role: 'assistant', content: '', reasoning: 'thinking aloud' },
      },
      global: { stubs },
    })
    expect(wrapper.find('.rc-stub').exists()).toBe(true)
    // No empty answer bubble.
    expect(wrapper.find('.rm-stub').exists()).toBe(false)
  })

  it('still renders a legacy tool message without tool_call as plain text', () => {
    const wrapper = mount(ChatMessage, {
      props: { message: { role: 'tool', content: 'legacy tool output' } },
      global: { stubs },
    })
    expect(wrapper.find('.tcc-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('legacy tool output')
  })
})
