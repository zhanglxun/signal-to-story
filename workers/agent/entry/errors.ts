/**
 * Pre-stream errors of the chat HTTP entry (docs/modules/chat.md 2.4): plain HTTP status + { code, message }.
 * Once the stream started, errors are `error` events instead.
 */
import type { DbError } from "../backends/chat-db"

export type HttpErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "turn_in_progress"
  | "claim_failed"
  | "invalid_request"
  | "rate_limited"
  | "runtime_unavailable"
  | "internal_error"

const STATUS: Record<HttpErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  turn_in_progress: 409,
  claim_failed: 409,
  invalid_request: 422,
  rate_limited: 429,
  runtime_unavailable: 503,
  internal_error: 500,
}

export class HttpError extends Error {
  readonly code: HttpErrorCode
  readonly status: number
  constructor(code: HttpErrorCode, message: string) {
    super(message)
    this.name = "HttpError"
    this.code = code
    this.status = STATUS[code]
  }
}

/**
 * Database error → HTTP (next-phase.md T3b conventions):
 *  - SQLSTATE 23505 with hint turn_in_progress → 409 turn_in_progress
 *  - 42501 (insufficient privilege, raised by the RPCs' own checks) → 403 forbidden
 *  - 23514 check_violation / 22P02 invalid text representation / P0002 no data → 422 invalid_request
 *  - anything else → 500 internal_error (message not echoed: it may contain SQL details)
 */
export function mapDbError(error: DbError): HttpError {
  if (error.code === "23505" && error.hint === "turn_in_progress") {
    return new HttpError("turn_in_progress", error.message || "上一轮还在生成，请等它结束或先停止")
  }
  if (error.code === "42501") return new HttpError("forbidden", error.message || "没有权限")
  if (error.code === "23514" || error.code === "22P02" || error.code === "P0002" || error.code === "22023") {
    return new HttpError("invalid_request", error.message || "请求无效")
  }
  return new HttpError("internal_error", "数据库调用失败，请稍后重试")
}
