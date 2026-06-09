import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// Plan 30 Task 5: AppConfirmHost now uses useI18n() in its script for the
// default Cancel / Delete / Confirm / OK labels, so the bare mount needs
// the i18n composable stubbed before the static import resolves.
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import AppConfirmHost from '~/components/AppConfirmHost.vue'
import { useConfirm } from '~/composables/useConfirm'
import { usePromptDialog } from '~/composables/usePromptDialog'

afterEach(() => {
  document.body.innerHTML = ''
})

function nextFrame() {
  return new Promise((r) => setTimeout(r, 0))
}

describe('AppConfirmHost.vue', () => {
  it('renders the confirm title + description and resolves true on action click', async () => {
    const wrapper = mount(AppConfirmHost, { attachTo: document.body })
    const { confirm } = useConfirm()
    const pending = confirm({
      title: 'Notiz löschen?',
      description: 'Das kann nicht rückgängig gemacht werden.',
      destructive: true,
    })

    await nextFrame()
    expect(document.body.textContent).toContain('Notiz löschen?')
    expect(document.body.textContent).toContain('Das kann nicht rückgängig')

    const action = document.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-action"]',
    )
    expect(action).not.toBeNull()
    action!.click()

    await expect(pending).resolves.toBe(true)
    wrapper.unmount()
  })

  it('resolves false on cancel click', async () => {
    const wrapper = mount(AppConfirmHost, { attachTo: document.body })
    const { confirm } = useConfirm()
    const pending = confirm({ title: 'Sicher?' })

    await nextFrame()
    const cancel = document.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-cancel"]',
    )
    expect(cancel).not.toBeNull()
    cancel!.click()

    await expect(pending).resolves.toBe(false)
    wrapper.unmount()
  })

  it('toggles the destructive variant on the action button', async () => {
    const wrapper = mount(AppConfirmHost, { attachTo: document.body })
    const { confirm } = useConfirm()
    void confirm({ title: 'Datei löschen', destructive: true })

    await nextFrame()
    const action = document.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-action"]',
    )
    expect(action?.className).toContain('bg-destructive')
    wrapper.unmount()
  })

  it('renders the prompt with default value and resolves the entered string', async () => {
    const wrapper = mount(AppConfirmHost, { attachTo: document.body })
    const { prompt } = usePromptDialog()
    const pending = prompt({
      title: 'Datei umbenennen',
      defaultValue: 'notes/old.md',
    })

    await nextFrame()
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="prompt-input"]',
    )
    expect(input).not.toBeNull()
    expect(input!.value).toBe('notes/old.md')

    input!.value = 'notes/new.md'
    input!.dispatchEvent(new Event('input', { bubbles: true }))

    const submit = document.querySelector<HTMLButtonElement>(
      '[data-testid="prompt-confirm"]',
    )
    submit!.click()

    await expect(pending).resolves.toBe('notes/new.md')
    wrapper.unmount()
  })

  it('resolves prompt with null on cancel', async () => {
    const wrapper = mount(AppConfirmHost, { attachTo: document.body })
    const { prompt } = usePromptDialog()
    const pending = prompt({ title: 'Anything?' })

    await nextFrame()
    const cancel = document.querySelector<HTMLButtonElement>(
      '[data-testid="prompt-cancel"]',
    )
    cancel!.click()

    await expect(pending).resolves.toBeNull()
    wrapper.unmount()
  })
})
