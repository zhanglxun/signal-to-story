/**
 * Chat stream protocol (worker side). Source of truth: docs/modules/chat.md 2.3 (events and stored
 * parts) and 2.4 (HTTP contract v1). sense-console keeps its own copy of these types; the two
 * projects never share code, so any change starts in the doc.
 */

export type ThinkingEffort = "off" | "low" | "medium" | "high"
export type TurnStatus = "completed" | "cancelled" | "error"

export interface PlanStep {
  id: string
  title: string
  status: "pending" | "in_progress" | "completed" | "failed"
}

// ── SSE events (field names camelCase on the wire) ───────────────────────────────────────────────

export interface TurnStartEvent {
  type: "turn_start"
  jobId: string
  userMessageId: string
  seq: number
  nodeId: string
  runtime: string
  contextTruncated?: boolean
}
export interface ReasoningDeltaEvent { type: "reasoning_delta"; delta: string }
export interface TextDeltaEvent { type: "text_delta"; delta: string }
export interface PlanUpdateEvent { type: "plan_update"; steps: PlanStep[] }
export interface ToolStartEvent { type: "tool_start"; callId: string; name: string; inputSummary: string }
export interface ToolEndEvent {
  type: "tool_end"
  callId: string
  status: "succeeded" | "failed"
  outputSummary: string
  error?: string
  stackTrace?: string
}
export interface PermissionOption { id: string; label: string; kind: "allow" | "deny" }
export interface PermissionRequestEvent {
  type: "permission_request"
  requestId: string
  action: string
  summary: string
  options: PermissionOption[]
}
export interface UsageEvent {
  type: "usage"
  inputTokens: number
  outputTokens: number
  costCents: number
  durationMs: number
  model: string
}
export interface ErrorEvent { type: "error"; code: string; message: string; retryable: boolean; stack?: string }
export interface DoneEvent { type: "done"; assistantMessageId: string; seq: number; status: TurnStatus }

export type ChatStreamEvent =
  | TurnStartEvent
  | ReasoningDeltaEvent
  | TextDeltaEvent
  | PlanUpdateEvent
  | ToolStartEvent
  | ToolEndEvent
  | PermissionRequestEvent
  | UsageEvent
  | ErrorEvent
  | DoneEvent

/** What a driver may emit. turn_start / permission_request / error / done belong to the turn runner. */
export type DriverEvent = ReasoningDeltaEvent | TextDeltaEvent | PlanUpdateEvent | ToolStartEvent | ToolEndEvent | UsageEvent

// ── Stored message parts (chat_messages.parts) ───────────────────────────────────────────────────

export interface TextPart { type: "text"; text: string }
export interface ReasoningPart { type: "reasoning"; text: string }
export interface PlanPart { type: "plan"; steps: PlanStep[] }
export interface ToolCallPart {
  type: "tool_call"
  callId: string
  name: string
  state: "running" | "succeeded" | "failed"
  inputSummary: string
  outputSummary?: string
  error?: string
  stackTrace?: string
}
export interface PermissionPart {
  type: "permission"
  requestId: string
  action: string
  summary: string
  options: PermissionOption[]
  decision?: "allow" | "deny" | "timeout"
}
export interface ErrorPart { type: "error"; code: string; message: string; stack?: string }
/** `@` reference chips on a user message. */
export interface ContextRefPart { type: "context_ref"; kind: "work_item" | "document"; id: string; label: string }

export type MessagePart = TextPart | ReasoningPart | PlanPart | ToolCallPart | PermissionPart | ErrorPart | ContextRefPart

/** Error codes the runner itself produces (HTTP pre-stream codes live in the HTTP entry). */
export const TURN_ERROR_CODES = {
  budgetExceeded: "budget_exceeded",
  maxRounds: "max_rounds",
  driverFailed: "driver_failed",
  cancelled: "cancelled",
} as const
