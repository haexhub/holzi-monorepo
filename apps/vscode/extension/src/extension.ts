import * as vscode from 'vscode'
import { HolziPanel } from './HolziPanel'
import { SessionsProvider, type SessionItem } from './SessionsProvider'
import { deleteConversation } from './api'
import { getToken } from './config'

export function activate(context: vscode.ExtensionContext): void {
  const logger = vscode.window.createOutputChannel('Holzi')
  context.subscriptions.push(logger)

  const sessionsProvider = new SessionsProvider(context, logger)
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('holzi.sessions', sessionsProvider),
  )

  // Keep the `holzi.authenticated` when-context in sync with the stored token.
  async function syncAuthContext(): Promise<void> {
    const token = await getToken(context)
    await vscode.commands.executeCommand('setContext', 'holzi.authenticated', token.length > 0)
    sessionsProvider.refresh()
  }
  void syncAuthContext()
  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === 'holzi.token') void syncAuthContext()
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('holzi.openChat', async () => {
      await HolziPanel.createOrShow(context, logger, {
        onFirstMessage: () => sessionsProvider.refresh(),
      })
    }),
    vscode.commands.registerCommand('holzi.openSession', async (id: number) => {
      const existing = HolziPanel.findByConversationId(id)
      if (existing) {
        existing.reveal()
        return
      }
      await HolziPanel.createOrShow(context, logger, {
        conversationId: id,
        onFirstMessage: () => sessionsProvider.refresh(),
      })
    }),
    vscode.commands.registerCommand('holzi.refreshSessions', () => {
      sessionsProvider.refresh()
    }),
    vscode.commands.registerCommand('holzi.deleteSession', async (item: SessionItem) => {
      const confirm = await vscode.window.showWarningMessage(
        `Delete "${String(item.label)}"?`,
        { modal: true },
        'Delete',
      )
      if (confirm !== 'Delete') return
      try {
        await deleteConversation(context, item.sessionId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.appendLine(`[holzi] delete failed: ${msg}`)
        vscode.window.showErrorMessage(`Holzi: could not delete session (${msg})`)
        return
      }
      sessionsProvider.refresh()
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
    vscode.commands.registerCommand('holzi.settings', async () => {
      const token = await getToken(context)
      const pick = await vscode.window.showQuickPick(
        [
          { label: '$(server) Configure Server', command: 'holzi.configure' },
          {
            label: token.length > 0 ? '$(key) Change Token' : '$(key) Sign In',
            command: 'holzi.login',
          },
        ],
        { title: 'Holzi: Settings', placeHolder: 'Choose what to configure' },
      )
      if (pick) await vscode.commands.executeCommand(pick.command)
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
