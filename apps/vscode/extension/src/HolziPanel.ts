import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { getToken, getHost } from './config'

const VIEW_TYPE = 'holziChat'

export interface OpenOptions {
  conversationId?: number
  onFirstMessage?: () => void
}

export class HolziPanel {
  private static instances = new Set<HolziPanel>()
  private readonly panel: vscode.WebviewPanel
  private readonly context: vscode.ExtensionContext
  private readonly logger: vscode.OutputChannel
  private readonly onFirstMessage?: () => void
  private readonly pendingNavigateId?: number
  private currentConversationId: number | null = null

  static async createOrShow(
    context: vscode.ExtensionContext,
    logger: vscode.OutputChannel,
    options?: OpenOptions,
  ): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One

    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Holzi', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
    })
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')

    HolziPanel.instances.add(new HolziPanel(panel, context, logger, options))
  }

  /** Find an open tab currently showing the given conversation, if any. */
  static findByConversationId(id: number): HolziPanel | undefined {
    for (const inst of HolziPanel.instances) {
      if (inst.currentConversationId === id) return inst
    }
    return undefined
  }

  /** Bring this panel's tab to the foreground. */
  reveal(): void {
    this.panel.reveal()
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    logger: vscode.OutputChannel,
    options?: OpenOptions,
  ) {
    this.panel = panel
    this.context = context
    this.logger = logger
    this.onFirstMessage = options?.onFirstMessage
    this.pendingNavigateId = options?.conversationId
    this.currentConversationId = options?.conversationId ?? null

    this.panel.webview.html = this._buildHtml(context)
    this.panel.webview.onDidReceiveMessage((msg) => this._handleWebviewMessage(msg))
    this.panel.onDidDispose(() => {
      HolziPanel.instances.delete(this)
    })
  }

  private async _handleWebviewMessage(msg: { type?: string }): Promise<void> {
    if (msg?.type === 'webview_ready') {
      const host = getHost() || 'https://holzi.haex.cloud'
      const token = await getToken(this.context)
      this.panel.webview.postMessage({ type: 'config', host, token })
      this.logger.appendLine(`[holzi] sent config (host=${host}, hasToken=${token.length > 0})`)
      if (this.pendingNavigateId !== undefined) {
        this.panel.webview.postMessage({ type: 'navigate', path: `/chat/${this.pendingNavigateId}` })
      }
      return
    }
    if (msg?.type === 'conversation_id') {
      const id = (msg as { id?: unknown }).id
      this.currentConversationId = typeof id === 'number' ? id : null
      return
    }
    if (msg?.type === 'set_title' && typeof (msg as { title?: unknown }).title === 'string') {
      this.panel.title = (msg as { title: string }).title
      this.onFirstMessage?.()
      return
    }
    this.logger.appendLine(`[holzi] unhandled webview message: ${JSON.stringify(msg)}`)
  }

  private _buildHtml(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview

    // Random nonce per panel load — required for CSP script-src
    const nonce = Array.from({ length: 32 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)],
    ).join('')

    const htmlPath = path.join(context.extensionPath, 'out', 'webview', 'index.html')
    let html = fs.readFileSync(htmlPath, 'utf-8')

    // Rewrite any URL that points into the static asset dir to a webview URI.
    // Nuxt may emit absolute (/_nuxt/...) or relative (./_nuxt/...) paths
    // depending on app.baseURL.
    html = html.replace(/(src|href)="(\.?\/_nuxt\/[^"]+)"/g, (_match, attr, raw: string) => {
      const file = raw.replace(/^\.?\//, '')
      const parts = file.split('/')
      const uri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', ...parts),
      )
      return `${attr}="${uri}"`
    })

    // Add nonce to all <script> tags
    html = html.replace(/<script(\s|>)/g, `<script nonce="${nonce}"$1`)

    // Add nonce to <link rel="modulepreload"> — CSP checks these against
    // script-src, and our policy has no host source (nonce-only).
    html = html.replace(/<link\s+([^>]*\brel="modulepreload"[^>]*)>/g, `<link nonce="${nonce}" $1>`)

    // CSP — strip any existing CSP meta, then inject ours
    html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, '')

    // connect-src is intentionally permissive (https: wss:) because the host
    // is only known after the webview receives its config from the extension.
    // If stricter policy is needed later, we can rebuild HTML on config change.
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' 'strict-dynamic'`,
      `font-src ${webview.cspSource} data:`,
      `img-src ${webview.cspSource} data: https:`,
      `connect-src https: wss:`,
    ].join('; ')

    html = html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`)

    return html
  }
}
