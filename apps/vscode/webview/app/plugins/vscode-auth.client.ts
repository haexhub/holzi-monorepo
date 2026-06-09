// Webview auth bootstrap: on mount, ask the extension host for config
// (backend host + auth token), then seed the auth store. The extension
// reads these from VS Code config / secrets and posts back a single
// { type: 'config', host, token } message.

export default defineNuxtPlugin((nuxtApp) => {
  const { $vscode } = nuxtApp as { $vscode: { post: (m: unknown) => void; onMessage: (h: (d: unknown) => void) => () => void; available: boolean } }
  if (!$vscode.available) return

  const auth = useAuthStore()

  const off = $vscode.onMessage((msg: unknown) => {
    const m = msg as { type?: string; host?: string; token?: string }
    if (m?.type !== 'config') return
    if (typeof m.host === 'string') auth.setHost(m.host)
    if (typeof m.token === 'string') auth.setToken(m.token)
    off()  // one-shot config event; further updates can use a different message type
  })

  $vscode.post({ type: 'webview_ready' })
})
