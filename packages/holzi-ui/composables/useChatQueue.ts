
/**
 * A message the user submitted while a turn was still streaming. It is held
 * locally and rendered as a pending user bubble until the active stream
 * finishes cleanly, at which point the page shifts it off and sends it.
 */
export interface QueuedMessage {
  /** Local-only id, stable for the lifetime of the queue entry. */
  id: number
  content: string
  /** Files picked alongside this follow-up, uploaded when it is sent. */
  files: File[]
}

/**
 * Visible, in-memory FIFO queue for messages typed during an active stream.
 *
 * Order matters: the user expects their follow-ups to be sent in the order
 * they pressed Enter, so this is a strict first-in-first-out queue. It holds
 * no transport logic — the page owns when to `dequeue()` and actually send.
 */
export function useChatQueue() {
  const items = ref<QueuedMessage[]>([])
  let seq = 0

  function enqueue(content: string, files: File[] = []): QueuedMessage {
    const item: QueuedMessage = { id: ++seq, content, files }
    items.value = [...items.value, item]
    return item
  }

  /** Remove and return the oldest pending message, or undefined if empty. */
  function dequeue(): QueuedMessage | undefined {
    const [first, ...rest] = items.value
    items.value = rest
    return first
  }

  function clear() {
    items.value = []
  }

  const isEmpty = computed(() => items.value.length === 0)

  return { items, enqueue, dequeue, clear, isEmpty }
}
