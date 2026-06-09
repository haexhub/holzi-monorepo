import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return { ...orig, useI18n: () => ({ t: (k: string) => k }) }
})

import ChatComposer from '~/components/chat/ChatComposer.vue'

function addFile(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper.find('input[type="file"]')
  Object.defineProperty(input.element, 'files', {
    value: [file],
    configurable: true,
  })
  return input.trigger('change')
}

describe('ChatComposer.vue', () => {
  it('emits send with the trimmed text and no files', async () => {
    const wrapper = mount(ChatComposer)
    await wrapper.find('textarea').setValue('  hello  ')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('send')).toEqual([[{ text: 'hello', files: [] }]])
  })

  it('does not emit when the text is empty even with a file attached', async () => {
    const wrapper = mount(ChatComposer)
    await addFile(wrapper, new File(['x'], 'a.txt', { type: 'text/plain' }))
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('shows a chip for a picked file and includes it in the send payload', async () => {
    const wrapper = mount(ChatComposer)
    const file = new File(['hello'], 'log.txt', { type: 'text/plain' })
    await addFile(wrapper, file)
    expect(wrapper.text()).toContain('log.txt')

    await wrapper.find('textarea').setValue('check this')
    await wrapper.find('form').trigger('submit')
    const events = wrapper.emitted('send')
    expect(events).toHaveLength(1)
    const payload = events![0]![0] as { text: string; files: File[] }
    expect(payload.text).toBe('check this')
    expect(payload.files).toHaveLength(1)
    expect(payload.files[0]!.name).toBe('log.txt')
  })

  it('removes a picked file before send', async () => {
    const wrapper = mount(ChatComposer)
    await addFile(wrapper, new File(['x'], 'remove-me.txt', { type: 'text/plain' }))
    expect(wrapper.text()).toContain('remove-me.txt')

    // The chip's remove button is the only button rendered in the preview row.
    const removeButton = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label')?.includes('remove-me.txt'))
    expect(removeButton).toBeTruthy()
    await removeButton!.trigger('click')
    expect(wrapper.text()).not.toContain('remove-me.txt')
  })

  it('clears text and files after a send', async () => {
    const wrapper = mount(ChatComposer)
    await addFile(wrapper, new File(['x'], 'gone.txt', { type: 'text/plain' }))
    await wrapper.find('textarea').setValue('bye')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).not.toContain('gone.txt')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  // --- Plan 22: drag&drop --------------------------------------------------

  function buildDataTransfer(files: File[]): DataTransfer {
    const fileList = {
      length: files.length,
      item: (i: number) => files[i] ?? null,
      [Symbol.iterator]: function* () {
        for (const f of files) yield f
      },
    } as unknown as FileList
    // useDropZone (vueuse) validates against `.items`, not `.files`.
    const items = files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f }))
    const itemList = Object.assign([...items], {
      length: items.length,
      add: () => null,
      clear: () => undefined,
      remove: () => undefined,
    }) as unknown as DataTransferItemList
    return {
      files: fileList,
      items: itemList,
      types: ['Files'],
      dropEffect: 'none',
      effectAllowed: 'all',
    } as unknown as DataTransfer
  }

  function fireDrag(form: Element, type: string, dt: DataTransfer) {
    // wrapper.trigger() drops the custom `dataTransfer` property in some
    // event constructors; dispatch the event directly so it survives.
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, { dataTransfer: dt })
    form.dispatchEvent(event)
  }

  async function mountReady() {
    const wrapper = mount(ChatComposer, { attachTo: document.body })
    // useDropZone attaches listeners via a watcher on the template ref; wait
    // one flush so the watcher has run before we dispatch.
    await flushPromises()
    return wrapper
  }

  it('dragenter shows the dropzone overlay; dragleave hides it', async () => {
    const wrapper = await mountReady()
    const file = new File(['x'], 'hover.txt', { type: 'text/plain' })
    expect(wrapper.find('[data-testid="composer-dropzone"]').exists()).toBe(false)
    fireDrag(wrapper.element, 'dragenter', buildDataTransfer([file]))
    await flushPromises()
    expect(wrapper.find('[data-testid="composer-dropzone"]').exists()).toBe(true)
    fireDrag(wrapper.element, 'dragleave', buildDataTransfer([file]))
    await flushPromises()
    expect(wrapper.find('[data-testid="composer-dropzone"]').exists()).toBe(false)
  })

  it('drop adds the file via the same path as the paperclip picker', async () => {
    const wrapper = await mountReady()
    const file = new File(['hi'], 'dropped.md', { type: 'text/markdown' })
    fireDrag(wrapper.element, 'dragenter', buildDataTransfer([file]))
    fireDrag(wrapper.element, 'drop', buildDataTransfer([file]))
    await flushPromises()

    expect(wrapper.find('[data-testid="composer-dropzone"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('dropped.md')

    await wrapper.find('textarea').setValue('send it')
    await wrapper.find('form').trigger('submit')
    const events = wrapper.emitted('send')
    expect(events).toHaveLength(1)
    const payload = events![0]![0] as { text: string; files: File[] }
    expect(payload.files).toHaveLength(1)
    expect(payload.files[0]!.name).toBe('dropped.md')
  })

  it('does not show the dropzone while a stream is active', async () => {
    const wrapper = mount(ChatComposer, {
      props: { streaming: true },
      attachTo: document.body,
    })
    await flushPromises()
    const file = new File(['x'], 'busy.txt', { type: 'text/plain' })
    fireDrag(wrapper.element, 'dragenter', buildDataTransfer([file]))
    await flushPromises()
    expect(wrapper.find('[data-testid="composer-dropzone"]').exists()).toBe(false)
  })
})
