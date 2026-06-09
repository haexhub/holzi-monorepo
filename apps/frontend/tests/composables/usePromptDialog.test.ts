import { describe, expect, it } from 'vitest'
import {
  resolvePrompt,
  usePromptDialog,
  usePromptQueue,
} from '~/composables/usePromptDialog'

describe('usePromptDialog', () => {
  it('queues a request and resolves with the entered string', async () => {
    const { prompt } = usePromptDialog()
    const queue = usePromptQueue()
    const promise = prompt({ title: 'Rename', defaultValue: 'old.md' })

    expect(queue.value).toHaveLength(1)
    expect(queue.value[0]!.defaultValue).toBe('old.md')

    resolvePrompt(queue.value[0]!.id, 'new.md')
    await expect(promise).resolves.toBe('new.md')
    expect(queue.value).toHaveLength(0)
  })

  it('resolves null on cancel', async () => {
    const { prompt } = usePromptDialog()
    const queue = usePromptQueue()
    const promise = prompt({ title: 'Type a thing' })
    resolvePrompt(queue.value[0]!.id, null)
    await expect(promise).resolves.toBeNull()
  })
})
