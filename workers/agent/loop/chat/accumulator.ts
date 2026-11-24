/**
 * Folds the event stream of one turn into what gets stored: chat_messages.content (plain text) and
 * chat_messages.parts (structured blocks), within the database limits (content ≤ 200 000 chars,
 * parts ≤ 256 KB — DB3 / DB3b).
 */
import type { ChatStreamEvent, ErrorPart, MessagePart, PermissionPart, ToolCallPart, TurnStatus } from "./events"

export const MAX_CONTENT_CHARS = 200_000
export const MAX_PARTS_BYTES = 250_000 // a little under the 256 KB column check

const byteSize = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length

export interface AccumulatedMessage {
  content: string
  parts: MessagePart[]
  truncated: boolean
}

export class PartsAccumulator {
  private readonly parts: MessagePart[] = []

  apply(event: ChatStreamEvent): void {
    const last = this.parts.at(-1)
    switch (event.type) {
      case "text_delta":
        if (last?.type === "text") last.text += event.delta
        else this.parts.push({ type: "text", text: event.delta })
        return
      case "reasoning_delta":
        if (last?.type === "reasoning") last.text += event.delta
        else this.parts.push({ type: "reasoning", text: event.delta })
        return
      case "plan_update": {
        const existing = this.parts.find((p) => p.type === "plan")
        if (existing && existing.type === "plan") existing.steps = event.steps.map((s) => ({ ...s }))
        else this.parts.push({ type: "plan", steps: event.steps.map((s) => ({ ...s })) })
        return
      }
      case "tool_start":
        this.parts.push({ type: "tool_call", callId: event.callId, name: event.name, state: "running", inputSummary: event.inputSummary })
        return
      case "tool_end": {
        const call = this.parts.find((p): p is ToolCallPart => p.type === "tool_call" && p.callId === event.callId)
        if (!call) return
        call.state = event.status
        call.outputSummary = event.outputSummary
        if (event.error) call.error = event.error
        if (event.stackTrace) call.stackTrace = event.stackTrace
        return
      }
      case "permission_request":
        this.parts.push({ type: "permission", requestId: event.requestId, action: event.action, summary: event.summary, options: event.options })
        return
      case "error":
        this.parts.push({ type: "error", code: event.code, message: event.message, ...(event.stack ? { stack: event.stack } : {}) })
        return
      default:
        return // turn_start / usage / done are not stored as parts
    }
  }

  setPermissionDecision(requestId: string, decision: NonNullable<PermissionPart["decision"]>): void {
    const part = this.parts.find((p): p is PermissionPart => p.type === "permission" && p.requestId === requestId)
    if (part) part.decision = decision
  }

  /** Marks tool calls still running (cancel / crash) as failed so the stored state is final. */
  private closeDangling(status: TurnStatus): void {
    for (const p of this.parts) {
      if (p.type === "tool_call" && p.state === "running") {
        p.state = "failed"
        p.error = p.error ?? (status === "cancelled" ? "已中断" : "未完成")
      }
    }
  }

  finalize(status: TurnStatus, error?: ErrorPart): AccumulatedMessage {
    this.closeDangling(status)
    const parts: MessagePart[] = this.parts.map((p) => structuredClone(p))
    if (error && !parts.some((p) => p.type === "error")) parts.push({ ...error })
    let truncated = false

    let content = parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")
    if (content.length > MAX_CONTENT_CHARS) {
      content = content.slice(0, MAX_CONTENT_CHARS - 20) + "\n…（内容过长已截断）"
      truncated = true
    }
    if (!content.trim()) {
      content = status === "cancelled" ? "（已停止生成）" : status === "error" ? `（生成失败：${error?.message ?? "未知错误"}）`.slice(0, 2000) : "（无文本输出）"
    }

    // Shrink parts to fit: reasoning first, then tool outputs / stack traces, then text copies.
    const shrink = (pred: (p: MessagePart) => boolean, edit: (p: MessagePart) => void) => {
      for (const p of parts) {
        if (byteSize(parts) <= MAX_PARTS_BYTES) return
        if (pred(p)) {
          edit(p)
          truncated = true
        }
      }
    }
    shrink((p) => p.type === "reasoning", (p) => { (p as { text: string }).text = "（思考过程过长，未保存）" })
    shrink((p) => p.type === "tool_call", (p) => {
      const t = p as ToolCallPart
      delete t.stackTrace
      if (t.outputSummary && t.outputSummary.length > 500) t.outputSummary = t.outputSummary.slice(0, 500) + "…"
    })
    shrink((p) => p.type === "error", (p) => { delete (p as ErrorPart).stack })
    shrink((p) => p.type === "text", (p) => { (p as { text: string }).text = (p as { text: string }).text.slice(0, 20_000) + "…（完整正文见 content）" })

    return { content, parts, truncated }
  }
}
