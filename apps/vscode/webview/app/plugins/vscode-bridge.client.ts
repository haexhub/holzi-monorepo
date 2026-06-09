// Singleton wrapper around vscode.acquireVsCodeApi() — VS Code requires
// exactly one call per webview lifetime. Centralize here and expose via
// $vscode for other plugins/composables to consume.

interface VsCodeApi {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi
  }
}

export default defineNuxtPlugin(() => {
  const api = window.acquireVsCodeApi?.() ?? null

  // Listener registry: multiple plugins/composables can subscribe.
  const listeners = new Set<(data: unknown) => void>()
  window.addEventListener('message', (e: MessageEvent) => {
    for (const fn of listeners) fn(e.data)
  })

  function post(msg: unknown) {
    api?.postMessage(msg)
  }

  function onMessage(handler: (data: unknown) => void): () => void {
    listeners.add(handler)
    return () => { listeners.delete(handler) }
  }

  return {
    provide: {
      vscode: {
        post,
        onMessage,
        available: api !== null,
      },
    },
  }
})
