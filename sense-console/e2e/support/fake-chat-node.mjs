#!/usr/bin/env node
/**
 * Test double for the chat e2e (e2e/chat-fake-node.spec.ts). One process, two loopback ports, one
 * in-memory state:
 *
 *   - a fake Supabase (auth + the PostgREST tables / RPC the chat page reads), so no real project
 *     or credentials are needed;
 *   - a fake workers/agent node serving the frozen HTTP contract v1 (docs/modules/chat.md 2.4):
 *     GET /v1/health, POST /v1/chat/turns, POST /v1/chat/turns/regenerate, scripted SSE turns.
 *
 * It imports nothing from workers/. It only answers on 127.0.0.1 and holds no real data.
 * Env: FAKE_SUPABASE_PORT (default 54329), FAKE_NODE_PORT (default 4319).
 */
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"

const SUPABASE_PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 54329)
const NODE_PORT = Number(process.env.FAKE_NODE_PORT ?? 4319)
const HOST = "127.0.0.1"

const ORG_ID = "00000000-0000-4000-8000-0000000000a1"
const NODE_ID = "00000000-0000-4000-8000-0000000000b1"
const USER = { id: "00000000-0000-4000-8000-0000000000c1", email: "e2e-operator@example.test" }
const RUNTIME_ID = "api:fake:scripted"

/** In-memory "database". */
const db = {
  tokens: new Set(),
  sessions: [],
  messages: [],
  jobs: [],
}

const now = () => new Date().toISOString()

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function issueSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub: USER.id,
    email: USER.email,
    role: "authenticated",
    aud: "authenticated",
    exp,
  })}.fake-signature`
  db.tokens.add(accessToken)
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: randomUUID(),
    user: authUser(),
  }
}

function authUser() {
  return {
    id: USER.id,
    aud: "authenticated",
    role: "authenticated",
    email: USER.email,
    app_metadata: { provider: "email" },
    user_metadata: { display_name: "E2E Operator" },
    created_at: "2026-11-01T00:00:00Z",
  }
}

function bearer(req) {
  const header = req.headers.authorization ?? ""
  return header.startsWith("Bearer ") ? header.slice(7) : ""
}

function cors(req, res) {
  res.setHeader("access-control-allow-origin", req.headers.origin ?? "*")
  res.setHeader("access-control-allow-credentials", "true")
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS")
  res.setHeader(
    "access-control-allow-headers",
    req.headers["access-control-request-headers"] ?? "authorization, content-type"
  )
  res.setHeader("access-control-expose-headers", "content-range")
  res.setHeader("vary", "Origin")
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(body === undefined ? "" : JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString("utf8")
  return text ? JSON.parse(text) : {}
}

// ── fake Supabase ────────────────────────────────────────────────────────────

function runnerNodeRow() {
  return {
    id: NODE_ID,
    organization_id: ORG_ID,
    name: "E2E 假节点",
    revoked_at: null,
    last_seen_at: now(),
    created_at: "2026-11-01T00:00:00Z",
    capabilities_updated_at: now(),
    capabilities: {
      protocol_version: 1,
      supports_http_sse: true,
      http_endpoint_hint: `http://${HOST}:${NODE_PORT}`,
      runtimes: [
        {
          id: RUNTIME_ID,
          kind: "api",
          provider: "fake",
          model: "scripted",
          label: "脚本假模型",
          capabilities: { streaming: true, reasoning: false, tools: false },
          context_window: 32000,
          priced: false,
          status: "ready",
        },
      ],
    },
  }
}

/** Minimal PostgREST filters: eq / is.null / in.(...). Unknown columns are ignored. */
function applyFilters(rows, params) {
  let out = rows
  for (const [key, raw] of params) {
    if (["select", "order", "limit", "offset", "columns"].includes(key)) continue
    if (key === "payload->target->>id") {
      const id = raw.replace(/^eq\./, "")
      out = out.filter((r) => r.payload?.target?.id === id)
    } else if (raw.startsWith("eq.")) {
      out = out.filter((r) => String(r[key]) === raw.slice(3))
    } else if (raw === "is.null") {
      out = out.filter((r) => r[key] == null)
    } else if (raw.startsWith("in.(")) {
      const values = raw.slice(4, -1).split(",")
      out = out.filter((r) => values.includes(String(r[key])))
    }
  }
  const order = params.get("order")
  if (order) {
    const [col, dir] = order.split(".")
    out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1))
  }
  const limit = params.get("limit")
  return limit ? out.slice(0, Number(limit)) : out
}

function respondRows(req, res, rows) {
  const single = (req.headers.accept ?? "").includes("application/vnd.pgrst.object+json")
  if (!single) return json(res, 200, rows)
  if (rows.length !== 1) {
    return json(res, 406, {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
      details: `The result contains ${rows.length} rows`,
      hint: null,
    })
  }
  return json(res, 200, rows[0])
}

function tableRows(table) {
  if (table === "organizations") return [{ id: ORG_ID, name: "E2E 组织", created_at: "2026-11-01T00:00:00Z" }]
  if (table === "organization_members") return [{ organization_id: ORG_ID, user_id: USER.id, role: "owner" }]
  if (table === "organization_roles") {
    return [{ organization_id: ORG_ID, role_key: "owner", permissions: ["content.manage", "agent.dispatch"] }]
  }
  if (table === "profiles") return [{ user_id: USER.id, display_name: "E2E Operator" }]
  if (table === "runner_nodes") return [runnerNodeRow()]
  if (table === "chat_sessions") return db.sessions
  if (table === "chat_messages") return db.messages
  if (table === "agent_jobs") return db.jobs.map((j) => ({ ...j, kind: "chat_turn" }))
  return []
}

async function handleSupabase(req, res, url) {
  const path = url.pathname

  if (path === "/auth/v1/token") {
    const body = await readBody(req)
    if (url.searchParams.get("grant_type") === "password" && body.email === USER.email) {
      return json(res, 200, issueSession())
    }
    if (url.searchParams.get("grant_type") === "refresh_token") return json(res, 200, issueSession())
    return json(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" })
  }
  if (path === "/auth/v1/user") {
    if (!db.tokens.has(bearer(req))) return json(res, 401, { message: "invalid JWT" })
    return json(res, 200, authUser())
  }
  if (path === "/auth/v1/logout") return json(res, 204)

  if (path === "/rest/v1/rpc/cancel_agent_job") {
    const body = await readBody(req)
    const job = db.jobs.find((j) => j.id === body.p_job_id)
    if (!job) return json(res, 404, { code: "P0002", message: "job not found" })
    if (job.status === "queued" || job.status === "running") job.cancel_requested_at = now()
    return json(res, 200, { ...job, kind: "chat_turn" })
  }
  if (path.startsWith("/rest/v1/rpc/")) return json(res, 200, null)

  const table = path.replace(/^\/rest\/v1\//, "")
  if (!db.tokens.has(bearer(req)) && table !== "") {
    // Anonymous reads see nothing (RLS).
    return respondRows(req, res, [])
  }

  if (table === "chat_sessions" && req.method === "POST") {
    const body = await readBody(req)
    const row = {
      id: randomUUID(),
      organization_id: body.organization_id,
      owner_id: USER.id,
      work_item_id: body.work_item_id ?? null,
      title: body.title ?? "",
      runtime_config: body.runtime_config ?? {},
      last_seq: 0,
      archived_at: null,
      created_at: now(),
      updated_at: now(),
    }
    db.sessions.push(row)
    return respondRows(req, res, [row])
  }
  if (table === "chat_sessions" && req.method === "PATCH") {
    const body = await readBody(req)
    const rows = applyFilters(db.sessions, url.searchParams)
    for (const row of rows) Object.assign(row, body, { updated_at: now() })
    return respondRows(req, res, rows)
  }
  if (table === "chat_sessions" && req.method === "DELETE") {
    const ids = new Set(applyFilters(db.sessions, url.searchParams).map((r) => r.id))
    db.sessions = db.sessions.filter((r) => !ids.has(r.id))
    return json(res, 204)
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return respondRows(req, res, applyFilters(tableRows(table), url.searchParams))
  }
  return json(res, 200, [])
}

// ── fake node (HTTP contract v1) ─────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function insertMessage(session, fields) {
  session.last_seq += 1
  session.updated_at = now()
  const row = {
    id: randomUUID(),
    organization_id: ORG_ID,
    session_id: session.id,
    seq: session.last_seq,
    role: "user",
    content: "",
    parts: [],
    status: "completed",
    agent_job_id: null,
    reply_to_message_id: null,
    created_at: now(),
    ...fields,
  }
  db.messages.push(row)
  return row
}

/** Scripted reply: "慢" in the prompt streams slowly (for the stop test). */
function scriptFor(prompt, version) {
  const slow = prompt.includes("慢")
  const text = version > 1 ? `这是第 ${version} 版回答：${prompt}` : `假节点回答：${prompt}`
  const chunks = slow ? Array.from({ length: 40 }, (_, i) => `片段${i + 1} `) : [...text.match(/.{1,4}/gu)]
  return { chunks, delayMs: slow ? 250 : 40 }
}

async function streamTurn(req, res, session, userMessage, prompt) {
  const job = {
    id: randomUUID(),
    status: "running",
    cancel_requested_at: null,
    payload: { target: { id: session.id } },
    created_at: now(),
  }
  db.jobs.push(job)
  const version = db.messages.filter((m) => m.reply_to_message_id === userMessage.id).length + 1

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  })
  let open = true
  res.on("close", () => {
    open = false // disconnect is not cancel: keep going and persist
  })
  const send = (type, data) => {
    if (open) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  send("turn_start", { jobId: job.id, userMessageId: userMessage.id, seq: userMessage.seq, nodeId: NODE_ID, runtime: RUNTIME_ID })
  if (open) res.write(": ping\n\n")
  const { chunks, delayMs } = scriptFor(prompt, version)
  let text = ""
  let status = "completed"
  for (const chunk of chunks) {
    if (job.cancel_requested_at) {
      status = "cancelled"
      break
    }
    await sleep(delayMs)
    text += chunk
    send("text_delta", { delta: chunk })
  }
  const assistant = insertMessage(session, {
    role: "assistant",
    content: text || "（已停止生成）",
    parts: text ? [{ type: "text", text }] : [],
    status,
    agent_job_id: job.id,
    reply_to_message_id: userMessage.id,
  })
  job.status = status === "cancelled" ? "cancelled" : "succeeded"
  send("usage", { inputTokens: 10, outputTokens: text.length, costCents: 0, durationMs: 100, model: "scripted" })
  send("done", { assistantMessageId: assistant.id, seq: assistant.seq, status })
  if (open) res.end()
}

async function handleNode(req, res, url) {
  const path = url.pathname.replace(/\/+$/, "")
  if (path === "/v1/health") {
    if (req.method !== "GET") return json(res, 405, { code: "method_not_allowed", message: "只支持 GET" })
    return json(res, 200, { protocol_version: 1, node_id: NODE_ID })
  }
  if (path !== "/v1/chat/turns" && path !== "/v1/chat/turns/regenerate") {
    return json(res, 404, { code: "not_found", message: "接口不存在" })
  }
  if (req.method !== "POST") return json(res, 405, { code: "method_not_allowed", message: "只支持 POST" })
  if (!db.tokens.has(bearer(req))) return json(res, 401, { code: "unauthorized", message: "登录已失效，请重新登录" })

  const body = await readBody(req)
  if (body.runtime_id !== RUNTIME_ID) {
    return json(res, 422, { code: "invalid_request", message: `本节点没有运行时 ${body.runtime_id}` })
  }
  const session = db.sessions.find((s) => s.id === body.session_id)
  if (!session) return json(res, 422, { code: "invalid_request", message: "会话不存在" })
  if (db.jobs.some((j) => j.payload.target.id === session.id && j.status === "running")) {
    return json(res, 409, { code: "turn_in_progress", message: "上一轮还在生成，请等它结束或先停止" })
  }
  session.runtime_config = { ...session.runtime_config, runtime_id: RUNTIME_ID }

  if (path.endsWith("/regenerate")) {
    const userMessage = db.messages.find((m) => m.id === body.user_message_id && m.role === "user")
    if (!userMessage) return json(res, 422, { code: "invalid_request", message: "原消息不存在" })
    return streamTurn(req, res, session, userMessage, userMessage.content)
  }
  if (!session.title) session.title = String(body.content).slice(0, 28)
  const userMessage = insertMessage(session, { role: "user", content: body.content, parts: body.parts ?? [] })
  return streamTurn(req, res, session, userMessage, body.content)
}

function serve(port, handler) {
  const server = createServer((req, res) => {
    cors(req, res)
    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }
    const url = new URL(req.url ?? "/", `http://${HOST}`)
    handler(req, res, url).catch((error) => {
      console.error("[fake-chat-node]", error)
      if (!res.headersSent) json(res, 500, { code: "internal_error", message: "服务内部错误" })
      else res.end()
    })
  })
  server.listen(port, HOST, () => console.log(`[fake-chat-node] listening on http://${HOST}:${port}`))
  return server
}

serve(SUPABASE_PORT, handleSupabase)
serve(NODE_PORT, handleNode)
