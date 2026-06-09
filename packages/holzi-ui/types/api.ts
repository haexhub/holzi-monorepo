/**
 * Public type surface used across the app — every shape now comes from the
 * auto-generated `api-generated.ts`. Regenerate with `pnpm run gen:api` after
 * the backend's `/openapi.json` changes.
 */
import type { components } from './api-generated'

// --- Request bodies -----------------------------------------------------
export type NoteCreate = components['schemas']['NoteCreate']
export type NoteUpdate = components['schemas']['NoteUpdate']
export type ValidationError = components['schemas']['HTTPValidationError']

// --- Response bodies ----------------------------------------------------
export type Conversation = components['schemas']['ConversationSummaryResponse']
export type Message = components['schemas']['MessageResponse']
export type ConversationDetail = components['schemas']['ConversationDetailResponse']
export type Attachment = components['schemas']['AttachmentResponse']
export type Note = components['schemas']['NoteResponse']

// --- Agent runs (Plan 03b — surfaced on Diagnostics in Plan 20) ---------
export type AgentRun = components['schemas']['AgentRunResponse']

// --- Diagnostics (Plan 20) ----------------------------------------------
export type DiagnosticsCheck = components['schemas']['DiagnosticsCheck']
export type DiagnosticsResponse = components['schemas']['DiagnosticsResponse']
export type DiagnosticsStatus = DiagnosticsCheck['status']

// --- Insights + Logs (Plan 27) ------------------------------------------
export type InsightsResponse = components['schemas']['InsightsResponse']
export type InsightsPeriod = InsightsResponse['period']
export type InsightsTotals = components['schemas']['TotalsResponse']
export type InsightsDailyBucket = components['schemas']['DailyBucket']
export type InsightsModelBreakdown = components['schemas']['ModelBreakdown']
export type InsightsStatusCounts = components['schemas']['StatusCounts']
export type LogsResponse = components['schemas']['LogsResponse']
// A single tailed structlog row. Untyped on the backend (it's whatever
// structlog wrote), but always at least carries an optional `level` and
// `event`, plus `_raw` when the line failed to parse as JSON.
export type LogRow = LogsResponse['rows'][number]

// --- Sandbox crashes (Plan 20-A) ----------------------------------------
// Persistent crash log; backs the third section on /settings/diagnostics so
// a workspace dying with no chat connected still surfaces after the fact.
export type SandboxCrash = components['schemas']['SandboxCrashResponse']
export type SandboxCrashState = SandboxCrash['state']

// --- Agent tasks (Plan 16) ----------------------------------------------
export type AgentTask = components['schemas']['TaskResponse']
export type AgentTaskCreate = components['schemas']['TaskCreate']
export type AgentTaskUpdate = components['schemas']['TaskUpdate']
export type AgentTaskRunResponse = components['schemas']['TaskRunResponse']

// --- Sandbox status (Plan 11b-b) ----------------------------------------
// `GET /api/workspaces/{id}/sandbox` + `POST .../sandbox/restart` —
// the workspaces page calls restart on demand.
export type SandboxStatusResponse = components['schemas']['SandboxStatusResponse']

// --- Workspaces CRUD (Plan 25) ------------------------------------------
// Workspaces are now first-class managed objects. The list response joins
// each row with its live sandbox / disk / git snapshot so the panel renders
// in one round-trip.
export type Workspace = components['schemas']['WorkspaceResponse']
export type WorkspaceSandbox = components['schemas']['WorkspaceSandbox']
export type WorkspaceDisk = components['schemas']['WorkspaceDisk']
export type WorkspaceGit = components['schemas']['WorkspaceGit']
export type WorkspaceCreate = components['schemas']['WorkspaceCreate']
export type WorkspaceRename = components['schemas']['WorkspaceRename']
export type WorkspaceDiskResponse = components['schemas']['WorkspaceDiskResponse']
export type WorkspaceSandboxState = WorkspaceSandbox['state']

// --- Workspace browser (Plan 12) ----------------------------------------
export type WorkspaceRoot = components['schemas']['WorkspaceRoot']
export type WorkspaceRootsResponse = components['schemas']['WorkspaceRootsResponse']
export type WorkspaceTreeResponse = components['schemas']['WorkspaceTreeResponse']
export type WorkspaceFileResponse = components['schemas']['WorkspaceFileResponse']
export type TreeEntry = components['schemas']['TreeEntry']

// --- Workspace write + git (Plan 13) ------------------------------------
export type WorkspaceCreateRequest = components['schemas']['WorkspaceCreateRequest']
export type WorkspaceUpdateRequest = components['schemas']['WorkspaceUpdateRequest']
export type WorkspaceRenameRequest = components['schemas']['WorkspaceRenameRequest']
export type WorkspaceDeleteRequest = components['schemas']['WorkspaceDeleteRequest']
export type WorkspaceWriteResponse = components['schemas']['WorkspaceWriteResponse']
export type WorkspaceRenameResponse = components['schemas']['WorkspaceRenameResponse']
export type WorkspaceGitResponse = components['schemas']['WorkspaceGitResponse']
export type GitEntry = components['schemas']['GitEntry']

// --- Workspace git extended (Plan 24) -----------------------------------
export type GitDiffResponse = components['schemas']['GitDiffResponse']
export type GitDiffSummary = components['schemas']['GitDiffSummary']
export type GitBranch = components['schemas']['GitBranch']
export type GitBranchesResponse = components['schemas']['GitBranchesResponse']
export type GitLogEntry = components['schemas']['GitLogEntry']
export type GitCheckoutRequest = components['schemas']['GitCheckoutRequest']
export type GitPathsRequest = components['schemas']['GitPathsRequest']
export type GitDiscardRequest = components['schemas']['GitDiscardRequest']
export type GitCommitRequest = components['schemas']['GitCommitRequest']
export type GitFetchRequest = components['schemas']['GitFetchRequest']
export type GitPullRequest = components['schemas']['GitPullRequest']
export type GitPushRequest = components['schemas']['GitPushRequest']
export type GitOpResponse = components['schemas']['GitOpResponse']
export type GitPullResponse = components['schemas']['GitPullResponse']

// --- Tool inventory + MCP surface (Plan 31) -----------------------------
// `/settings/skills` reads `GET /api/tools` for the flat alphabetical
// catalog and `GET /api/mcp/health` for the streamable-HTTP surface card.
export type ToolInfo = components['schemas']['ToolInfo']
export type ToolsResponse = components['schemas']['ToolsResponse']
export type McpHealthResponse = components['schemas']['McpHealthResponse']
export type McpHealthStatus = McpHealthResponse['status']

// --- Preferences: personas + channel prompts (Plan 29-A) ----------------
export type Persona = components['schemas']['PersonaResponse']
export type PersonaListResponse = components['schemas']['PersonaListResponse']
export type PersonaCreate = components['schemas']['PersonaCreate']
export type PersonaUpdate = components['schemas']['PersonaUpdate']
// Persona-fragment history (Plan 36 / Wave A1): every persona edit appends
// a snapshot row so the UI can list past states and restore them.
export type PersonaHistoryItem = components['schemas']['PersonaHistoryItem']
export type PersonaHistoryListResponse =
  components['schemas']['PersonaHistoryListResponse']
// The four named fragments stored at write-time. Typed by the backend
// (Plan-36 follow-up) so `entry.snapshot.<field>` reads are tsc-checked.
export type PersonaHistorySnapshot =
  components['schemas']['PersonaHistorySnapshot']
export type ChannelPrompt = components['schemas']['ChannelPromptResponse']
export type ChannelPromptListResponse =
  components['schemas']['ChannelPromptListResponse']
export type ChannelPromptUpdate = components['schemas']['ChannelUpdate']

// --- Chat context (Wave B2) ---------------------------------------------
export type ChatContextResponse = components['schemas']['ChatContextResponse']

// --- Chat SSE event envelope (Plan 08) ----------------------------------
// One versioned envelope per stream event; the discriminated union is the
// single source of truth shared with the backend's src/hermes/events.py.
export type ChatStreamEnvelope = components['schemas']['ChatStreamEnvelope']
// Structured tool-call view attached to persisted `role:"tool"` messages.
export type ToolCallView = components['schemas']['ToolCallView']
export type ToolCallData = components['schemas']['ToolCallData']
export type ToolResultData = components['schemas']['ToolResultData']
// Risky tool paused awaiting the user's decision (Plan 09 approval cards).
export type ApprovalRequiredData = components['schemas']['ApprovalRequiredData']
// Reasoning + subagent activity (Plan 10 cards).
export type ReasoningData = components['schemas']['ReasoningData']
export type SubagentStartData = components['schemas']['SubagentStartData']
export type SubagentTextData = components['schemas']['SubagentTextData']
export type SubagentDoneData = components['schemas']['SubagentDoneData']
// Workspace sandbox crash notification (Plan 11b-b). Surfaced into the chat
// stream so the UI can offer a Restart action.
export type SandboxCrashedData = components['schemas']['SandboxCrashedData']

// --- Models (Plan 40) ---------------------------------------------------
export type ModelEntry = components['schemas']['ModelEntry']
export type ModelsResponse = components['schemas']['ModelsResponse']

// --- Skills (Plan 33 / Plan 37) -----------------------------------------
// Reusable prompt building blocks ("skills" in the Anthropic sense). Each
// row carries a Markdown body and frontmatter-style metadata. Plan 37
// dropped the per-persona activation layer; skills are now a global catalog
// and the agent loads bodies on demand via the `skill_load` built-in tool.
export type Skill = components['schemas']['SkillResponse']
export type SkillListResponse = components['schemas']['SkillListResponse']
export type SkillCreate = components['schemas']['SkillCreate']
export type SkillUpdate = components['schemas']['SkillUpdate']

// --- MCP servers (Plan 32) ----------------------------------------------
// Registered external MCP servers — the agent pulls their tools into its
// catalog (alongside built-ins) with `source="mcp:<server-name>"`. Two
// transports today: `http` (StreamableHTTP, `url` set) and `stdio`
// (local subprocess, `command_argv` set). Secret handling: writes accept
// `env` (raw map) and `credentials` (plaintext); reads only ever see
// `env_keys` (variable names only) and never see ciphertext.
export type McpServer = components['schemas']['McpServerResponse']
export type McpServerList = components['schemas']['McpServerListResponse']
export type McpServerCreate = components['schemas']['McpServerCreate']
export type McpServerUpdate = components['schemas']['McpServerUpdate']
export type McpServerHealth = components['schemas']['McpServerHealthResponse']
export type McpServerSummary = components['schemas']['McpServerSummary']
export type McpServerTransport = McpServer['transport']
export type McpServerStatus = McpServer['status']

// --- LLM credentials ----------------------------------------------------
// Declared manually until `pnpm run gen:api` is re-run against a Hermes
// build that ships the OAuth + CRUD endpoints (Phase 3+4 of the
// llm-credentials feature). Keep these shapes in sync with
// `src/hermes/routes/llm.py` until the regeneration happens.
export type LlmProvider =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'google'
  | 'custom'

export interface LlmCredential {
  id: number
  provider: string
  mode: 'api_key' | 'oauth_claude' | string
  display_name: string
  base_url: string | null
  model: string | null
  is_active: boolean
  oauth_status: 'pending' | 'authorized' | 'expired' | null
  oauth_authorized_at: number | null
  created_at: number
  updated_at: number
}

export interface LlmModelChoice {
  id: string
  label: string
}

export interface LlmModelListResponse {
  models: LlmModelChoice[]
}

export interface LlmCredentialCreate {
  provider: LlmProvider
  display_name: string
  base_url?: string | null
  api_key: string
}

export interface OAuthStartResponse {
  id: number
  url: string
}

export interface OAuthStatusResponse {
  id: number
  status: 'pending' | 'authorized' | 'expired' | string
}

// --- Chat stream errors -------------------------------------------------
// Structural view of a chat-stream error used by the layer's ErrorCard.
// The frontend defines `class ChatStreamError extends Error` in
// `useChatStream.ts` (runtime semantics: `new`, `instanceof`, plus a
// `ChatStreamErrorCode` union). Class instances are structurally
// assignable to this type, so ErrorCard can stay transport-agnostic and
// the webview can produce plain objects of this shape without depending
// on the HTTP-coupled composable.
export type ChatStreamError = {
  message: string
  code: string
  statusCode?: number | null
}
