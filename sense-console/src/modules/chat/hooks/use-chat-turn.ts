import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatSessionRepository } from "@/modules/chat/services/chat-session-service"
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

export interface ActiveTurnState {
  sessionId: string
  jobId: string | null
  userMessageId: string | null
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
  error: { code: string; message: string; retryable?: boolean; stack?: string } | null
  finalStatus: ChatMessageStatus | null
}

export interface UseChatTurnOptions {
  transport: ChatTransport
  repository: ChatSessionRepository
  onTurnSettled?: (sessionId: string) => void | Promise<void>
  onStopRequested?: (info: {
    sessionId: string
    jobId: string | null
    runtimeLabel: string
  }) => void
}

function formatErrorMessage(err: unknown): { code: string; message: string; retryable?: boolean } {
  if (err instanceof HttpTransportError) {
    if (err.code === "turn_in_progress") {
      return {
        code: "turn_in_progress",
        message: "当前会话上一轮回复仍在进行中（409 turn_in_progress），请等待完成或停止后再试。",
        retryable: false,
      }
    }
    return {
      code: err.code,
      message: err.message,
      retryable: err.status >= 500 || err.status === 429,
    }
  }
  return {
    code: "network_error",
    message: err instanceof Error ? err.message : "流式请求发生异常",
    retryable: true,
  }
}

export function formatErrorDisplayText(code: string, message: string): string {
  if (code === "budget_exceeded") {
    return "单轮费用已达上限（budget_exceeded），已自动停止生成。建议缩小上下文或拆分问题后重试。"
  }
  return message
}

export function useChatTurn({
  transport,
  repository,
  onTurnSettled,
  onStopRequested,
}: UseChatTurnOptions) {
  const [activeTurn, setActiveTurn] = useState<ActiveTurnState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const targetRef = useRef<ChatTurnTarget | null>(null)
  const mountedRef = useRef(true)
  const activeJobIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const activeRuntimeLabelRef = useRef<string>("")
  const isStreamingRef = useRef(false)

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

  const consumeStream = useCallback(
    async (
      sessionId: string,
      target: ChatTurnTarget,
      runtimeLabel: string,
      optimisticUserContent: string | null,
      optimisticUserParts: ChatContextRefPart[],
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
        userMessageId: null,
        optimisticUserContent,
        optimisticUserParts,
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
        finalStatus: null,
      })

      try {
        for await (const ev of makeStream(controller.signal)) {
          if (!mountedRef.current || controller.signal.aborted) break

          if (ev.type === "turn_start") {
            activeJobIdRef.current = ev.jobId
            setActiveTurn((prev) =>
              prev
                ? {
                    ...prev,
                    jobId: ev.jobId,
                    userMessageId: ev.userMessageId,
                    contextTruncated: Boolean(ev.contextTruncated),
                  }
                : prev
            )
          } else if (ev.type === "reasoning_delta") {
            setActiveTurn((prev) =>
              prev ? { ...prev, reasoningText: prev.reasoningText + ev.delta } : prev
            )
          } else if (ev.type === "text_delta") {
            setActiveTurn((prev) =>
              prev ? { ...prev, textContent: prev.textContent + ev.delta } : prev
            )
          } else if (ev.type === "plan_update") {
            setActiveTurn((prev) => (prev ? { ...prev, planSteps: ev.steps } : prev))
          } else if (ev.type === "tool_start") {
            setActiveTurn((prev) =>
              prev
                ? {
                    ...prev,
                    tools: prev.tools.some((t) => t.callId === ev.callId)
                      ? prev.tools.map((t) =>
                          t.callId === ev.callId
                            ? {
                                ...t,
                                name: ev.name,
                                state: "running",
                                inputSummary: ev.inputSummary ?? t.inputSummary,
                              }
                            : t
                        )
                      : [
                          ...prev.tools,
                          {
                            callId: ev.callId,
                            name: ev.name,
                            state: "running",
                            inputSummary: ev.inputSummary,
                          },
                        ],
                  }
                : prev
            )
          } else if (ev.type === "tool_end") {
            setActiveTurn((prev) =>
              prev
                ? {
                    ...prev,
                    tools: prev.tools.map((t) =>
                      t.callId === ev.callId
                        ? {
                            ...t,
                            state: ev.status,
                            outputSummary: ev.outputSummary,
                            error: ev.error,
                            stackTrace: ev.stackTrace,
                          }
                        : t
                    ),
                  }
                : prev
            )
          } else if (ev.type === "permission_request") {
            setActiveTurn((prev) =>
              prev
                ? {
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
                : prev
            )
          } else if (ev.type === "usage") {
            setActiveTurn((prev) =>
              prev
                ? {
                    ...prev,
                    usage: {
                      inputTokens: ev.inputTokens,
                      outputTokens: ev.outputTokens,
                      costCents: ev.costCents,
                      durationMs: ev.durationMs,
                      model: ev.model,
                    },
                  }
                : prev
            )
          } else if (ev.type === "error") {
            isStreamingRef.current = false
            setActiveTurn((prev) =>
              prev
                ? {
                    ...prev,
                    isStreaming: false,
                    isStopping: false,
                    finalStatus: "error",
                    error: {
                      code: ev.code,
                      message: ev.message,
                      retryable: ev.retryable,
                      stack: ev.stack,
                    },
                  }
                : prev
            )
            await onTurnSettled?.(sessionId)
            return
          } else if (ev.type === "done") {
            isStreamingRef.current = false
            setActiveTurn((prev) =>
              prev
                ? {
                    ...prev,
                    isStreaming: false,
                    isStopping: false,
                    finalStatus: ev.status,
                  }
                : prev
            )
            await onTurnSettled?.(sessionId)
            if (mountedRef.current) {
              setActiveTurn((prev) =>
                prev && !prev.isStreaming && prev.error == null ? null : prev
              )
            }
            return
          }
        }
        isStreamingRef.current = false
      } catch (err) {
        isStreamingRef.current = false
        if ((err as { name?: string })?.name === "AbortError" || controller.signal.aborted) {
          return
        }
        const formatted = formatErrorMessage(err)
        if (mountedRef.current) {
          setActiveTurn((prev) =>
            prev
              ? {
                  ...prev,
                  isStreaming: false,
                  isStopping: false,
                  finalStatus: "error",
                  error: formatted,
                }
              : prev
          )
        }
        await onTurnSettled?.(sessionId)
      }
    },
    [onTurnSettled]
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
      if (isStreamingRef.current || activeTurn?.isStreaming) return
      await consumeStream(
        options.sessionId,
        options.target,
        options.runtimeLabel,
        options.content,
        options.parts ?? [],
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
    [activeTurn?.isStreaming, consumeStream, transport]
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
      if (isStreamingRef.current || activeTurn?.isStreaming) return
      await consumeStream(
        options.sessionId,
        options.target,
        options.runtimeLabel,
        null,
        [],
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
    [activeTurn?.isStreaming, consumeStream, transport]
  )

  const stopTurn = useCallback(async () => {
    if (!isStreamingRef.current && !activeTurn?.isStreaming) return
    const jobId = activeJobIdRef.current ?? activeTurn?.jobId ?? null
    const sessionId = activeSessionIdRef.current ?? activeTurn?.sessionId ?? null
    const runtimeLabel = activeRuntimeLabelRef.current || activeTurn?.runtimeLabel || ""
    isStreamingRef.current = false
    setActiveTurn((prev) => (prev ? { ...prev, isStopping: true } : prev))
    if (jobId) {
      try {
        await repository.cancelJob(jobId)
      } catch {
        // Still allow local stream abort if cancel RPC fails transiently.
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
  }, [activeTurn, onStopRequested, onTurnSettled, repository])

  const answerPermission = useCallback(
    async (requestId: string, decision: "allow" | "deny") => {
      const jobId = activeJobIdRef.current ?? activeTurn?.jobId
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
    [activeTurn?.jobId, transport]
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
