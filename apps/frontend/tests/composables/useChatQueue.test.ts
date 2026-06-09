import { describe, expect, it } from 'vitest'
import { useChatQueue } from '~/composables/useChatQueue'

describe('useChatQueue', () => {
  it('starts empty', () => {
    const queue = useChatQueue()
    expect(queue.items.value).toEqual([])
    expect(queue.isEmpty.value).toBe(true)
  })

  it('enqueues messages and keeps them visible in FIFO order', () => {
    const queue = useChatQueue()
    queue.enqueue('first')
    queue.enqueue('second')
    queue.enqueue('third')
    expect(queue.items.value.map((i) => i.content)).toEqual([
      'first',
      'second',
      'third',
    ])
    expect(queue.isEmpty.value).toBe(false)
  })

  it('assigns each queued message a unique, stable id', () => {
    const queue = useChatQueue()
    const a = queue.enqueue('a')
    const b = queue.enqueue('b')
    expect(a.id).not.toBe(b.id)
    // ids survive a dequeue of an unrelated item
    expect(queue.items.value.find((i) => i.id === b.id)?.content).toBe('b')
  })

  it('dequeues in FIFO order — the first enqueued is sent first', () => {
    const queue = useChatQueue()
    queue.enqueue('one')
    queue.enqueue('two')
    expect(queue.dequeue()?.content).toBe('one')
    expect(queue.dequeue()?.content).toBe('two')
    expect(queue.dequeue()).toBeUndefined()
    expect(queue.isEmpty.value).toBe(true)
  })

  it('clear() drops every pending message at once', () => {
    const queue = useChatQueue()
    queue.enqueue('x')
    queue.enqueue('y')
    queue.clear()
    expect(queue.items.value).toEqual([])
    expect(queue.isEmpty.value).toBe(true)
  })
})
