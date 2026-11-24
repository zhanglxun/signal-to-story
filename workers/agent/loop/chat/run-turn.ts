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
import type { AgentSessionDriver, ChatToolResult, ChatToolSpec, PermissionDecision, TurnHost, TurnInput, TurnOutcome } from "./driver"
import { type ChatStreamEvent, type ErrorEvent, type ThinkingEffort, TURN_ERROR_CODES, type TurnStatus, type UsageEvent } from "./events"
import type { ChatMessage } from "../llm"
import { assertSafeToolset, CHAT_TOOLS_REQUIRING_PERMISSION } from "./tools"

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
  sessionId: string
  userMessageId: string
  seq: number
  nodeId: string
  driver: AgentSessionDriver
  /** Trimmed context (loop/chat/context.ts); ends with the current user message. */
  messages: ChatMessage[]
  /** The raw current turn, for drivers that resume a session and send only the new prompt (ACP). */
  turn: TurnInput["turn"]
  contextTruncated: boolean
  tools: ChatToolSpec[]
  thinkingEffort: ThinkingEffort
  maxOutputTokens: number
  execSession: Record<string, unknown> | null
  budget: TurnBudget
  signal: AbortSignal
  /** Defaults to USAGE_FLUSH_TIMEOUT_MS; tests shorten it. */
  usageFlushTimeoutMs?: number
}

export interface ChatTurnResult {
  status: TurnStatus
  assistantMessageId: string
  seq: number
  costCents: number
  rounds: number
  partsTruncated: boolean
}

/** How long finishing a turn waits for outstanding usage writes before persisting anyway. */
export const USAGE_FLUSH_TIMEOUT_MS = 10_000

const DEFAULT_PERMISSION_OPTIONS = [
  { id: "allow", label: "允许", kind: "allow" as const },
  { id: "deny", label: "拒绝", kind: "deny" as const },
]

export async function runChatTurn(input: ChatTurnInput, ports: ChatTurnPorts): Promise<ChatTurnResult> {
  assertSafeToolset(input.tools)
  const acc = new PartsAccumulator()
  const pendingUsage: Promise<void>[] = []
  const warn = (message: string, detail?: unknown) => {
    try {
      ports.warn?.(message, detail)
    } catch {
      // diagnostics must never break a turn
    }
  }
  const send = (event: ChatStreamEvent) => {
    try {
      ports.emit(event)
    } catch (error) {
      warn("emit failed", error)
    }
  }
  /** Stream it and keep it in the stored parts. */
  const out = (event: ChatStreamEvent) => {
    acc.apply(event)
    send(event)
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

  const requestPermission: TurnHost["requestPermission"] = async (ask, signal) => {
    const requestId = ports.newRequestId()
    out({ type: "permission_request", requestId, ...ask })
    const combined = AbortSignal.any([input.signal, signal])
    let decision: PermissionDecision | "timeout"
    try {
      decision = await ports.awaitPermission(requestId, combined)
    } catch {
      // Stopping the turn is not a timeout: record it as denied.
      decision = combined.aborted ? "deny" : "timeout"
    }
    acc.setPermissionDecision(requestId, decision)
    return decision === "allow" ? "allow" : "deny"
  }

  const allowedTools = new Set(input.tools.map((t) => t.name))
  const host: TurnHost = {
    emit(event) {
      if (event.type === "usage") {
        input.budget.recordCost(event.costCents)
        pendingUsage.push(
          Promise.resolve()
            .then(() => ports.recordUsage(event))
            .catch((error) => warn("recordUsage failed", error)),
        )
      }
      out(event)
    },
    beforeModelCall: () => input.budget.beforeModelCall(),
    // The single gate for platform tools: allowlist, then permission for costly tools, then the port.
    async executeTool(name, toolInput, signal): Promise<ChatToolResult> {
      if (!allowedTools.has(name)) {
        return { ok: false, outputSummary: `工具 ${name} 不可用`, output: null, error: TURN_ERROR_CODES.toolNotAllowed }
      }
      if ((CHAT_TOOLS_REQUIRING_PERMISSION as readonly string[]).includes(name)) {
        const summary = `执行 ${name}：${JSON.stringify(toolInput ?? {}).slice(0, 300)}`
        const decision = await requestPermission({ action: name, summary, options: DEFAULT_PERMISSION_OPTIONS }, signal)
        if (decision !== "allow") {
          return { ok: false, outputSummary: "用户未允许执行", output: { denied: true }, error: TURN_ERROR_CODES.permissionDenied }
        }
      }
      try {
        return await ports.executeTool(name, toolInput, signal)
      } catch (error) {
        return {
          ok: false,
          outputSummary: "工具执行失败",
          output: null,
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack ? { stackTrace: error.stack } : {}),
        }
      }
    },
    requestPermission,
  }

  let outcome: TurnOutcome
  try {
    outcome = await input.driver.runTurn(
      {
        sessionId: input.sessionId,
        runtimeId: input.driver.runtimeId,
        thinkingEffort: input.thinkingEffort,
        messages: input.messages,
        turn: input.turn,
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

  // Persist first, then announce: the browser refetches on error/done, so the row must already exist.
  const errorEvent: ErrorEvent | null =
    outcome.status === "error"
      ? (() => {
          const err = outcome.error ?? { code: TURN_ERROR_CODES.driverFailed, message: "未知错误", retryable: false }
          return { type: "error", code: err.code, message: err.message, retryable: err.retryable, ...(err.stack ? { stack: err.stack } : {}) }
        })()
      : null
  if (errorEvent) acc.apply(errorEvent)

  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const flushed = await Promise.race([
    Promise.all(pendingUsage).then(() => true),
    new Promise<boolean>((resolve) => { flushTimer = setTimeout(() => resolve(false), input.usageFlushTimeoutMs ?? USAGE_FLUSH_TIMEOUT_MS) }),
  ])
  clearTimeout(flushTimer)
  if (!flushed) warn("usage writes still pending; persisting the turn anyway")

  const message = acc.finalize(outcome.status, errorEvent ? { type: "error", code: errorEvent.code, message: errorEvent.message } : undefined)
  let saved: { assistantMessageId: string; seq: number }
  try {
    saved = await ports.finish({
      status: outcome.status,
      content: message.content,
      parts: message.parts,
      ...(outcome.execSession !== undefined ? { execSession: outcome.execSession } : {}),
    })
  } catch (error) {
    send({ type: "error", code: TURN_ERROR_CODES.persistFailed, message: "回复保存失败，请重试", retryable: true })
    throw error
  }
  if (errorEvent) send(errorEvent)
  send({ type: "done", assistantMessageId: saved.assistantMessageId, seq: saved.seq, status: outcome.status })

  return {
    status: outcome.status,
    assistantMessageId: saved.assistantMessageId,
    seq: saved.seq,
    costCents: input.budget.spentCents,
    rounds: input.budget.roundsUsed,
    partsTruncated: message.truncated,
  }
}
