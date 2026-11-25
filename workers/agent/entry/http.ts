/**
 * Chat HTTP/SSE entry of workers/agent (docs/modules/chat.md 2.4「HTTP 接口约定 v1」, architecture.md 6.5).
 * Plain node:http, no framework.
 *
 *   POST /v1/chat/turns                                     send one turn and stream it
 *   POST /v1/chat/turns/regenerate                          regenerate the answer to a user message
 *   POST /v1/chat/turns/{job_id}/permissions/{request_id}  answer a permission_request (204)
 *   GET  /v1/health                                         { protocol_version: 1, node_id } (no auth)
 *
 * Per turn: verify the JWT → as the USER (RLS) send_chat_message / regenerate_chat_turn with
 * p_target_node_id = this node → with the NODE token node_claim_job → SSE stream (handlers/chat-turn).
 * The browser's JWT is used only for the user-level RPCs and the chat tools; the model never sees it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import type { ClaimedChatJob, NodeChatApi, UserDataApi, VerifiedUser } from "../backends/chat-db"
import { type ChatTurnLogger, handleChatTurn } from "../handlers/chat-turn"
import { RUNTIME_ID_PATTERN } from "../runtime-registry"
import { HttpError, mapDbError } from "./errors"
import { PermissionBroker } from "./permissions"
import type { ChatRuntimeResolver } from "./runtimes"
import { SseWriter, startSse } from "./sse"

export const HTTP_PROTOCOL_VERSION = 1

export interface ChatHttpOptions {
  nodeId: string
  /** node_* RPCs with this node's token. */
  node: NodeChatApi
  /** Returns null for an invalid, expired or anonymous token. */
  verifyUser(token: string): Promise<VerifiedUser | null>
  /** Data access as the requesting user (publishable key + their JWT). */
  userData(accessToken: string, user: VerifiedUser): UserDataApi
  runtimes: ChatRuntimeResolver
  /** Exact origins allowed besides localhost / 127.0.0.1 / [::1] (any port), e.g. the console domain. */
  allowedOrigins?: readonly string[]
  leaseSeconds?: number
  /** Concurrent turns per user on this node (default 2). */
  maxConcurrentTurnsPerUser?: number
  /** Turn requests per user per minute (default 20). */
  turnsPerMinute?: number
  /** Passed in p_runtime; the database clamps budget_cents to 1–500 and max_rounds to 1–20. */
  turnLimits?: { budgetCents?: number; maxRounds?: number }
  permissionTimeoutMs?: number
  heartbeatIntervalMs?: number
  pingIntervalMs?: number
  maxBodyBytes?: number
  usageFlushTimeoutMs?: number
  /** Process shutdown: running turns stop and are persisted as cancelled. */
  shutdownSignal?: AbortSignal
  logger?: ChatTurnLogger
}

export interface ChatHttpServer {
  server: Server
  permissions: PermissionBroker
  /** Turns currently streaming or finishing on this node. */
  readonly activeTurns: number
  /** Resolves once every running turn has been persisted (tests, graceful shutdown). */
  idle(): Promise<void>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const THINKING = new Set(["off", "low", "medium", "high"])
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
const silent: ChatTurnLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  if (LOCAL_HOSTS.has(url.hostname)) return true
  return allowed.some((a) => a.replace(/\/+$/, "") === url.origin)
}

// ── Request bodies ───────────────────────────────────────────────────────────────────────────────

export interface TurnRequest {
  sessionId: string
  runtimeId: string
  thinkingEffort: string
  content: string
  parts: Array<{ type: "context_ref"; kind: "work_item" | "document"; id: string; label: string }>
}
export interface RegenerateRequest {
  sessionId: string
  runtimeId: string
  thinkingEffort: string
  userMessageId: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const bad = (message: string) => new HttpError("invalid_request", message)

function common(body: Record<string, unknown>) {
  if (typeof body.session_id !== "string" || !UUID.test(body.session_id)) throw bad("session_id 应为 uuid")
  if (typeof body.runtime_id !== "string" || !RUNTIME_ID_PATTERN.test(body.runtime_id)) throw bad("runtime_id 格式无效")
  if (body.thinking_effort !== undefined && (typeof body.thinking_effort !== "string" || !THINKING.has(body.thinking_effort))) {
    throw bad("thinking_effort 应为 off / low / medium / high")
  }
  return { sessionId: body.session_id, runtimeId: body.runtime_id, thinkingEffort: (body.thinking_effort as string | undefined) ?? "off" }
}

export function parseTurnRequest(body: unknown): TurnRequest {
  if (!isObj(body)) throw bad("请求体应为 JSON 对象")
  const base = common(body)
  if (typeof body.content !== "string" || !body.content.trim() || body.content.length > 200_000) throw bad("content 需为 1–200000 字")
  const rawParts = body.parts ?? []
  if (!Array.isArray(rawParts) || rawParts.length > 20) throw bad("parts 应为不超过 20 项的数组")
  const parts = rawParts.map((p) => {
    if (!isObj(p) || p.type !== "context_ref" || (p.kind !== "work_item" && p.kind !== "document")) throw bad("parts 只接受 context_ref 引用")
    if (typeof p.id !== "string" || !UUID.test(p.id)) throw bad("引用 id 应为 uuid")
    if (typeof p.label !== "string" || p.label.length > 200) throw bad("引用 label 应为不超过 200 字的字符串")
    return { type: "context_ref" as const, kind: p.kind as "work_item" | "document", id: p.id, label: p.label }
  })
  return { ...base, content: body.content, parts }
}

export function parseRegenerateRequest(body: unknown): RegenerateRequest {
  if (!isObj(body)) throw bad("请求体应为 JSON 对象")
  const base = common(body)
  if (typeof body.user_message_id !== "string" || !UUID.test(body.user_message_id)) throw bad("user_message_id 应为 uuid")
  return { ...base, userMessageId: body.user_message_id }
}

// ── Rate limiting ────────────────────────────────────────────────────────────────────────────────

/** Sliding one-minute window per user. */
export class UserRateLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly perMinute: number
  private readonly now: () => number
  constructor(perMinute: number, now: () => number = Date.now) {
    this.perMinute = perMinute
    this.now = now
  }
  take(userId: string): boolean {
    const t = this.now()
    const recent = (this.hits.get(userId) ?? []).filter((h) => t - h < 60_000)
    if (recent.length >= this.perMinute) {
      this.hits.set(userId, recent)
      return false
    }
    recent.push(t)
    this.hits.set(userId, recent)
    return true
  }
}

// ── Server ───────────────────────────────────────────────────────────────────────────────────────

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > limit) throw bad(`请求体超过 ${limit} 字节`)
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw bad("请求体不是合法 JSON")
  }
}

function bearer(req: IncomingMessage): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? "")
  return m ? m[1] : null
}

export function createChatHttpServer(options: ChatHttpOptions): ChatHttpServer {
  const log = options.logger ?? silent
  const allowed = options.allowedOrigins ?? []
  const lease = options.leaseSeconds ?? 120
  const maxConcurrent = options.maxConcurrentTurnsPerUser ?? 2
  const limiter = new UserRateLimiter(options.turnsPerMinute ?? 20)
  const maxBody = options.maxBodyBytes ?? 512 * 1024
  const broker = new PermissionBroker({ timeoutMs: options.permissionTimeoutMs })
  const activeByUser = new Map<string, number>()
  const running = new Set<Promise<unknown>>()

  const corsHeaders = (req: IncomingMessage): Record<string, string> => {
    const origin = req.headers.origin
    return origin && isAllowedOrigin(origin, allowed) ? { "access-control-allow-origin": origin, vary: "Origin" } : { vary: "Origin" }
  }

  const sendJson = (req: IncomingMessage, res: ServerResponse, status: number, body: unknown) => {
    if (res.headersSent) return
    res.writeHead(status, { ...corsHeaders(req), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    res.end(JSON.stringify(body))
  }
  const sendError = (req: IncomingMessage, res: ServerResponse, error: HttpError) => sendJson(req, res, error.status, { code: error.code, message: error.message })

  const authenticate = async (req: IncomingMessage) => {
    const token = bearer(req)
    if (!token) throw new HttpError("unauthorized", "缺少登录凭证")
    let user: VerifiedUser | null
    try {
      user = await options.verifyUser(token)
    } catch (error) {
      log.warn("jwt verification failed", { error: error instanceof Error ? error.message : String(error) })
      user = null
    }
    if (!user) throw new HttpError("unauthorized", "登录已失效，请重新登录")
    return { token, user }
  }

  const reserve = (userId: string) => {
    const n = activeByUser.get(userId) ?? 0
    if (n >= maxConcurrent) throw new HttpError("rate_limited", `每个用户同时最多 ${maxConcurrent} 个回合`)
    activeByUser.set(userId, n + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const left = (activeByUser.get(userId) ?? 1) - 1
      if (left <= 0) activeByUser.delete(userId)
      else activeByUser.set(userId, left)
    }
  }

  /** Shared by send and regenerate: enqueue as the user, claim as the node, then stream. */
  const runTurn = async (req: IncomingMessage, res: ServerResponse, regenerate: boolean) => {
    const { token, user } = await authenticate(req)
    if (!limiter.take(user.id)) throw new HttpError("rate_limited", "请求过于频繁，请稍后再试")
    const body = await readJson(req, maxBody)
    const parsed = regenerate ? parseRegenerateRequest(body) : parseTurnRequest(body)
    const availability = options.runtimes.availability(parsed.runtimeId)
    if (availability === "unknown") throw bad(`本节点没有运行时 ${parsed.runtimeId}`)
    if (availability === "unavailable") throw new HttpError("runtime_unavailable", `运行时 ${parsed.runtimeId} 当前不可用`)
    const runtime = options.runtimes.create(parsed.runtimeId)

    const release = reserve(user.id)
    try {
      const userDb = options.userData(token, user)
      const pRuntime = {
        runtime_id: parsed.runtimeId,
        driver_kind: runtime.kind,
        thinking_effort: parsed.thinkingEffort,
        ...(options.turnLimits?.budgetCents !== undefined ? { budget_cents: options.turnLimits.budgetCents } : {}),
        ...(options.turnLimits?.maxRounds !== undefined ? { max_rounds: options.turnLimits.maxRounds } : {}),
      }
      const { data, error } = regenerate
        ? await userDb.rpc<{ message_id: string; seq: number; agent_job_id: string | null }>("regenerate_chat_turn", {
            p_session_id: parsed.sessionId,
            p_user_message_id: (parsed as RegenerateRequest).userMessageId,
            p_runtime: pRuntime,
            p_target_node_id: options.nodeId,
          })
        : await userDb.rpc<{ message_id: string; seq: number; agent_job_id: string | null }>("send_chat_message", {
            p_session_id: parsed.sessionId,
            p_content: (parsed as TurnRequest).content,
            p_run_agent: true,
            p_parts: (parsed as TurnRequest).parts,
            p_runtime: pRuntime,
            p_target_node_id: options.nodeId,
          })
      if (error) throw mapDbError(error)
      const jobId = data?.agent_job_id
      if (!jobId) throw new HttpError("internal_error", "数据库没有返回回合任务")

      let claimed: ClaimedChatJob | null
      try {
        claimed = await options.node.claimJob(jobId, lease)
      } catch (claimError) {
        log.error("node_claim_job failed", { job_id: jobId, error: claimError instanceof Error ? claimError.message : String(claimError) })
        claimed = null
      }
      if (!claimed) {
        // Free the session at once instead of leaving it locked until the 10-minute expiry.
        const cancel = await userDb.rpc("cancel_agent_job", { p_job_id: jobId })
        if (cancel.error) log.warn("could not cancel the unclaimed turn", { job_id: jobId, error: cancel.error.message })
        throw new HttpError("claim_failed", "本节点未能认领该回合，请重试")
      }
      if (regenerate) {
        try {
          await options.runtimes.prepareRegenerate(parsed.sessionId, parsed.runtimeId)
        } catch (prepError) {
          log.warn("prepareRegenerate failed", { job_id: jobId, error: prepError instanceof Error ? prepError.message : String(prepError) })
        }
      }

      startSse(res, corsHeaders(req))
      const writer = new SseWriter(res, { pingIntervalMs: options.pingIntervalMs })
      writer.onDisconnect(() => {
        // Not a cancel: the turn keeps running and is persisted. Nobody can answer its permission asks now.
        log.info("client disconnected; turn continues", { job_id: jobId })
        broker.denyJob(jobId)
      })
      const turn = handleChatTurn({
        job: claimed,
        nodeId: options.nodeId,
        node: options.node,
        user: userDb,
        runtime,
        emit: (event) => writer.send(event),
        awaitPermission: async (requestId, signal) => (writer.isClosed ? "deny" : broker.wait(jobId, requestId, user.id, signal)),
        leaseSeconds: lease,
        heartbeatIntervalMs: options.heartbeatIntervalMs,
        shutdownSignal: options.shutdownSignal,
        logger: log,
        usageFlushTimeoutMs: options.usageFlushTimeoutMs,
      })
      running.add(turn)
      try {
        await turn
      } finally {
        running.delete(turn)
        writer.end()
      }
    } finally {
      release()
    }
  }

  const answerPermission = async (req: IncomingMessage, res: ServerResponse, jobId: string, requestId: string) => {
    const { user } = await authenticate(req)
    const body = await readJson(req, 4096)
    const decision = isObj(body) ? body.decision : undefined
    if (decision !== "allow" && decision !== "deny") throw bad("decision 应为 allow 或 deny")
    const result = broker.answer(jobId, requestId, user.id, decision)
    if (result === "not_found") throw new HttpError("not_found", "该确认请求不存在、已超时或不在本节点")
    if (result === "forbidden") throw new HttpError("forbidden", "只能回答自己回合的确认请求")
    res.writeHead(204, corsHeaders(req))
    res.end()
  }

  const route = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://node.invalid")
    const path = url.pathname.replace(/\/+$/, "") || "/"
    const origin = req.headers.origin
    if (origin && !isAllowedOrigin(origin, allowed)) {
      if (req.method === "OPTIONS") {
        res.writeHead(403, { vary: "Origin" })
        res.end()
        return
      }
      throw new HttpError("forbidden", "该来源不在允许列表中")
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...corsHeaders(req),
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-max-age": "600",
      })
      res.end()
      return
    }
    if (path === "/v1/health") {
      if (req.method !== "GET") throw new HttpError("method_not_allowed", "只支持 GET")
      sendJson(req, res, 200, { protocol_version: HTTP_PROTOCOL_VERSION, node_id: options.nodeId })
      return
    }
    if (path === "/v1/chat/turns" || path === "/v1/chat/turns/regenerate") {
      if (req.method !== "POST") throw new HttpError("method_not_allowed", "只支持 POST")
      await runTurn(req, res, path.endsWith("/regenerate"))
      return
    }
    const perm = /^\/v1\/chat\/turns\/([^/]+)\/permissions\/([^/]+)$/.exec(path)
    if (perm) {
      if (req.method !== "POST") throw new HttpError("method_not_allowed", "只支持 POST")
      const [jobId, requestId] = [decodeURIComponent(perm[1]), decodeURIComponent(perm[2])]
      if (!UUID.test(jobId) || requestId.length > 100) throw new HttpError("not_found", "该确认请求不存在")
      await answerPermission(req, res, jobId, requestId)
      return
    }
    throw new HttpError("not_found", "接口不存在")
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        if (error.status >= 500) log.error("request failed", { code: error.code, message: error.message })
        return sendError(req, res, error)
      }
      log.error("unhandled request error", { error: error instanceof Error ? error.message : String(error) })
      if (!res.headersSent) sendError(req, res, new HttpError("internal_error", "服务内部错误"))
      else if (!res.writableEnded) res.end()
    })
  })

  return {
    server,
    permissions: broker,
    get activeTurns() {
      return running.size
    },
    async idle() {
      while (running.size) await Promise.allSettled([...running])
    },
  }
}

/** Starts listening; resolves with the bound port (0 = ephemeral, for tests). */
export function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      const address = server.address()
      resolve(typeof address === "object" && address ? address.port : port)
    })
  })
}
