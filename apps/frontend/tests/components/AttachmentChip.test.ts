import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AttachmentChip from '~/components/chat/AttachmentChip.vue'

describe('AttachmentChip.vue', () => {
  it('renders the filename and a human-readable size', () => {
    const wrapper = mount(AttachmentChip, {
      props: { filename: 'notes.txt', contentType: 'text/plain', size: 2048 },
    })
    expect(wrapper.text()).toContain('notes.txt')
    expect(wrapper.text()).toContain('2.0 KB')
  })

  it('formats bytes and megabytes', () => {
    const small = mount(AttachmentChip, {
      props: { filename: 'a', contentType: 'text/plain', size: 512 },
    })
    expect(small.text()).toContain('512 B')
    const big = mount(AttachmentChip, {
      props: { filename: 'b', contentType: 'image/png', size: 3 * 1024 * 1024 },
    })
    expect(big.text()).toContain('3.0 MB')
  })

  it('hides the remove button unless removable', () => {
    const wrapper = mount(AttachmentChip, {
      props: { filename: 'a.txt', contentType: 'text/plain', size: 1 },
    })
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('emits remove when the removable button is clicked', async () => {
    const wrapper = mount(AttachmentChip, {
      props: { filename: 'a.txt', contentType: 'text/plain', size: 1, removable: true },
    })
    const button = wrapper.find('button')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.emitted('remove')).toHaveLength(1)
  })
})
