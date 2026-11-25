import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatSessionRepository } from "@/modules/chat/services/chat-session-service"
import {
  describePreStreamError,
  formatErrorDisplayText,
  NODE_MISMATCH,
  NODE_UNREACHABLE,
  nodeUnreachableError,
  type TurnErrorInfo,
} from "@/modules/chat/transport/errors"
import type { ChatTransport, ChatTurnTarget } from "@/modules/chat/transport/transport"
import {
  type ChatContextRefPart,
  type ChatMessageStatus,
  type ChatStreamEvent,
  type ChatUsage,
  HttpTransportError,
  type PermissionOption,
  type PlanStepItem,
  type ThinkingEffort,
} from "@/modules/chat/types"

export interface LiveToolItem {
  callId: string
  name: string
  state: "running" | "succeeded" | "failed"
  inputSummary?: string
  outputSummary?: string
  error?: string
  stackTrace?: string
}

export interface LivePermissionItem {
  requestId: string
  action: string
  summary: string
  options: PermissionOption[]
  decision?: "allow" | "deny" | "timeout"
}

/** What started the turn; used to offer the right retry. */
export type TurnRequest =
  | { kind: "send"; content: string; parts: ChatContextRefPart[] }
  | { kind: "regenerate"; userMessageId: string }

export interface ActiveTurnState {
  sessionId: string
  jobId: string | null
  userMessageId: string | null
  request: TurnRequest
  optimisticUserContent: string | null
  optimisticUserParts: ChatContextRefPart[]
  runtimeLabel: string
  isStreaming: boolean
  isStopping: boolean
  contextTruncated: boolean
  reasoningText: string
  textContent: string
  planSteps: PlanStepItem[]
  tools: LiveToolItem[]
  permissions: LivePermissionItem[]
  usage: ChatUsage | null
  error: TurnErrorInfo | null
  /** The stream ended after an `error` without `done`: the reply was not persisted (chat.md 2.4). */
  persistFailed: boolean
  finalStatus: ChatMessageStatus | null
}

interface TurnInfo {
  sessionId: string
  jobId: string | null
  runtimeLabel: string
}

export interface UseChatTurnOptions {
  transport: ChatTransport
  repository: ChatSessionRepository
  onTurnSettled?: (sessionId: string) => void | Promise<void>
  onStopRequested?: (info: TurnInfo) => void
  /**
   * The stream broke off after it started, without `done` or `error` (network drop, node restart).
   * Disconnect is not cancel: the node keeps running and persists the turn, so the page waits for
   * it (chat.md 2.3).
   */
  onStreamInterrupted?: (info: TurnInfo) => void
  /** How long a successful GET /v1/health is trusted before the next send checks again. */
  healthCheckTtlMs?: number
  healthCheckTimeoutMs?: number
}

export { formatErrorDisplayText }

const DEFAULT_HEALTH_TTL_MS = 60_000
const DEFAULT_HEALTH_TIMEOUT_MS = 5_000

function isAbortError(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err as { name?: string } | null)?.name === "AbortError"
}

function healthKey(target: ChatTurnTarget): string {
  return `${target.nodeId}@${target.endpointHint}`
}

/** Applies one non-terminal stream event to the live turn. */
function applyEvent(prev: ActiveTurnState, ev: ChatStreamEvent): ActiveTurnState {
  switch (ev.type) {
    case "turn_start":
      return {
        ...prev,
        jobId: ev.jobId,
        userMessageId: ev.userMessageId,
        contextTruncated: Boolean(ev.contextTruncated),
      }
    case "reasoning_delta":
      return { ...prev, reasoningText: prev.reasoningText + ev.delta }
    case "text_delta":
      return { ...prev, textContent: prev.textContent + ev.delta }
    case "plan_update":
      return { ...prev, planSteps: ev.steps }
    case "tool_start":
      return {
        ...prev,
        tools: prev.tools.some((t) => t.callId === ev.callId)
          ? prev.tools.map((t) =>
              t.callId === ev.callId
                ? { ...t, name: ev.name, state: "running", inputSummary: ev.inputSummary ?? t.inputSummary }
                : t
            )
          : [...prev.tools, { callId: ev.callId, name: ev.name, state: "running", inputSummary: ev.inputSummary }],
      }
    case "tool_end":
      return {
        ...prev,
        tools: prev.tools.map((t) =>
          t.callId === ev.callId
            ? { ...t, state: ev.status, outputSummary: ev.outputSummary, error: ev.error, stackTrace: ev.stackTrace }
            : t
        ),
      }
    case "permission_request":
      return {
        ...prev,
        permissions: [
          ...prev.permissions,
          {
            requestId: ev.requestId,
            action: ev.action,
            summary: ev.summary,
            options: ev.options ?? [
              { id: "allow", label: "允许", kind: "allow" },
              { id: "deny", label: "拒绝", kind: "deny" },
            ],
          },
        ],
      }
    case "usage":
      return {
        ...prev,
        usage: {
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          costCents: ev.costCents,
          durationMs: ev.durationMs,
          model: ev.model,
        },
      }
    case "error":
      return {
        ...prev,
        finalStatus: "error",
        error: { code: ev.code, message: ev.message, retryable: ev.retryable, stack: ev.stack },
      }
    case "done":
      return { ...prev, isStreaming: false, isStopping: false, finalStatus: ev.status }
  }
}

export function useChatTurn({
  transport,
  repository,
  onTurnSettled,
  onStopRequested,
  onStreamInterrupted,
  healthCheckTtlMs = DEFAULT_HEALTH_TTL_MS,
  healthCheckTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
}: UseChatTurnOptions) {
  const [activeTurn, setActiveTurn] = useState<ActiveTurnState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const targetRef = useRef<ChatTurnTarget | null>(null)
  const mountedRef = useRef(true)
  const activeJobIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const activeRuntimeLabelRef = useRef<string>("")
  const isStreamingRef = useRef(false)
  /** endpoint → time of the last successful GET /v1/health. */
  const healthyAtRef = useRef(new Map<string, number>())

  // Disconnect on unmount ONLY; never cancel the server/worker turn (frontend.md §5.2 #7).
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      isStreamingRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const disconnectStream = useCallback(() => {
    isStreamingRef.current = false
    abortRef.current?.abort()
    abortRef.current = null
    setActiveTurn((prev) => (prev && prev.isStreaming ? null : prev))
  }, [])

  /** GET /v1/health before the first send to a node, so an unreachable node fails cleanly. */
  const ensureNodeReachable = useCallback(
    async (target: ChatTurnTarget, signal: AbortSignal) => {
      if (!transport.checkHealth) return
      const okAt = healthyAtRef.current.get(healthKey(target))
      if (okAt !== undefined && Date.now() - okAt < healthCheckTtlMs) return

      const controller = new AbortController()
      const onAbort = () => controller.abort()
      signal.addEventListener("abort", onAbort, { once: true })
      const timer = setTimeout(() => controller.abort(), healthCheckTimeoutMs)
      let nodeId: string
      try {
        nodeId = (await transport.checkHealth(target.endpointHint, controller.signal)).node_id
      } catch (err) {
        if (signal.aborted) throw err
        if (err instanceof HttpTransportError && err.code === NODE_UNREACHABLE) throw err
        throw nodeUnreachableError(target.endpointHint)
      } finally {
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
      }
      if (nodeId && nodeId !== target.nodeId) {
        throw new HttpTransportError(
          0,
          NODE_MISMATCH,
          `该地址上运行的是另一个节点（node_id 不一致），请检查节点的 SENSE_NODE_ID 与对外地址配置：${target.endpointHint}`
        )
      }
      healthyAtRef.current.set(healthKey(target), Date.now())
    },
    [healthCheckTimeoutMs, healthCheckTtlMs, transport]
  )

  const consumeStream = useCallback(
    async (
      sessionId: string,
      target: ChatTurnTarget,
      runtimeLabel: string,
      request: TurnRequest,
      makeStream: (signal: AbortSignal) => AsyncIterable<ChatStreamEvent>
    ) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      targetRef.current = target
      isStreamingRef.current = true
      activeSessionIdRef.current = sessionId
      activeJobIdRef.current = null
      activeRuntimeLabelRef.current = runtimeLabel

      setActiveTurn({
        sessionId,
        jobId: null,
        userMessageId: request.kind === "regenerate" ? request.userMessageId : null,
        request,
        optimisticUserContent: request.kind === "send" ? request.content : null,
        optimisticUserParts: request.kind === "send" ? request.parts : [],
        runtimeLabel,
        isStreaming: true,
        isStopping: false,
        contextTruncated: false,
        reasoningText: "",
        textContent: "",
        planSteps: [],
        tools: [],
        permissions: [],
        usage: null,
        error: null,
        persistFailed: false,
        finalStatus: null,
      })

      let streamStarted = false
      let lastError: TurnErrorInfo | null = null
      const isCurrent = () => mountedRef.current && !controller.signal.aborted
      const update = (fn: (prev: ActiveTurnState) => ActiveTurnState) =>
        setActiveTurn((prev) => (prev && prev.sessionId === sessionId ? fn(prev) : prev))

      const waitForPersistedResult = async () => {
        setActiveTurn(null)
        onStreamInterrupted?.({ sessionId, jobId: activeJobIdRef.current, runtimeLabel })
        await onTurnSettled?.(sessionId)
      }

      const showFailure = async (error: TurnErrorInfo, persistFailed: boolean) => {
        update((prev) => ({
          ...prev,
          isStreaming: false,
          isStopping: false,
          finalStatus: "error",
          persistFailed,
          error,
        }))
        await onTurnSettled?.(sessionId)
      }

      try {
        await ensureNodeReachable(target, controller.signal)
        for await (const ev of makeStream(controller.signal)) {
          if (!isCurrent()) return
          streamStarted = true
          if (ev.type === "turn_start") activeJobIdRef.current = ev.jobId

          if (ev.type === "error") {
            // Not terminal (chat.md 2.4 结束规则): the node persists the failed turn, then sends
            // `done`. Show the error and keep reading until `done` or the end of the stream.
            lastError = { code: ev.code, message: ev.message, retryable: ev.retryable, stack: ev.stack }
          }
          update((prev) => applyEvent(prev, ev))

          if (ev.type === "done") {
            // The only terminal event: the assistant message is in the database now and the
            // timeline (refreshed below) renders it, including a persisted error part.
            isStreamingRef.current = false
            await onTurnSettled?.(sessionId)
            if (mountedRef.current) {
              setActiveTurn((prev) => (prev && prev.sessionId === sessionId && !prev.isStreaming ? null : prev))
            }
            return
          }
        }
        if (!isCurrent()) return
        isStreamingRef.current = false

        if (lastError) {
          // `error` without `done`: the reply could not be persisted (persist_failed).
          await showFailure({ ...lastError, retryable: true }, true)
        } else if (streamStarted) {
          await waitForPersistedResult()
        } else {
          await showFailure(
            { code: "empty_stream", message: "节点没有返回任何事件，请重试。", retryable: true },
            false
          )
        }
      } catch (err) {
        isStreamingRef.current = false
        if (isAbortError(err, controller.signal) || !mountedRef.current) return

        if (lastError) {
          await showFailure({ ...lastError, retryable: true }, true)
          return
        }
        if (streamStarted) {
          // The connection broke mid-stream; the node still finishes and persists the turn.
          await waitForPersistedResult()
          return
        }
        if (err instanceof HttpTransportError && err.code === NODE_UNREACHABLE) {
          healthyAtRef.current.delete(healthKey(target))
        }
        await showFailure(describePreStreamError(err), false)
      }
    },
    [ensureNodeReachable, onStreamInterrupted, onTurnSettled]
  )

  const sendTurn = useCallback(
    async (options: {
      sessionId: string
      content: string
      parts?: ChatContextRefPart[]
      target: ChatTurnTarget
      runtimeId: string
      runtimeLabel: string
      thinkingEffort?: ThinkingEffort
    }) => {
      if (isStreamingRef.current) return
      await consumeStream(
        options.sessionId,
        options.target,
        options.runtimeLabel,
        { kind: "send", content: options.content, parts: options.parts ?? [] },
        (signal) =>
          transport.sendTurn(
            options.target,
            {
              session_id: options.sessionId,
              content: options.content,
              parts: options.parts,
              runtime_id: options.runtimeId,
              thinking_effort: options.thinkingEffort,
            },
            signal
          )
      )
    },
    [consumeStream, transport]
  )

  const regenerateTurn = useCallback(
    async (options: {
      sessionId: string
      userMessageId: string
      target: ChatTurnTarget
      runtimeId: string
      runtimeLabel: string
      thinkingEffort?: ThinkingEffort
    }) => {
      if (isStreamingRef.current) return
      await consumeStream(
        options.sessionId,
        options.target,
        options.runtimeLabel,
        { kind: "regenerate", userMessageId: options.userMessageId },
        (signal) =>
          transport.regenerate(
            options.target,
            {
              session_id: options.sessionId,
              user_message_id: options.userMessageId,
              runtime_id: options.runtimeId,
              thinking_effort: options.thinkingEffort,
            },
            signal
          )
      )
    },
    [consumeStream, transport]
  )

  /** The user clicked「停止」: cancel_agent_job first, then stop reading (chat.md 2.3). */
  const stopTurn = useCallback(async () => {
    if (!isStreamingRef.current) return
    const jobId = activeJobIdRef.current
    const sessionId = activeSessionIdRef.current
    const runtimeLabel = activeRuntimeLabelRef.current
    isStreamingRef.current = false
    setActiveTurn((prev) => (prev ? { ...prev, isStopping: true } : prev))
    if (jobId) {
      try {
        await repository.cancelJob(jobId)
      } catch {
        // Still abort the local read if the cancel RPC fails transiently.
      }
    }
    abortRef.current?.abort()
    abortRef.current = null
    setActiveTurn((prev) =>
      prev ? { ...prev, isStreaming: false, isStopping: false, finalStatus: "cancelled" } : prev
    )
    if (sessionId) {
      onStopRequested?.({ sessionId, jobId, runtimeLabel })
      await onTurnSettled?.(sessionId)
    }
    if (mountedRef.current) {
      setActiveTurn((prev) => (prev && !prev.isStreaming && prev.error == null ? null : prev))
    }
  }, [onStopRequested, onTurnSettled, repository])

  const answerPermission = useCallback(
    async (requestId: string, decision: "allow" | "deny") => {
      const jobId = activeJobIdRef.current
      const target = targetRef.current
      if (!jobId || !target) return
      await transport.answerPermission(target, jobId, requestId, { decision })
      if (mountedRef.current) {
        setActiveTurn((prev) =>
          prev
            ? {
                ...prev,
                permissions: prev.permissions.map((p) =>
                  p.requestId === requestId ? { ...p, decision } : p
                ),
              }
            : prev
        )
      }
    },
    [transport]
  )

  const clearError = useCallback(() => {
    setActiveTurn((prev) => (prev && !prev.isStreaming ? null : prev))
  }, [])

  return {
    activeTurn,
    isStreaming: Boolean(activeTurn?.isStreaming),
    sendTurn,
    regenerateTurn,
    stopTurn,
    disconnectStream,
    answerPermission,
    clearError,
  }
}
