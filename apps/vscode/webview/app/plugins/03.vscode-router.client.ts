// VS Code router bridge: lets the extension host deep-link this webview to a
// conversation (host → { type: 'navigate', path }) and keeps the host informed
// of which conversation this tab is showing (webview → { type: 'conversation_id',
// id }) so it can focus an existing tab instead of opening a duplicate.

export default defineNuxtPlugin((nuxtApp) => {
  const { $vscode } = nuxtApp as {
    $vscode: {
      post: (m: unknown) => void
      onMessage: (h: (d: unknown) => void) => () => void
      available: boolean
    }
  }
  if (!$vscode.available) return

  const router = useRouter()

  // host → webview: navigate to a path (e.g. /chat/123)
  $vscode.onMessage((msg: unknown) => {
    const m = msg as { type?: string; path?: string }
    if (m?.type === 'navigate' && typeof m.path === 'string') {
      router.replace(m.path)
    }
  })

  // webview → host: report the conversation id (or null) on every route change
  function report(path: string) {
    const match = path.match(/\/chat\/(\d+)/)
    $vscode.post({ type: 'conversation_id', id: match ? Number(match[1]) : null })
  }
  router.afterEach((to) => report(to.path))
  // Initial report so the host's state matches the webview's even when no
  // navigation event fires (e.g. fresh load on `/`).
  report(router.currentRoute.value.path)
})
