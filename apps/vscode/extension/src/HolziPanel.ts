import * as vscode from 'vscode'
import { getToken, getHost } from './config'

const VIEW_TYPE = 'holziChat'

export class HolziPanel {
  private static current: HolziPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private readonly context: vscode.ExtensionContext
  private readonly logger: vscode.OutputChannel

  static async createOrShow(
    context: vscode.ExtensionContext,
    logger: vscode.OutputChannel,
  ): Promise<void> {
    if (HolziPanel.current) {
      HolziPanel.current.panel.reveal()
      return
    }
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One

    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Holzi', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
    })
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')

    HolziPanel.current = new HolziPanel(panel, context, logger)
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    logger: vscode.OutputChannel,
  ) {
    this.panel = panel
    this.context = context
    this.logger = logger

    this.panel.webview.html = this._buildHtml(context)
    this.panel.webview.onDidReceiveMessage((msg) => this._handleWebviewMessage(msg))
    this.panel.onDidDispose(() => {
      HolziPanel.current = undefined
    })
  }

  private async _handleWebviewMessage(msg: { type?: string }): Promise<void> {
    if (msg?.type === 'webview_ready') {
      const host = getHost() || 'https://holzi.haex.cloud'
      const token = await getToken(this.context)
      this.panel.webview.postMessage({ type: 'config', host, token })
      this.logger.appendLine(`[holzi] sent config (host=${host}, hasToken=${token.length > 0})`)
      return
    }
    this.logger.appendLine(`[holzi] unhandled webview message: ${JSON.stringify(msg)}`)
  }

  private _buildHtml(context: vscode.ExtensionContext): string {
    // Task 9 implements proper Nuxt-output rewriting with CSP + nonce + asWebviewUri.
    return `<!DOCTYPE html>
<html><head><title>Holzi</title></head>
<body><p>Webview HTML loader — Task 9 wires this up.</p></body>
</html>`
  }
}
