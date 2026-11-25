import { HttpTransportError } from "@/modules/chat/types"

/** What the UI should offer next to a failed turn. */
export type TurnErrorAction = "relogin"

export interface TurnErrorInfo {
  code: string
  message: string
  retryable?: boolean
  stack?: string
  action?: TurnErrorAction
}

/** Client-side codes (never sent by the node): the browser could not reach the node at all. */
export const NODE_UNREACHABLE = "node_unreachable"
export const NODE_MISMATCH = "node_mismatch"

export function nodeUnreachableError(endpointHint: string): HttpTransportError {
  return new HttpTransportError(
    0,
    NODE_UNREACHABLE,
    `节点不可达：无法连接 ${endpointHint || "（未配置地址）"}。请确认节点已启动、地址可从当前浏览器访问后重试。`
  )
}

/**
 * Maps a failure before the SSE stream started (docs/modules/chat.md 2.4「HTTP 接口约定 v1」and
 * the T3b additions) to the text shown in the chat. Errors after the stream started arrive as
 * `error` events and are shown as sent.
 */
export function describePreStreamError(err: unknown): TurnErrorInfo {
  if (!(err instanceof HttpTransportError)) {
    return {
      code: NODE_UNREACHABLE,
      message: `节点不可达：${err instanceof Error ? err.message : "网络请求失败"}。请确认节点已启动、地址可访问后重试。`,
      retryable: true,
    }
  }
  const { status, code, message } = err
  if (status === 0) {
    return { code, message, retryable: code === NODE_UNREACHABLE }
  }
  if (status === 401) {
    return {
      code: "unauthorized",
      message: "登录状态已失效，请重新登录后再试。",
      retryable: false,
      action: "relogin",
    }
  }
  if (status === 403) {
    return {
      code: "forbidden",
      message: `没有权限在该节点发起对话（forbidden）：${message}`,
      retryable: false,
    }
  }
  if (status === 409 && code === "turn_in_progress") {
    return {
      code,
      message: "当前会话上一轮回复仍在进行中（409 turn_in_progress），请等待完成或停止后再试。",
      retryable: false,
    }
  }
  if (status === 409 && code === "claim_failed") {
    return {
      code,
      message: "节点未能认领该回合（409 claim_failed），请重试；若反复出现，请检查节点的 SENSE_NODE_ID 配置。",
      retryable: true,
    }
  }
  if (status === 422) {
    return {
      code: "invalid_request",
      message: `请求无效（422 invalid_request）：${message}。所选运行时可能已不在该节点上，请重新选择模型。`,
      retryable: false,
    }
  }
  if (status === 429) {
    return {
      code: "rate_limited",
      message: `请求过于频繁（429 rate_limited）：${message}`,
      retryable: true,
    }
  }
  if (status === 503) {
    return {
      code: "runtime_unavailable",
      message: `运行时暂不可用（503 runtime_unavailable）：${message}。可稍后重试或切换到其他模型。`,
      retryable: true,
    }
  }
  return {
    code,
    message: `节点请求失败（HTTP ${status} ${code}）：${message}`,
    retryable: status >= 500,
  }
}

/** Text for a turn error, with special wording for the codes users can act on. */
export function formatErrorDisplayText(code: string, message: string): string {
  if (code === "budget_exceeded") {
    return "单轮费用已达上限（budget_exceeded），已自动停止生成。建议缩小上下文或拆分问题后重试。"
  }
  if (code === "persist_failed") {
    return `回复未能保存（persist_failed）：${message}。这一轮的结果没有写入会话，请重新生成。`
  }
  return message
}
