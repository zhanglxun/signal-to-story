import type { MemoryChatStore } from "@/modules/chat/services/chat-session-service"
import type { ChatTransport, ChatTurnTarget } from "@/modules/chat/transport/transport"
import {
  type AnswerPermissionRequest,
  type ChatMessagePart,
  type ChatStreamEvent,
  HttpTransportError,
  type PermissionOption,
  type PlanStepItem,
  type RegenerateTurnRequest,
  type SendTurnRequest,
} from "@/modules/chat/types"

interface ActiveMockTurn {
  jobId: string
  sessionId: string
  cancelled: boolean
  cancelDelayMs: number
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
  permissionTimeoutMs: number
  cancelPersistDelayMs: number
  activeTurns: Map<string, ActiveMockTurn>
  signal?: AbortSignal
}): Promise<AsyncIterable<ChatStreamEvent>> {
  const {
    store,
    sessionId,
    userMessageId,
    userSeq,
    prompt,
    runtimeId,
    target,
    jobId,
    stepDelayMs,
    permissionTimeoutMs,
    cancelPersistDelayMs,
    activeTurns,
    signal,
  } = options

  const lowerPrompt = prompt.toLowerCase()
  const cancelDelayMs =
    cancelPersistDelayMs > 0
      ? cancelPersistDelayMs
      : prompt.includes("延迟停止") || lowerPrompt.includes("slow_cancel")
        ? 2200
        : 0

  let resolveDone!: () => void
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const wakeController = new AbortController()
  const turnState: ActiveMockTurn = {
    jobId,
    sessionId,
    cancelled: false,
    cancelDelayMs,
    wakeController,
    donePromise,
  }
  activeTurns.set(jobId, turnState)
  store.setActiveChatTurnJob(sessionId, { jobId, status: "running" })

  const listeners = new Set<(ev: ChatStreamEvent) => void>()
  const buffer: ChatStreamEvent[] = []
  let finished = false

  const emit = (ev: ChatStreamEvent) => {
    buffer.push(ev)
    for (const fn of listeners) fn(ev)
    if (ev.type === "done") {
      finished = true
    }
  }

  // Background producer keeps running even if the UI reader aborts (disconnect != cancel).
  void (async () => {
    const reasoningParts: string[] = []
    const textParts: string[] = []
    let latestPlanPart: Extract<ChatMessagePart, { type: "plan" }> | null = null
    const toolParts: Extract<ChatMessagePart, { type: "tool_call" }>[] = []
    const permissionParts: Extract<ChatMessagePart, { type: "permission" }>[] = []

    const finalize = (status: "completed" | "cancelled" | "error", errorPart?: ChatMessagePart) => {
      const fullReasoning = reasoningParts.join("")
      const fullText = textParts.join("")
      const parts: ChatMessagePart[] = []
      if (fullReasoning) parts.push({ type: "reasoning", text: fullReasoning })
      if (latestPlanPart) parts.push(latestPlanPart)
      parts.push(...toolParts)
      parts.push(...permissionParts)
      if (fullText) parts.push({ type: "text", text: fullText })
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

      store.setActiveChatTurnJob(sessionId, null)
      activeTurns.delete(jobId)
      // chat.md 2.4 结束规则: persist first; an error turn sends `error` and then `done`.
      if (errorPart?.type === "error") {
        emit({
          type: "error",
          code: errorPart.code,
          message: errorPart.message,
          retryable: errorPart.code !== "budget_exceeded",
          stack: errorPart.stack,
        })
      }
      emit({
        type: "done",
        assistantMessageId: saved.id,
        seq: saved.seq,
        status,
      })
      resolveDone()
    }

    const finishCancelled = async () => {
      if (cancelDelayMs > 0) {
        await wait(cancelDelayMs)
      }
      finalize("cancelled")
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
      if (turnState.cancelled) return await finishCancelled()

      if (prompt.includes("预算") || lowerPrompt.includes("budget")) {
        const chunk = "正在分析输入内容，准备生成结构化建议…"
        textParts.push(chunk)
        emit({ type: "text_delta", delta: chunk })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return await finishCancelled()
        return finalize("error", {
          type: "error",
          code: "budget_exceeded",
          message: "单轮费用已达上限（50 / 50 分），系统已自动中止后续模型调用。",
        })
      }

      if (prompt.includes("报错") || lowerPrompt.includes("error")) {
        const reason = "正在准备调用远端推理接口…"
        reasoningParts.push(reason)
        emit({ type: "reasoning_delta", delta: reason })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return await finishCancelled()
        return finalize("error", {
          type: "error",
          code: "upstream_error",
          message: "模拟上游模型流中断，可点击重新生成或切换模型重试。",
          stack:
            "Error: Upstream stream closed unexpectedly\n  at MockStreamDriver.next (mock-transport.ts:185:9)\n  at async runChatTurn (chat-turn.ts:94:15)",
        })
      }

      if (prompt.includes("权限超时") || lowerPrompt.includes("perm_timeout")) {
        const reason = "准备触发高风险写操作，等待用户确认（本脚本模拟 5 分钟超时自动按拒绝处理）。"
        reasoningParts.push(reason)
        emit({ type: "reasoning_delta", delta: reason })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return await finishCancelled()

        const reqId = `perm-timeout-${Date.now()}`
        const permSummary = "是否允许发布或入队高成本任务（若超时未操作将自动拒绝）？"
        const permOptions: PermissionOption[] = [
          { id: "allow_once", label: "仅本次允许", kind: "allow" },
          { id: "reject_once", label: "拒绝本次", kind: "deny" },
        ]
        emit({
          type: "permission_request",
          requestId: reqId,
          action: "enqueue_content_draft",
          summary: permSummary,
          options: permOptions,
        })

        const decision = await new Promise<"allow" | "deny" | "timeout">((resolve) => {
          const timer = setTimeout(() => {
            turnState.pendingPermission = undefined
            resolve("timeout")
          }, permissionTimeoutMs)
          turnState.pendingPermission = {
            requestId: reqId,
            resolve: (choice) => {
              clearTimeout(timer)
              resolve(choice)
            },
          }
        })
        turnState.pendingPermission = undefined
        if (turnState.cancelled) return await finishCancelled()

        permissionParts.push({
          type: "permission",
          requestId: reqId,
          action: "enqueue_content_draft",
          summary: permSummary,
          options: permOptions,
          decision,
        })

        const answerText =
          decision === "timeout"
            ? "⏱️ 权限确认已超时（按拒绝处理），本次高风险操作已自动跳过。"
            : decision === "allow"
              ? "✅ 已收到你的**允许**确认，将继续执行后续操作。"
              : "⛔ 已按你的**拒绝**决定跳过该操作。"
        textParts.push(answerText)
        emit({ type: "text_delta", delta: answerText })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return await finishCancelled()
        return finalize("completed")
      }

      if (prompt.includes("权限") || prompt.includes("审批")) {
        const r1 = "检测到你希望执行带成本的出稿操作，按 Mandate 安全策略需先向你发起确认。"
        reasoningParts.push(r1)
        emit({ type: "reasoning_delta", delta: r1 })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return await finishCancelled()

        const reqId = `perm-${Date.now()}`
        const permSummary = "是否允许入队后台 content_draft 任务（预计消耗模型额度）？"
        const permOptions: PermissionOption[] = [
          { id: "allow_once", label: "仅本次允许", kind: "allow" },
          { id: "reject_once", label: "拒绝执行", kind: "deny" },
        ]
        emit({
          type: "permission_request",
          requestId: reqId,
          action: "enqueue_content_draft",
          summary: permSummary,
          options: permOptions,
        })

        const decision = await new Promise<"allow" | "deny">((resolve) => {
          turnState.pendingPermission = { requestId: reqId, resolve }
        })
        turnState.pendingPermission = undefined
        if (turnState.cancelled) return await finishCancelled()

        permissionParts.push({
          type: "permission",
          requestId: reqId,
          action: "enqueue_content_draft",
          summary: permSummary,
          options: permOptions,
          decision,
        })

        const answerText =
          decision === "allow"
            ? "✅ 已收到你的**允许**确认：后续真实后端将把该稿件任务写入 `agent_jobs` 队列并留痕。"
            : "⛔ 已按你的**拒绝**决定跳过操作，未触发任何队列任务或费用支出。"
        textParts.push(answerText)
        emit({ type: "text_delta", delta: answerText })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return await finishCancelled()
        return finalize("completed")
      }

      if (
        prompt.includes("计划") ||
        prompt.includes("工具") ||
        lowerPrompt.includes("plan") ||
        lowerPrompt.includes("tool")
      ) {
        const thought = "正在拆分执行步骤，并依次调用工作台只读工具与外部抓取工具。"
        reasoningParts.push(thought)
        emit({ type: "reasoning_delta", delta: thought })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return await finishCancelled()

        const steps1: PlanStepItem[] = [
          { id: "s1", title: "读取当前事项 Brief 与目标", status: "in_progress" },
          { id: "s2", title: "抓取外部参考信源原文", status: "pending" },
          { id: "s3", title: "核对平台规范与字数约束", status: "pending" },
          { id: "s4", title: "生成待人工审阅的提案草稿", status: "pending" },
        ]
        latestPlanPart = { type: "plan", steps: steps1 }
        emit({ type: "plan_update", steps: steps1 })

        const call1Input = '{"work_item_id":"mock-wi-1","include_docs":true}'
        emit({
          type: "tool_start",
          callId: "call-1",
          name: "read_work_item",
          inputSummary: call1Input,
        })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return await finishCancelled()

        const call1Output = "已读取事项《为什么个人内容创作者需要 Agent Harness》及 2 篇关联稿件摘要"
        emit({
          type: "tool_end",
          callId: "call-1",
          status: "succeeded",
          outputSummary: call1Output,
        })
        toolParts.push({
          type: "tool_call",
          callId: "call-1",
          name: "read_work_item",
          state: "succeeded",
          inputSummary: call1Input,
          outputSummary: call1Output,
        })

        const steps2: PlanStepItem[] = [
          { id: "s1", title: "读取当前事项 Brief 与目标", status: "completed" },
          { id: "s2", title: "抓取外部参考信源原文", status: "in_progress" },
          { id: "s3", title: "核对平台规范与字数约束", status: "pending" },
          { id: "s4", title: "生成待人工审阅的提案草稿", status: "pending" },
        ]
        latestPlanPart = { type: "plan", steps: steps2 }
        emit({ type: "plan_update", steps: steps2 })

        const call2Input = '{"url":"https://story.susense.cn/demo","timeout_ms":5000}'
        emit({
          type: "tool_start",
          callId: "call-2",
          name: "fetch_reference",
          inputSummary: call2Input,
        })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return await finishCancelled()

        const call2Output = "HTTP 504 Gateway Timeout"
        const call2Error = "抓取信源超时：目标站点在 5000ms 内未响应"
        const call2Stack =
          "FetchTimeoutError: Request timed out after 5000ms\n" +
          "  at fetchReferenceTool (workers/agent/handlers/chat-turn.ts:142:11)\n" +
          "  at async executeToolCall (workers/agent/drivers/pi-cloud.ts:88:14)"
        emit({
          type: "tool_end",
          callId: "call-2",
          status: "failed",
          outputSummary: call2Output,
          error: call2Error,
          stackTrace: call2Stack,
        })
        toolParts.push({
          type: "tool_call",
          callId: "call-2",
          name: "fetch_reference",
          state: "failed",
          inputSummary: call2Input,
          outputSummary: call2Output,
          error: call2Error,
          stackTrace: call2Stack,
        })

        const steps3: PlanStepItem[] = [
          { id: "s1", title: "读取当前事项 Brief 与目标", status: "completed" },
          { id: "s2", title: "抓取外部参考信源原文", status: "failed" },
          { id: "s3", title: "核对平台规范与字数约束", status: "completed" },
          { id: "s4", title: "生成待人工审阅的提案草稿", status: "pending" },
        ]
        latestPlanPart = { type: "plan", steps: steps3 }
        emit({ type: "plan_update", steps: steps3 })
        await wait(stepDelayMs, wakeController.signal)
        if (turnState.cancelled) return await finishCancelled()

        const summaryText =
          "已完成本地事项读取，但外部参考链接抓取超时；你可以展开上方工具调用栈查看详情，或补充正文摘录后继续。"
        textParts.push(summaryText)
        emit({ type: "text_delta", delta: summaryText })

        emit({
          type: "usage",
          inputTokens: Math.max(48, prompt.length * 2),
          outputTokens: Math.max(32, Math.ceil(summaryText.length / 2)),
          costCents: 0.3,
          durationMs: Math.max(160, stepDelayMs * 5),
          model: runtimeId,
        })
        return finalize("completed")
      }

      const thoughtChunks = [
        "1. 解析用户输入与已挂载的上下文参考；",
        "2. 组织结构化 Markdown 回答，并遵守仅提案、不越权原则。",
      ]
      for (const tc of thoughtChunks) {
        if (turnState.cancelled) return await finishCancelled()
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
        if (turnState.cancelled) return await finishCancelled()
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
  permissionTimeoutMs?: number
  cancelPersistDelayMs?: number
}): MockChatTransport {
  const stepDelayMs = options.stepDelayMs ?? 35
  const permissionTimeoutMs = options.permissionTimeoutMs ?? Math.max(stepDelayMs * 10, 1200)
  const cancelPersistDelayMs = options.cancelPersistDelayMs ?? 0
  const activeTurns = new Map<string, ActiveMockTurn>()
  let jobSeq = 1

  const cancelTurn = async (jobId: string) => {
    const t = activeTurns.get(jobId)
    if (!t) return
    t.cancelled = true
    t.wakeController.abort()
    t.pendingPermission?.resolve("deny")
    if (t.cancelDelayMs > 0) {
      return
    }
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
        permissionTimeoutMs,
        cancelPersistDelayMs,
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
        permissionTimeoutMs,
        cancelPersistDelayMs,
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
