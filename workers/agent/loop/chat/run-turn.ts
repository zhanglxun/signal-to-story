/**
 * Runs one chat turn: driver ↔ budget ↔ permission round-trips ↔ parts accumulation ↔ persistence.
 * Pure orchestration; every side effect goes through ChatTurnPorts so the HTTP entry
 * (handlers/chat-turn + entry/http.ts) supplies the database and SSE implementations and tests
 * supply fakes. docs/modules/chat.md 2.3–2.6.
 *
 * Disconnect ≠ cancel: ports.emit may become a no-op when the browser goes away; the turn keeps
 * running and is persisted. Only `signal` (user pressed stop → cancel_requested_at) cancels it.
 */
import { PartsAccumulator } from "./accumulator"
import type { TurnBudget } from "./budget"
import type { AgentSessionDriver, ChatToolResult, ChatToolSpec, PermissionDecision, TurnHost, TurnOutcome } from "./driver"
import { type ChatStreamEvent, type ThinkingEffort, TURN_ERROR_CODES, type TurnStatus, type UsageEvent } from "./events"
import type { ChatMessage } from "../llm"
import { assertSafeToolset } from "./tools"

export interface ChatTurnPorts {
  /** Forward to the SSE stream. Must not throw (swallow write errors after disconnect). */
  emit(event: ChatStreamEvent): void
  /** Persist usage (node_record_step). Failures are reported but do not stop the turn. */
  recordUsage(usage: UsageEvent): Promise<void>
  executeTool(name: string, input: unknown, signal: AbortSignal): Promise<ChatToolResult>
  /** Waits for the user's answer to permission `requestId`; "timeout" when none arrives in time. */
  awaitPermission(requestId: string, signal: AbortSignal): Promise<PermissionDecision | "timeout">
  /** Persist the assistant message and finish the job in one call (node_append_chat_message, p_finish). */
  finish(result: {
    status: TurnStatus
    content: string
    parts: ReturnType<PartsAccumulator["finalize"]>["parts"]
    execSession?: Record<string, unknown> | null
  }): Promise<{ assistantMessageId: string; seq: number }>
  newRequestId(): string
  /** Optional diagnostics sink (the loop never logs by itself). */
  warn?(message: string, detail?: unknown): void
}

export interface ChatTurnInput {
  jobId: string
  userMessageId: string
  seq: number
  nodeId: string
  driver: AgentSessionDriver
  messages: ChatMessage[]
  contextTruncated: boolean
  tools: ChatToolSpec[]
  thinkingEffort: ThinkingEffort
  maxOutputTokens: number
  execSession: Record<string, unknown> | null
  budget: TurnBudget
  signal: AbortSignal
}

export interface ChatTurnResult {
  status: TurnStatus
  assistantMessageId: string
  seq: number
  costCents: number
  rounds: number
  partsTruncated: boolean
}

export async function runChatTurn(input: ChatTurnInput, ports: ChatTurnPorts): Promise<ChatTurnResult> {
  assertSafeToolset(input.tools)
  const acc = new PartsAccumulator()
  const pendingUsage: Promise<void>[] = []
  const out = (event: ChatStreamEvent) => {
    acc.apply(event)
    try {
      ports.emit(event)
    } catch (error) {
      ports.warn?.("emit failed", error)
    }
  }

  out({
    type: "turn_start",
    jobId: input.jobId,
    userMessageId: input.userMessageId,
    seq: input.seq,
    nodeId: input.nodeId,
    runtime: input.driver.runtimeId,
    ...(input.contextTruncated ? { contextTruncated: true } : {}),
  })

  const host: TurnHost = {
    emit(event) {
      if (event.type === "usage") {
        input.budget.recordCost(event.costCents)
        pendingUsage.push(ports.recordUsage(event).catch((error) => ports.warn?.("recordUsage failed", error)))
      }
      out(event)
    },
    beforeModelCall: () => input.budget.beforeModelCall(),
    executeTool: (name, toolInput, signal) => ports.executeTool(name, toolInput, signal),
    async requestPermission(ask, signal) {
      const requestId = ports.newRequestId()
      out({ type: "permission_request", requestId, ...ask })
      let decision: PermissionDecision | "timeout"
      try {
        decision = await ports.awaitPermission(requestId, signal)
      } catch {
        decision = "timeout"
      }
      acc.setPermissionDecision(requestId, decision)
      return decision === "allow" ? "allow" : "deny"
    },
  }

  let outcome: TurnOutcome
  try {
    outcome = await input.driver.runTurn(
      {
        runtimeId: input.driver.runtimeId,
        thinkingEffort: input.thinkingEffort,
        messages: input.messages,
        tools: input.tools,
        maxOutputTokens: input.maxOutputTokens,
        execSession: input.execSession,
      },
      host,
      input.signal,
    )
  } catch (error) {
    outcome = input.signal.aborted
      ? { status: "cancelled" }
      : {
          status: "error",
          error: {
            code: TURN_ERROR_CODES.driverFailed,
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
            stack: error instanceof Error ? error.stack : undefined,
          },
        }
  }
  if (input.signal.aborted && outcome.status === "completed") outcome = { ...outcome, status: "cancelled" }

  if (outcome.status === "error") {
    const err = outcome.error ?? { code: TURN_ERROR_CODES.driverFailed, message: "未知错误", retryable: false }
    out({ type: "error", code: err.code, message: err.message, retryable: err.retryable, ...(err.stack ? { stack: err.stack } : {}) })
  }

  await Promise.all(pendingUsage)
  const message = acc.finalize(outcome.status)
  const saved = await ports.finish({
    status: outcome.status,
    content: message.content,
    parts: message.parts,
    ...(outcome.execSession !== undefined ? { execSession: outcome.execSession } : {}),
  })
  out({ type: "done", assistantMessageId: saved.assistantMessageId, seq: saved.seq, status: outcome.status })

  return {
    status: outcome.status,
    assistantMessageId: saved.assistantMessageId,
    seq: saved.seq,
    costCents: input.budget.spentCents,
    rounds: input.budget.roundsUsed,
    partsTruncated: message.truncated,
  }
}
