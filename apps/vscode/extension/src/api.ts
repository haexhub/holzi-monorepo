import * as vscode from 'vscode'
import { getHost, getToken } from './config'

/** Subset of the backend's ConversationSummaryResponse the sidebar needs. */
export interface ConversationSummary {
  id: number
  title: string | null
  updated_at: number
}

/** Error carrying the HTTP status so callers can branch on 401. */
export class HolziHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'HolziHttpError'
  }
}

async function authedFetch(
  context: vscode.ExtensionContext,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const host = getHost() || 'https://holzi.haex.cloud'
  const token = await getToken(context)
  return fetch(`${host}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
}

export async function listConversations(
  context: vscode.ExtensionContext,
): Promise<ConversationSummary[]> {
  const res = await authedFetch(context, '/api/conversations')
  if (!res.ok) {
    throw new HolziHttpError(`listConversations failed: ${res.status}`, res.status)
  }
  return (await res.json()) as ConversationSummary[]
}

export async function deleteConversation(
  context: vscode.ExtensionContext,
  id: number,
): Promise<void> {
  const res = await authedFetch(context, `/api/conversations/${id}`, { method: 'DELETE' })
  // 404 is fine — the conversation is already gone, which is the desired state.
  if (!res.ok && res.status !== 404) {
    throw new HolziHttpError(`deleteConversation failed: ${res.status}`, res.status)
  }
}
