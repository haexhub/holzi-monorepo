import { useAuthStore } from '~/stores/auth'
import type {
  ApprovalRequiredData,
  ReasoningData,
  SandboxCrashedData,
  SubagentDoneData,
  SubagentStartData,
  SubagentTextData,
  ToolCallData,
  ToolResultData,
} from '~/types/api'

/**
 * Subscribe to /api/chat's SSE stream.
 *
 * Every event shares one versioned envelope `{ event, version, data }` (the
 * single source of truth lives in the backend's `src/hermes/events.py` and the
 * generated `ChatStreamEnvelope` type). The SSE `event:` line mirrors the
 * envelope's `event`, so we switch on it and read the payload from `.data`:
 *   - `session`     → { conversation_id: number }
 *   - `run`         → { run_id: string }     (handle for cancelChatRun)
 *   - `text`        → { content: string }    (assistant delta)
 *   - `tool_call`   → { call_id, name, arguments, status:"running" }
 *   - `tool_result` → { call_id, status:"success"|"error", result, error }
 *   - `approval_required` → { approval_id, call_id, name, arguments, reason }
 *                      (non-terminal — stream stays open until the user
 *                       resolves it via resolveApproval)
 *   - `reasoning`   → { content: string }    (thinking delta; concatenated)
 *   - `subagent_start` → { subagent_id, name, prompt? }
 *   - `subagent_text`  → { subagent_id, content }   (subagent output delta)
 *   - `subagent_done`  → { subagent_id, status, result?, error? }
 *   - `sandbox_crashed` → { workspace_id, sandbox_id, state, exit_code? }
 *                      (non-terminal — surfaced by the health watcher so the
 *                       UI can offer a Restart; the stream continues)
 *   - `cancelled`   → {}                     (terminal — user clicked Stop)
 *   - `done`        → {}                     (terminal — turn finished cleanly)
 * Plus on failure:
 *   - `error`       → { code, status_code, message }
 *
 * Forward compatibility: an envelope whose `event` we don't recognise is
 * ignored (falls through the switch) so a newer backend can add event types
 * without breaking older clients.
 *
 * Returns the conversation_id, run_id, assembled text, and a `cancelled`
 * flag. `cancelled` is terminal: any events after it on the wire are
 * ignored, so callers can rely on the result reflecting state at the
 * moment of cancellation.
 */
export interface ChatStreamResult {
  conversationId: number
  runId: string | null
  text: string
  cancelled: boolean
}

/**
 * Lifecycle of a chat turn, as tracked by the page driving the stream:
 *   - `idle`         → no turn in flight; composer sends normally
 *   - `streaming`    → a turn is in flight; new sends are queued
 *   - `failed`       → the stream dropped/errored; queued messages are kept
 *   - `cancelled`    → the user stopped the turn via the Stop button
 *   - `reconnecting` → reserved for a future SSE resume protocol. There is
 *                      no transition into it yet: resuming a partial stream
 *                      needs server-side event buffering + Last-Event-ID,
 *                      which is out of scope here. Kept in the union so the
 *                      state set is stable when that lands.
 */
export type StreamState =
  | 'idle'
  | 'streaming'
  | 'reconnecting'
  | 'failed'
  | 'cancelled'

export interface ChatStreamCallbacks {
  onSession?: (conversationId: number) => void
  onRun?: (runId: string) => void
  onText?: (chunk: string) => void
  // A tool started running. Fired before the tool executes so a card can be
  // shown in its `running` state.
  onToolCall?: (call: ToolCallData) => void
  // A tool finished. `status` flips the matching card to success/error.
  onToolResult?: (result: ToolResultData) => void
  // A risky tool is paused awaiting the user's decision. Fired so the page can
  // render an approval card; the stream keeps running (heartbeats only) until
  // resolveApproval() delivers the verdict.
  onApproval?: (approval: ApprovalRequiredData) => void
  // A reasoning/"thinking" delta. Concatenated into the turn's reasoning card.
  onReasoning?: (chunk: string) => void
  // Subagent activity, grouped by subagent_id. Holzi doesn't emit these yet
  // (no orchestration); wired so the cards render the moment a future
  // orchestrator does.
  onSubagentStart?: (start: SubagentStartData) => void
  onSubagentText?: (text: SubagentTextData) => void
  onSubagentDone?: (done: SubagentDoneData) => void
  // The agent's health watcher detected a workspace sandbox crash. Surface-
  // only: the agent does not auto-restart, the UI renders a card with a
  // Restart button. Non-terminal — the stream keeps going.
  onSandboxCrashed?: (crash: SandboxCrashedData) => void
  signal?: AbortSignal
}

/**
 * Codes emitted by `_classify_chat_error` in `src/hermes/routes/api.py`.
 * Kept loose (`string`) so an unknown future code falls through to a
 * generic message instead of breaking the build.
 */
export type ChatStreamErrorCode =
  | 'upstream_http_error'
  | 'upstream_rate_limited'
  | 'upstream_timeout'
  | 'upstream_unreachable'
  | 'agent_error'
  | (string & {})

export class ChatStreamError extends Error {
  readonly code: ChatStreamErrorCode
  readonly statusCode: number | null

  constructor(message: string, opts: { code?: ChatStreamErrorCode; statusCode?: number | null } = {}) {
    super(message)
    this.name = 'ChatStreamError'
    this.code = opts.code ?? 'unknown'
    this.statusCode = opts.statusCode ?? null
  }
}

export async function sendChatMessage(
  payload: {
    message: string
    conversation_id?: number
    // Ids of files already uploaded to this conversation (Plan 11). The
    // backend links them to the user message and inlines text content.
    attachment_ids?: number[]
    // One-turn overrides. Not persisted. Cleared after the agent run.
    model_override?: string
    persona_id_override?: number
    thinking_budget?: 'low' | 'medium' | 'high'
    skill_hints?: string[]
  },
  callbacks: ChatStreamCallbacks = {},
): Promise<ChatStreamResult> {
  return postChatStream('/api/chat', payload, callbacks)
}

/**
 * Regenerate the latest assistant response in a conversation.
 *
 * Hits `POST /api/conversations/{id}/retry`, which drops the trailing
 * assistant/tool turns and re-runs the agent. The response uses the exact
 * same SSE contract as /api/chat, so it streams through the same consumer
 * and returns the same shape — callers reuse their normal-send state.
 */
export async function retryLastResponse(
  conversationId: number,
  callbacks: ChatStreamCallbacks = {},
): Promise<ChatStreamResult> {
  return postChatStream(
    `/api/conversations/${encodeURIComponent(conversationId)}/retry`,
    null,
    callbacks,
  )
}

/**
 * Edit a previous user message and regenerate the conversation from it.
 *
 * Hits `POST /api/conversations/{id}/messages/{messageId}/edit-and-regenerate`,
 * which rewrites the user message in place, drops every later turn, and
 * re-runs the agent over the corrected context. The response uses the exact
 * same SSE contract as /api/chat, so it streams through the same consumer
 * and returns the same shape.
 */
export async function editAndRegenerate(
  conversationId: number,
  messageId: number,
  content: string,
  callbacks: ChatStreamCallbacks = {},
): Promise<ChatStreamResult> {
  return postChatStream(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/edit-and-regenerate`,
    { content },
    callbacks,
  )
}

async function postChatStream(
  url: string,
  body: Record<string, unknown> | null,
  callbacks: ChatStreamCallbacks,
): Promise<ChatStreamResult> {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    throw new Error('not authenticated')
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
    signal: callbacks.signal,
  })

  if (response.status === 401) {
    auth.clear()
    throw new ChatStreamError('unauthorized', {
      code: 'unauthorized',
      statusCode: 401,
    })
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new ChatStreamError(
      `chat request failed: ${response.status} ${detail}`,
      { code: 'request_failed', statusCode: response.status },
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let conversationId: number | null = null
  let runId: string | null = null
  let assistantText = ''
  let cancelled = false
  let streamError: ChatStreamError | null = null

  outer: while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE blocks are separated by a blank line.
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const { event, data } = parseSseBlock(block)
      if (!event) continue
      // Every block is an envelope `{ event, version, data }`; the payload we
      // care about is `.data`. (`event` here is the mirrored SSE event line.)
      const payload = (data as { data?: unknown }).data ?? {}
      switch (event) {
        case 'session': {
          conversationId = (payload as { conversation_id?: number }).conversation_id ?? null
          if (conversationId !== null) {
            callbacks.onSession?.(conversationId)
          }
          break
        }
        case 'run': {
          runId = (payload as { run_id?: string }).run_id ?? null
          if (runId !== null) {
            callbacks.onRun?.(runId)
          }
          break
        }
        case 'text': {
          const chunk = (payload as { content?: string }).content ?? ''
          assistantText += chunk
          callbacks.onText?.(chunk)
          break
        }
        case 'tool_call': {
          callbacks.onToolCall?.(payload as ToolCallData)
          break
        }
        case 'tool_result': {
          callbacks.onToolResult?.(payload as ToolResultData)
          break
        }
        case 'approval_required': {
          callbacks.onApproval?.(payload as ApprovalRequiredData)
          break
        }
        case 'reasoning': {
          const chunk = (payload as { content?: string }).content ?? ''
          callbacks.onReasoning?.(chunk)
          break
        }
        case 'subagent_start': {
          callbacks.onSubagentStart?.(payload as SubagentStartData)
          break
        }
        case 'subagent_text': {
          callbacks.onSubagentText?.(payload as SubagentTextData)
          break
        }
        case 'subagent_done': {
          callbacks.onSubagentDone?.(payload as SubagentDoneData)
          break
        }
        case 'sandbox_crashed': {
          callbacks.onSandboxCrashed?.(payload as SandboxCrashedData)
          break
        }
        case 'cancelled':
          // Terminal: stop reading and let the caller render the turn
          // as aborted. Discard anything still in the buffer — the
          // backend contract is that `cancelled` is the last event.
          cancelled = true
          break outer
        case 'done':
          break
        case 'error': {
          const errData = payload as {
            code?: ChatStreamErrorCode
            status_code?: number
            message?: string
          }
          streamError = new ChatStreamError(
            errData.message ?? 'unknown agent error',
            { code: errData.code, statusCode: errData.status_code ?? null },
          )
          // Terminal: stop reading and let the caller surface the failure.
          // The backend contract is that `error` is the last event, so we
          // discard anything still buffered rather than risk rendering a
          // post-error delta as a successful turn.
          break outer
        }
      }
    }
  }

  if (streamError) {
    throw streamError
  }
  if (conversationId === null) {
    throw new ChatStreamError('chat stream ended without a session event')
  }
  return { conversationId, runId, text: assistantText, cancelled }
}


/**
 * Best-effort cancel of an in-flight chat run.
 *
 * Resolves on 204 (cancel delivered) or 404 (run already finished, which
 * is a normal race when the user clicks Stop right as the stream ends).
 * Throws on other failures so the caller can surface a real problem.
 */
export async function cancelChatRun(runId: string): Promise<void> {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    throw new ChatStreamError('unauthorized', {
      code: 'unauthorized',
      statusCode: 401,
    })
  }
  const response = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  })
  // 401 mid-stream means the token expired while the user was typing —
  // clear it so the next action redirects to /login, and surface the
  // same `unauthorized` code as sendChatMessage so friendlyChatError
  // shows the session-expired copy.
  if (response.status === 401) {
    auth.clear()
    throw new ChatStreamError('unauthorized', {
      code: 'unauthorized',
      statusCode: 401,
    })
  }
  if (response.status === 204 || response.status === 404) {
    return
  }
  const detail = await response.text().catch(() => '')
  throw new ChatStreamError(
    `cancel failed: ${response.status} ${detail}`,
    { code: 'request_failed', statusCode: response.status },
  )
}

export type ApprovalDecision =
  | 'allow_once'
  | 'allow_session'
  | 'allow_always'
  | 'deny'

/**
 * Deliver the user's decision for a paused, approval-gated tool call.
 *
 * POSTs to `/api/approvals/{approval_id}`, which resolves the future the
 * backend agent is awaiting. Plan 21 extended the protocol from two to
 * four decisions: `allow_once` runs the tool once and re-asks next time;
 * `allow_session` adds it to the per-conversation standing list (cached
 * on `app.state.session_approvals`); `allow_always` upserts the
 * `tool_approvals` DB row so the grant survives a restart; `deny`
 * refuses with the optional `reason` text appended to the tool error
 * the model sees.
 *
 * Resolves on 204 (delivered) and on 404/409 (the approval is already gone or
 * already decided — a normal double-submit / stale-tab race, treated as a
 * no-op). Throws on other failures so the caller can surface a real problem.
 */
export async function resolveApproval(
  approvalId: string,
  decision: ApprovalDecision,
  reason?: string,
): Promise<void> {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    throw new ChatStreamError('unauthorized', {
      code: 'unauthorized',
      statusCode: 401,
    })
  }
  const response = await fetch(
    `/api/approvals/${encodeURIComponent(approvalId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(reason != null ? { decision, reason } : { decision }),
    },
  )
  if (response.status === 401) {
    auth.clear()
    throw new ChatStreamError('unauthorized', {
      code: 'unauthorized',
      statusCode: 401,
    })
  }
  // 404: unknown/expired id. 409: already resolved. Both mean "nothing left to
  // do" from the user's perspective, so don't surface them as errors.
  if (response.status === 204 || response.status === 404 || response.status === 409) {
    return
  }
  const detail = await response.text().catch(() => '')
  throw new ChatStreamError(
    `approval failed: ${response.status} ${detail}`,
    { code: 'request_failed', statusCode: response.status },
  )
}

/**
 * Render a ChatStreamError via the i18n `errors.chat.<code>` namespace.
 *
 * ChatStreamError codes are a different domain from the backend's
 * `ErrorCode` enum (these are client-side stream-protocol failures, not
 * HTTPException details), so they live under their own sub-tree to keep
 * the two namespaces decoupled. Pass the `$t` function in so the caller
 * controls the i18n context — composables can use `useI18n()`, plain
 * helpers can not. Anything that isn't a ChatStreamError is treated as
 * a generic chat error (we deliberately don't leak `err.message` because
 * it can carry raw upstream text).
 */
export type ChatErrorTranslateFn = (
  key: string,
  params?: Record<string, unknown>,
) => string

const KNOWN_CHAT_CODES = new Set([
  'upstream_unreachable',
  'upstream_timeout',
  'upstream_http_error',
  'upstream_rate_limited',
  'agent_error',
  'unauthorized',
  'request_failed',
])

export function friendlyChatError(
  err: unknown,
  t: ChatErrorTranslateFn,
): string {
  if (!(err instanceof ChatStreamError) || !KNOWN_CHAT_CODES.has(err.code)) {
    return t('errors.chat.unknown')
  }
  const statusSuffix = err.statusCode ? ` (${err.statusCode})` : ''
  return t(`errors.chat.${err.code}`, {
    message: err.message,
    statusSuffix,
  })
}

function parseSseBlock(block: string): { event: string | null; data: unknown } {
  let event: string | null = null
  const dataLines: string[] = []
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim())
    }
  }
  if (!event || dataLines.length === 0) return { event, data: {} }
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return { event, data: {} }
  }
}
