/**
 * AgentSessionDriver — the single seam between the chat turn runner (loop/) and a model runtime
 * (drivers/): PiCloudDriver for cloud APIs, AcpSessionDriver for local CLIs over ACP.
 * docs/modules/chat.md 3.2 · frozen for wave 2 by docs/tasks/parallel-plan.md §2: change it only
 * after updating that doc and telling the other tracks.
 *
 * Rules every driver follows:
 * 1. Call host.beforeModelCall() before EVERY model request (including each tool-loop round) and
 *    stop without calling the model when it returns ok: false; return status "error" with that code.
 * 2. Emit a usage event after every model request (costCents 0 when the runtime has no pricing).
 * 3. Run tools only through host.executeTool (Pi). An ACP CLI runs its own tools; it reports them
 *    with tool_start / tool_end and routes session/request_permission through host.requestPermission.
 * 4. Honour `signal`: abort the in-flight request (Pi) or send session/cancel (ACP) and return
 *    status "cancelled" with whatever was already emitted.
 * 5. Never see credentials of the user: the host holds the user's JWT, drivers only see tool results.
 */
import type { ChatMessage } from "../llm"
import type { DriverEvent, PermissionOption, ThinkingEffort, TurnStatus } from "./events"

export interface ChatToolSpec {
  name: string
  description: string
  /** JSON Schema of the tool input. */
  inputSchema: Record<string, unknown>
}

export interface ChatToolResult {
  ok: boolean
  /** Short human-readable summary, stored in the tool_call part. */
  outputSummary: string
  /** Full result returned to the model. */
  output: unknown
  error?: string
}

export interface PermissionAsk {
  action: string
  summary: string
  options: PermissionOption[]
}
export type PermissionDecision = "allow" | "deny"

export interface TurnInput {
  runtimeId: string
  thinkingEffort: ThinkingEffort
  /** Already trimmed to the runtime's context window (loop/chat/context.ts). Ends with the current user turn. */
  messages: ChatMessage[]
  tools: ChatToolSpec[]
  maxOutputTokens: number
  /** chat_sessions.exec_session from the previous turn on this node (ACP session handle), or null. */
  execSession: Record<string, unknown> | null
}

export type ModelCallGate = { ok: true } | { ok: false; code: string; message: string }

export interface TurnHost {
  emit(event: DriverEvent): void
  beforeModelCall(): ModelCallGate
  executeTool(name: string, input: unknown, signal: AbortSignal): Promise<ChatToolResult>
  /** Resolves "deny" on timeout or lost connection; never rejects. */
  requestPermission(ask: PermissionAsk, signal: AbortSignal): Promise<PermissionDecision>
}

export interface TurnOutcome {
  status: TurnStatus
  /** New exec_session to persist (ACP); undefined leaves it unchanged, null clears it. */
  execSession?: Record<string, unknown> | null
  error?: { code: string; message: string; retryable: boolean; stack?: string }
}

export interface AgentSessionDriver {
  readonly kind: "api" | "acp"
  /** Matches a runtimes[].id in runner_nodes.capabilities, e.g. "api:qwen:qwen3.7-max" or "acp:opencode". */
  readonly runtimeId: string
  runTurn(input: TurnInput, host: TurnHost, signal: AbortSignal): Promise<TurnOutcome>
}
