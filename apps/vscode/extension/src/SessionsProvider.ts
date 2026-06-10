import * as vscode from 'vscode'
import { listConversations, HolziHttpError, type ConversationSummary } from './api'

/** Pure: unix-seconds timestamp → short relative label (now, 9m, 2h, 3d, …). */
export function formatRelative(unixSeconds: number): string {
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds))
  if (sec < 60) return 'now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(day / 365)}y`
}

export class SessionItem extends vscode.TreeItem {
  constructor(readonly sessionId: number, label: string, description: string) {
    super(label, vscode.TreeItemCollapsibleState.None)
    this.description = description
    this.contextValue = 'session'
    this.command = {
      command: 'holzi.openSession',
      title: 'Open Session',
      arguments: [sessionId],
    }
  }
}

export class SessionsProvider implements vscode.TreeDataProvider<SessionItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private cache: ConversationSummary[] | null = null

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: vscode.OutputChannel,
  ) {}

  /** Drop the cache and re-render (triggers a re-fetch on next getChildren). */
  refresh(): void {
    this.cache = null
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(item: SessionItem): vscode.TreeItem {
    return item
  }

  async getChildren(): Promise<SessionItem[]> {
    if (this.cache === null) {
      try {
        this.cache = await listConversations(this.context)
        await vscode.commands.executeCommand(
          'setContext', 'holzi.sessionsEmpty', this.cache.length === 0,
        )
      } catch (err) {
        if (err instanceof HolziHttpError && err.status === 401) {
          await vscode.commands.executeCommand('setContext', 'holzi.authenticated', false)
        } else {
          const msg = err instanceof Error ? err.message : String(err)
          this.logger.appendLine(`[holzi] sessions fetch failed: ${msg}`)
          vscode.window.showErrorMessage(`Holzi: could not load sessions (${msg})`)
          // Trigger the "No sessions yet" welcome view so the user sees the
          // [New session] action instead of a silently empty tree. The error
          // toast above conveys what actually went wrong.
          await vscode.commands.executeCommand('setContext', 'holzi.sessionsEmpty', true)
        }
        this.cache = []
        return []
      }
    }
    return [...this.cache]
      .sort((a, b) => b.updated_at - a.updated_at)
      .map((c) => new SessionItem(c.id, c.title || 'Untitled', formatRelative(c.updated_at)))
  }
}
