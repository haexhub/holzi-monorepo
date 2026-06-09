export interface PromptOptions {
  title: string
  description?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
}

export interface PromptRequest extends PromptOptions {
  id: number
  resolve: (value: string | null) => void
}

const queue = ref<PromptRequest[]>([])
let nextId = 0

export function usePromptQueue() {
  return queue
}

export function resolvePrompt(id: number, value: string | null) {
  const idx = queue.value.findIndex((r) => r.id === id)
  if (idx === -1) return
  const [request] = queue.value.splice(idx, 1)
  request?.resolve(value)
}

export function usePromptDialog() {
  function prompt(options: PromptOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      queue.value.push({ id: nextId++, ...options, resolve })
    })
  }
  return { prompt }
}
