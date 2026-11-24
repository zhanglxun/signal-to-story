import type { MemoryChatStore } from "@/modules/chat/services/chat-session-service"
import type { ChatTransport, ChatTurnTarget } from "@/modules/chat/transport/transport"
import {
  type AnswerPermissionRequest,
  type ChatMessagePart,
  type ChatStreamEvent,
  HttpTransportError,
  type RegenerateTurnRequest,
  type SendTurnRequest,
} from "@/modules/chat/types"

interface ActiveMockTurn {
  jobId: string
  sessionId: string
  cancelled: boolean
  wakeController: AbortController
  donePromise: Promise<void>
  pendingPermission?: {
    requestId: string
    resolve: (decision: "allow" | "deny") => void
  }
}

export interface MockChatTransport extends ChatTransport {
  cancelTurn(jobId: string): Promise<void>
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

async function createStreamRunner(options: {
  store: MemoryChatStore
  sessionId: string
  userMessageId: string
  userSeq: number
  prompt: string
  runtimeId: string
  target: ChatTurnTarget
  jobId: string
  stepDelayMs: number
  activeTurns: Map<string, ActiveMockTurn>
  signal?: AbortSignal
}): Promise<AsyncIterable<ChatStreamEvent>> {
  const { store, sessionId, userMessageId, userSeq, prompt, runtimeId, target, jobId, stepDelayMs, activeTurns, signal } =
    options

  let resolveDone!: () => void
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const wakeController = new AbortController()
  const turnState: ActiveMockTurn = {
    jobId,
    sessionId,
    cancelled: false,
    wakeController,
    donePromise,
  }
  activeTurns.set(jobId, turnState)

  const listeners = new Set<(ev: ChatStreamEvent) => void>()
  const buffer: ChatStreamEvent[] = []
  let finished = false

  const emit = (ev: ChatStreamEvent) => {
    buffer.push(ev)
    for (const fn of listeners) fn(ev)
    if (ev.type === "done" || ev.type === "error") {
      finished = true
    }
  }

  // Background producer keeps running even if the UI reader aborts (disconnect != cancel).
  void (async () => {
    const reasoningParts: string[] = []
    const textParts: string[] = []
    const storedParts: ChatMessagePart[] = []

    const finalize = (status: "completed" | "cancelled" | "error", errorPart?: ChatMessagePart) => {
      const fullReasoning = reasoningParts.join("")
      const fullText = textParts.join("")
      const parts: ChatMessagePart[] = []
      if (fullReasoning) parts.push({ type: "reasoning", text: fullReasoning })
      if (fullText) parts.push({ type: "text", text: fullText })
      parts.push(...storedParts)
      if (errorPart) parts.push(errorPart)

      const content =
        fullText ||
        (errorPart?.type === "error" ? errorPart.message : "") ||
        (status === "cancelled" ? "（已停止生成）" : "")

      const saved = store.appendAssistantMessage({
        sessionId,
        content,
        parts,
        status,
        agentJobId: jobId,
        replyToMessageId: userMessageId,
        runtimeLabel: runtimeId,
        usage:
          status === "completed"
            ? {
                inputTokens: Math.max(24, prompt.length * 2),
                outputTokens: Math.max(18, Math.ceil(content.length / 2)),
                costCents: 0.2,
                durationMs: Math.max(120, stepDelayMs * 6),
                model: runtimeId,
              }
            : null,
      })

      activeTurns.delete(jobId)
      if (errorPart?.type === "error") {
        emit({
          type: "error",
          code: errorPart.code,
          message: errorPart.message,
          retryable: errorPart.code !== "budget_exceeded",
          stack: errorPart.stack,
        })
      } else {
        emit({
          type: "done",
          assistantMessageId: saved.id,
          seq: saved.seq,
          status,
        })
      }
      resolveDone()
    }

    try {
      emit({
        type: "turn_start",
        jobId,
        userMessageId,
        seq: userSeq + 1,
        nodeId: target.nodeId,
        runtime: runtimeId,
      })
      await wait(stepDelayMs, wakeController.signal)
      if (turnState.cancelled) return finalize("cancelled")

      const lower = prompt.toLowerCase()
      if (prompt.includes("预算") || lower.includes("budget")) {
        const chunk = "正在分析输入内容，准备生成结构化建议…"
        textParts.push(chunk)
        emit({ type: "text_delta", delta: chunk })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return finalize("cancelled")
        return finalize("error", {
          type: "error",
          code: "budget_exceeded",
          message: "单轮费用已达上限（50 / 50 分），系统已自动中止后续模型调用。",
        })
      }

      if (prompt.includes("报错") || lower.includes("error")) {
        const reason = "正在准备调用远端推理接口…"
        reasoningParts.push(reason)
        emit({ type: "reasoning_delta", delta: reason })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return finalize("cancelled")
        return finalize("error", {
          type: "error",
          code: "upstream_error",
          message: "模拟上游模型流中断，可点击重新生成或切换模型重试。",
          stack: "Error: Upstream stream closed unexpectedly\n  at MockStreamDriver.next (mock-transport.ts)",
        })
      }

      if (prompt.includes("权限") || prompt.includes("审批")) {
        const r1 = "检测到你希望执行带成本的出稿操作，按 Mandate 安全策略需先向你发起确认。"
        reasoningParts.push(r1)
        emit({ type: "reasoning_delta", delta: r1 })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return finalize("cancelled")

        const reqId = `perm-${Date.now()}`
        const permSummary = "是否允许入队后台 content_draft 任务（预计消耗模型额度）？"
        emit({
          type: "permission_request",
          requestId: reqId,
          action: "enqueue_content_draft",
          summary: permSummary,
          options: [
            { id: "allow", label: "允许", kind: "allow" },
            { id: "deny", label: "拒绝", kind: "deny" },
          ],
        })

        const decision = await new Promise<"allow" | "deny">((resolve) => {
          turnState.pendingPermission = { requestId: reqId, resolve }
        })
        turnState.pendingPermission = undefined
        if (turnState.cancelled) return finalize("cancelled")

        storedParts.push({
          type: "permission",
          requestId: reqId,
          action: "enqueue_content_draft",
          summary: permSummary,
          options: [
            { id: "allow", label: "允许", kind: "allow" },
            { id: "deny", label: "拒绝", kind: "deny" },
          ],
          decision,
        })

        const answerText =
          decision === "allow"
            ? "✅ 已收到你的**允许**确认：后续真实后端将把该稿件任务写入 `agent_jobs` 队列并留痕。"
            : "⛔ 已按你的**拒绝**决定跳过操作，未触发任何队列任务或费用支出。"
        textParts.push(answerText)
        emit({ type: "text_delta", delta: answerText })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return finalize("cancelled")
        return finalize("completed")
      }

      const thoughtChunks = [
        "1. 解析用户输入与已挂载的上下文参考；",
        "2. 组织结构化 Markdown 回答，并遵守仅提案、不越权原则。",
      ]
      for (const tc of thoughtChunks) {
        if (turnState.cancelled) return finalize("cancelled")
        reasoningParts.push(tc)
        emit({ type: "reasoning_delta", delta: tc })
        await wait(stepDelayMs, wakeController.signal)
      }

      const replyChunks = [
        `### 回复摘要（${runtimeId}）\n\n`,
        `已收到你的请求：**${prompt.slice(0, 60)}${prompt.length > 60 ? "…" : ""}**\n\n`,
        "- 当前运行在 **Mock 流式传输模式**，用于端到端验证会话管理、SSE 事件拼接与多版本重生成。\n",
        "- 你可以使用 `/capture` 收录灵感、用 `@` 引用已有事项或稿件，或点击右上角切换独立 H5 视图。\n\n",
        "[查看工作台事项](/work-items)",
      ]
      for (const rc of replyChunks) {
        if (turnState.cancelled) return finalize("cancelled")
        textParts.push(rc)
        emit({ type: "text_delta", delta: rc })
        await wait(stepDelayMs, wakeController.signal)
      }

      emit({
        type: "usage",
        inputTokens: Math.max(24, prompt.length * 2),
        outputTokens: Math.max(18, Math.ceil(textParts.join("").length / 2)),
        costCents: 0.2,
        durationMs: Math.max(120, stepDelayMs * 6),
        model: runtimeId,
      })
      finalize("completed")
    } catch (err) {
      finalize("error", {
        type: "error",
        code: "internal_error",
        message: err instanceof Error ? err.message : "Mock turn failed",
      })
    }
  })()

  return {
    [Symbol.asyncIterator](): AsyncIterator<ChatStreamEvent> {
      let cursor = 0
      return {
        async next(): Promise<IteratorResult<ChatStreamEvent>> {
          if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError")
          }
          while (cursor >= buffer.length) {
            if (finished) return { value: undefined, done: true }
            await new Promise<void>((resolve) => {
              const onEvent = () => {
                listeners.delete(onEvent)
                signal?.removeEventListener("abort", onAbort)
                resolve()
              }
              const onAbort = () => {
                listeners.delete(onEvent)
                resolve()
              }
              listeners.add(onEvent)
              signal?.addEventListener("abort", onAbort, { once: true })
            })
            if (signal?.aborted) {
              throw new DOMException("Aborted", "AbortError")
            }
          }
          const value = buffer[cursor++]
          return { value, done: false }
        },
      }
    },
  }
}

export function createMockChatTransport(options: {
  store: MemoryChatStore
  stepDelayMs?: number
}): MockChatTransport {
  const stepDelayMs = options.stepDelayMs ?? 35
  const activeTurns = new Map<string, ActiveMockTurn>()
  let jobSeq = 1

  const cancelTurn = async (jobId: string) => {
    const t = activeTurns.get(jobId)
    if (!t) return
    t.cancelled = true
    t.wakeController.abort()
    t.pendingPermission?.resolve("deny")
    await t.donePromise
  }

  options.store.setCancelHandler(cancelTurn)

  return {
    mode: "mock",
    cancelTurn,

    async *sendTurn(target: ChatTurnTarget, body: SendTurnRequest, signal?: AbortSignal) {
      for (const t of activeTurns.values()) {
        if (t.sessionId === body.session_id) {
          throw new HttpTransportError(
            409,
            "turn_in_progress",
            "当前会话上一轮回复仍在进行中，请等待完成或先点击停止。"
          )
        }
      }
      if (body.content.includes("409")) {
        throw new HttpTransportError(
          409,
          "turn_in_progress",
          "当前会话上一轮回复仍在进行中，请等待完成或先点击停止。"
        )
      }
      const jobId = `mock-job-${jobSeq++}`
      const userMsg = options.store.insertUserMessage({
        sessionId: body.session_id,
        content: body.content,
        parts: body.parts ?? [],
        agentJobId: jobId,
      })

      const stream = await createStreamRunner({
        store: options.store,
        sessionId: body.session_id,
        userMessageId: userMsg.id,
        userSeq: userMsg.seq,
        prompt: body.content,
        runtimeId: body.runtime_id,
        target,
        jobId,
        stepDelayMs,
        activeTurns,
        signal,
      })
      yield* stream
    },

    async *regenerate(
      target: ChatTurnTarget,
      body: RegenerateTurnRequest,
      signal?: AbortSignal
    ) {
      for (const t of activeTurns.values()) {
        if (t.sessionId === body.session_id) {
          throw new HttpTransportError(
            409,
            "turn_in_progress",
            "当前会话上一轮回复仍在进行中，请等待完成或先点击停止。"
          )
        }
      }
      const userMsg = options.store.getMessageById(body.session_id, body.user_message_id)
      if (!userMsg) {
        throw new HttpTransportError(422, "invalid_request", "找不到要重新生成的原用户消息")
      }
      const jobId = `mock-job-${jobSeq++}`
      const stream = await createStreamRunner({
        store: options.store,
        sessionId: body.session_id,
        userMessageId: userMsg.id,
        userSeq: userMsg.seq,
        prompt: userMsg.content,
        runtimeId: body.runtime_id,
        target,
        jobId,
        stepDelayMs,
        activeTurns,
        signal,
      })
      yield* stream
    },

    async answerPermission(
      _target: ChatTurnTarget,
      jobId: string,
      requestId: string,
      body: AnswerPermissionRequest
    ) {
      const turn = activeTurns.get(jobId)
      if (turn?.pendingPermission?.requestId === requestId) {
        turn.pendingPermission.resolve(body.decision)
      }
    },
  }
}
