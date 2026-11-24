/**
 * AgentSessionDriver — the single seam between the chat turn runner (loop/) and a model runtime
 * (drivers/): PiCloudDriver for cloud APIs, AcpSessionDriver for local CLIs over ACP.
 * docs/modules/chat.md 3.2 · frozen for wave 2 by docs/tasks/parallel-plan.md §2: change it only
 * after updating that doc and telling the other tracks.
 *
 * Rules every driver follows (revised after the 2026-11-24 cross-review):
 * 1. Gate model requests with host.beforeModelCall() and stop without calling the model when it returns
 *    ok: false; return status "error" with that code.
 *    - Pi: once before agentLoop starts, then in finishTurn before every further request.
 *    - ACP: once before each session/prompt (the CLI's internal rounds are not visible to the client).
 * 2. Emit a usage event for every model request the runtime reports (costCents 0 when unpriced). ACP
 *    runtimes that report no usage emit none; their budget is max_rounds plus the HTTP rate limit.
 * 3. Platform tools run only through host.executeTool. The host enforces the allowlist and asks for
 *    permission for costly tools itself, so drivers must NOT call requestPermission for platform tools
 *    (Pi: do not use beforeToolCall for this). requestPermission is for the runtime's own actions,
 *    i.e. ACP session/request_permission.
 * 4. Honour `signal`: abort the in-flight request (Pi) or send session/cancel (ACP) and return
 *    status "cancelled" with whatever was already emitted.
 * 5. Never see credentials of the user: the host holds the user's JWT, drivers only see tool results.
 * 6. A driver that resumes a runtime-side session (ACP session/load) sends `turn` — the user's text
 *    plus its references — not `messages`, so the turn's @ references are not lost.
 * Process lifecycle (ACP subprocess pools, cleanup on shutdown) belongs to the driver registry in
 * drivers/, not to this interface.
 */
import type { ChatMessage } from "../llm"
import type { ReferenceBlock } from "./context"
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
  stackTrace?: string
}

export interface PermissionAsk {
  action: string
  summary: string
  options: PermissionOption[]
}
export type PermissionDecision = "allow" | "deny"

export interface TurnInput {
  /** chat_sessions.id — ACP keys its per-session cwd and subprocess pool on it. */
  sessionId: string
  runtimeId: string
  thinkingEffort: ThinkingEffort
  /** Already trimmed to the runtime's context window (loop/chat/context.ts). Ends with the current user turn. */
  messages: ChatMessage[]
  /** The current turn on its own (rule 6). `messages` already contains it, rendered. */
  turn: { userText: string; references: ReferenceBlock[] }
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
  /** Runtimes of kind "exec" (one-shot CLI batch, e.g. `codex exec`) serve background jobs only, never chat. */
  readonly kind: "api" | "acp"
  /** Matches a runtimes[].id in runner_nodes.capabilities, e.g. "api:qwen:qwen3.7-max" or "acp:opencode". */
  readonly runtimeId: string
  runTurn(input: TurnInput, host: TurnHost, signal: AbortSignal): Promise<TurnOutcome>
}
