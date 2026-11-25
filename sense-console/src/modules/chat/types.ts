/** chat.md 2.3: ACP allow_* → "allow", reject_* → "deny". */
export interface PermissionOption {
  id: string
  label: string
  kind: "allow" | "deny"
}

export type ThinkingEffort = "off" | "low" | "medium" | "high"

export type ChatMessageRole = "user" | "assistant" | "system" | "tool"

export type ChatMessageStatus = "completed" | "cancelled" | "error"

export interface PlanStepItem {
  id: string
  title: string
  status: "pending" | "in_progress" | "completed" | "failed"
}

export type ChatContextRefPart = {
  type: "context_ref"
  kind: "work_item" | "document"
  id: string
  label: string
}

export type ChatMessagePart =
  | ChatContextRefPart
  | {
      type: "reasoning"
      text: string
    }
  | {
      type: "text"
      text: string
    }
  | {
      type: "plan"
      steps: PlanStepItem[]
    }
  | {
      type: "tool_call"
      callId: string
      name: string
      state: "running" | "succeeded" | "failed"
      inputSummary?: string
      outputSummary?: string
      error?: string
      stackTrace?: string
    }
  | {
      type: "permission"
      requestId: string
      action: string
      summary: string
      options?: PermissionOption[]
      decision?: "allow" | "deny" | "timeout"
    }
  | {
      type: "error"
      code: string
      message: string
      stack?: string
    }

export interface ChatUsage {
  inputTokens: number
  outputTokens: number
  costCents: number
  durationMs: number
  model: string
}

/** Frozen SSE wire events defined in docs/modules/chat.md §2.3 & §2.4. */
export type ChatStreamEvent =
  | {
      type: "turn_start"
      jobId: string
      userMessageId: string
      seq: number
      nodeId: string
      runtime: string
      contextTruncated?: boolean
    }
  | {
      type: "reasoning_delta"
      delta: string
    }
  | {
      type: "text_delta"
      delta: string
    }
  | {
      type: "plan_update"
      steps: PlanStepItem[]
    }
  | {
      type: "tool_start"
      callId: string
      name: string
      inputSummary?: string
    }
  | {
      type: "tool_end"
      callId: string
      status: "succeeded" | "failed"
      outputSummary?: string
      error?: string
      stackTrace?: string
    }
  | {
      type: "permission_request"
      requestId: string
      action: string
      summary: string
      options?: PermissionOption[]
    }
  | {
      type: "usage"
      inputTokens: number
      outputTokens: number
      costCents: number
      durationMs: number
      model: string
    }
  | {
      type: "error"
      code: string
      message: string
      retryable?: boolean
      stack?: string
    }
  | {
      type: "done"
      assistantMessageId: string
      seq: number
      status: ChatMessageStatus
    }

export interface ChatRuntimeConfig {
  node_id?: string
  runtime_id?: string
  driver_kind?: "api" | "acp" | "exec"
  model?: string
  thinking_effort?: ThinkingEffort
}

export interface ChatSession {
  id: string
  organizationId: string
  ownerId: string
  workItemId: string | null
  title: string
  runtimeConfig: ChatRuntimeConfig
  lastSeq: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  id: string
  organizationId: string
  sessionId: string
  seq: number
  role: ChatMessageRole
  content: string
  parts: ChatMessagePart[]
  status: ChatMessageStatus
  agentJobId: string | null
  replyToMessageId: string | null
  usage?: ChatUsage | null
  runtimeLabel?: string | null
  createdAt: string
}

export interface RuntimeCapabilityFlags {
  streaming?: boolean
  reasoning?: boolean
  tools?: boolean
  sessions?: boolean
}

export interface RuntimeEntry {
  id: string
  kind: "api" | "acp" | "exec"
  provider: string
  model: string
  label: string
  capabilities: RuntimeCapabilityFlags
  contextWindow?: number
  maxOutputTokens?: number
  priced?: boolean
  status: "ready" | "unavailable" | "unverified"
}

export interface RuntimeNodeCatalog {
  nodeId: string
  nodeName: string
  /** last_seen_at within 2 minutes and not revoked (docs/modules/chat.md 3.4). */
  online: boolean
  /** Finer state for the configuration pages; absent on hand-built catalogs. */
  state?: "online" | "offline" | "never" | "revoked"
  lastSeenAt: string | null
  revokedAt?: string | null
  capabilitiesUpdatedAt?: string | null
  protocolVersion: number
  supportsHttpSse: boolean
  httpEndpointHint: string
  runtimes: RuntimeEntry[]
}

export interface SendTurnRequest {
  session_id: string
  content: string
  parts?: ChatContextRefPart[]
  runtime_id: string
  thinking_effort?: ThinkingEffort
}

export interface RegenerateTurnRequest {
  session_id: string
  user_message_id: string
  runtime_id: string
  thinking_effort?: ThinkingEffort
}

export interface AnswerPermissionRequest {
  decision: "allow" | "deny"
}

export interface HealthResponse {
  protocol_version: number
  node_id: string
}

export class HttpTransportError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "HttpTransportError"
    this.status = status
    this.code = code
  }
}

export type SlashCommandName = "capture" | "draft" | "storyboard" | "work" | "clear"

export interface SlashCommandMeta {
  name: SlashCommandName
  command: `/${SlashCommandName}`
  label: string
  description: string
  needsArg: boolean
  placeholder: string
}

export interface SlashCardItem {
  id: string
  command: SlashCommandName
  title: string
  summary: string
  status: "succeeded" | "failed"
  linkTo?: string
  linkLabel?: string
  createdAt: string
}

export interface ContextRefOption {
  kind: "work_item" | "document"
  id: string
  label: string
  subtitle?: string
}
