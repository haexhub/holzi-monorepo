import { describe, expect, it } from 'vitest'
import {
  resolveConfirm,
  useConfirm,
  useConfirmQueue,
} from '~/composables/useConfirm'

describe('useConfirm', () => {
  it('queues a request and resolves true when the action fires', async () => {
    const { confirm } = useConfirm()
    const queue = useConfirmQueue()
    const promise = confirm({ title: 'Delete?', destructive: true })

    expect(queue.value).toHaveLength(1)
    const request = queue.value[0]!
    expect(request.title).toBe('Delete?')
    expect(request.destructive).toBe(true)

    resolveConfirm(request.id, true)
    await expect(promise).resolves.toBe(true)
    expect(queue.value).toHaveLength(0)
  })

  it('resolves false on cancel', async () => {
    const { confirm } = useConfirm()
    const queue = useConfirmQueue()
    const promise = confirm({ title: 'Sure?' })
    resolveConfirm(queue.value[0]!.id, false)
    await expect(promise).resolves.toBe(false)
  })

  it('preserves FIFO order across concurrent confirms', async () => {
    const { confirm } = useConfirm()
    const queue = useConfirmQueue()
    const first = confirm({ title: 'A' })
    const second = confirm({ title: 'B' })

    expect(queue.value.map((r) => r.title)).toEqual(['A', 'B'])
    resolveConfirm(queue.value[0]!.id, true)
    resolveConfirm(queue.value[0]!.id, false)
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(false)
  })
})
