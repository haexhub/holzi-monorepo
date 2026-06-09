import * as vscode from 'vscode'
import { HolziPanel } from './HolziPanel'

export function activate(context: vscode.ExtensionContext): void {
  const logger = vscode.window.createOutputChannel('Holzi')
  context.subscriptions.push(logger)

  context.subscriptions.push(
    vscode.commands.registerCommand('holzi.openChat', async () => {
      await HolziPanel.createOrShow(context, logger)
    }),
    vscode.commands.registerCommand('holzi.configure', async () => {
      const config = vscode.workspace.getConfiguration('holzi')
      const current = config.get<string>('host') ?? 'https://holzi.haex.cloud'
      const value = await vscode.window.showInputBox({
        title: 'Holzi: Configure Server',
        prompt: 'Enter Holzi server URL',
        value: current,
        validateInput: v => /^https?:\/\/.+/.test(v) ? null : 'Must start with http:// or https://',
      })
      if (value !== undefined) {
        await config.update('host', value.replace(/\/$/, ''), vscode.ConfigurationTarget.Global)
      }
    }),
    vscode.commands.registerCommand('holzi.login', async () => {
      const token = await vscode.window.showInputBox({
        title: 'Holzi: Sign In',
        prompt: 'Paste your Holzi API token',
        password: true,
      })
      if (token) {
        await context.secrets.store('holzi.token', token.trim())
      }
    }),
  )
}

export function deactivate(): void {}
