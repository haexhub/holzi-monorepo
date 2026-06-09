export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number
  resolve: (value: boolean) => void
}

// Single in-memory queue. The root-mounted <AppConfirmHost /> renders the
// first item; resolving it shifts to the next. Module-scoped so any call site
// (composable, page, child component) shares the same queue without prop drilling.
const queue = ref<ConfirmRequest[]>([])
let nextId = 0

export function useConfirmQueue() {
  return queue
}

export function resolveConfirm(id: number, value: boolean) {
  const idx = queue.value.findIndex((r) => r.id === id)
  if (idx === -1) return
  const [request] = queue.value.splice(idx, 1)
  request?.resolve(value)
}

export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      queue.value.push({ id: nextId++, ...options, resolve })
    })
  }
  return { confirm }
}
