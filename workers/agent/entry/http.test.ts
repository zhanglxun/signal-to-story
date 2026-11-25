// @vitest-environment node
// T3b: the chat HTTP/SSE entry over a real node:http server on an ephemeral port, with PGlite as the
// database (real SQL for every RPC, user calls under RLS, node calls as anon + node token) and a
// FakeAgentSessionDriver instead of a model. docs/modules/chat.md 2.3–2.6.
import type { AddressInfo } from "node:net"

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { createSupabaseTestDb, seedOrganization, type SeededOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"
import { type NodeChatApi, NodeChatBackend, sqlUserData } from "../backends/chat-db"
import { sqlRpc } from "../backends/node-backend"
import { FakeAgentSessionDriver, type FakeStep } from "../loop/chat/fake-driver"
import { NodeCapabilityReporter, RuntimeRegistry } from "../runtime-registry"
import { startCapabilityReporting } from "./capabilities"
import { type ChatHttpOptions, type ChatHttpServer, createChatHttpServer, listen } from "./http"
import type { ChatRuntimeResolver, RuntimeAvailability } from "./runtimes"

const RUNTIME = "api:fake:fake-model"
const ACP_RUNTIME = "acp:fakecli"

let db: SupabaseTestDb
let org: SeededOrganization
let nodeA: { id: string; token: string }
let nodeB: { id: string; token: string }
const tokens: Record<string, string> = {}

beforeAll(async () => {
  db = await createSupabaseTestDb()
  org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "member" }, { role: "viewer" }] })
  for (const role of ["owner", "member", "viewer"]) tokens[`tok-${role}`] = org.members[role]
  const create = (name: string) =>
    db.asUser(org.members.owner, async (tx) => (await tx.query<{ r: { id: string; token: string } }>("select public.create_runner_node($1,$2) as r", [org.organizationId, name])).rows[0].r)
  nodeA = await create("A")
  nodeB = await create("B")
})
afterAll(async () => {
  await db.close()
})

// ── Fixture: one server per test ───────────────────────────────────────────────────────────────

const servers: ChatHttpServer[] = []
afterEach(async () => {
  for (const entry of servers.splice(0)) {
    await entry.idle()
    entry.server.closeAllConnections?.()
    await new Promise<void>((resolve) => entry.server.close(() => resolve()))
  }
})

interface Fixture {
  base: string
  entry: ChatHttpServer
  steps: { next: FakeStep[] }
  drivers: FakeAgentSessionDriver[]
  regenerated: Array<{ sessionId: string; runtimeId: string }>
}

const nodeApi = (token = nodeA.token): NodeChatApi => new NodeChatBackend(sqlRpc((fn) => db.asAnon(fn)), token)

async function start(overrides: Partial<ChatHttpOptions> = {}, availability: Record<string, RuntimeAvailability> = {}): Promise<Fixture> {
  const steps = { next: [] as FakeStep[] }
  const drivers: FakeAgentSessionDriver[] = []
  const regenerated: Fixture["regenerated"] = []
  const runtimes: ChatRuntimeResolver = {
    availability: (id) => availability[id] ?? (id === RUNTIME || id === ACP_RUNTIME ? "ready" : "unknown"),
    create: (id) => {
      const kind = id.startsWith("acp:") ? "acp" : "api"
      const driver = new FakeAgentSessionDriver(steps.next, { runtimeId: id, kind, execSession: kind === "acp" ? { driver: "acp", acp_session_id: "s-1" } : undefined })
      drivers.push(driver)
      return { driver, kind, contextWindow: null, maxOutputTokens: null }
    },
    prepareRegenerate: async (sessionId, runtimeId) => {
      regenerated.push({ sessionId, runtimeId })
    },
  }
  const entry = createChatHttpServer({
    nodeId: nodeA.id,
    node: nodeApi(),
    verifyUser: async (token) => (tokens[token] ? { id: tokens[token] } : null),
    userData: (_token, user) => sqlUserData((fn) => db.asUser(user.id, fn)),
    runtimes,
    allowedOrigins: ["https://story.example.test"],
    heartbeatIntervalMs: 40,
    pingIntervalMs: 0,
    usageFlushTimeoutMs: 2_000,
    ...overrides,
  })
  const port = await listen(entry.server, 0, "127.0.0.1")
  const base = `http://127.0.0.1:${port}`
  servers.push(entry)
  expect((entry.server.address() as AddressInfo).port).toBe(port)
  return { base, entry, steps, drivers, regenerated }
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

type Sse = { event: string; data: Record<string, unknown> }

async function readSse(res: Response, onEvent?: (e: Sse) => void): Promise<Sse[]> {
  const events: Sse[] = []
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let i: number
      while ((i = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, i)
        buffer = buffer.slice(i + 2)
        if (block.startsWith(":")) continue
        const event = /^event: (.+)$/m.exec(block)?.[1] ?? "message"
        const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "{}") as Record<string, unknown>
        const e = { event, data }
        events.push(e)
        onEvent?.(e)
      }
    }
  } catch {
    // aborted by the test
  }
  return events
}

const post = (base: string, path: string, body: unknown, token: string | null = "tok-owner", init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string> | undefined) },
    body: JSON.stringify(body),
    signal: init.signal,
  })

const pg = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.asPostgres(async (tx) => (await tx.query<T>(sql, params)).rows)
const newSession = async (uid = org.members.owner, workItem: string | null = null) =>
  (await db.asUser(uid, (tx) => tx.query<{ id: string }>("insert into public.chat_sessions(organization_id, work_item_id) values ($1,$2) returning id", [org.organizationId, workItem]))).rows[0].id
type Msg = { id: string; seq: number; role: string; content: string; parts: Array<Record<string, unknown>>; status: string; reply_to_message_id: string | null; agent_job_id: string | null }
const messages = (session: string) => pg<Msg>("select id, seq, role, content, parts, status, reply_to_message_id, agent_job_id from public.chat_messages where session_id = $1 order by seq", [session])
const job = async (id: string) => (await pg<{ status: string; node_id: string | null; payload: Record<string, unknown>; error_code: string | null }>("select status, node_id, payload, error_code from public.agent_jobs where id = $1", [id]))[0]
const text = (delta: string): FakeStep => ({ kind: "model", events: [{ type: "text_delta", delta }] })
const wait = (ms: number): FakeStep => ({ kind: "wait", ms })
const until = async (check: () => boolean | Promise<boolean>, ms = 5_000) => {
  const deadline = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 20))
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────

describe("health and CORS", () => {
  it("GET /v1/health answers without auth", async () => {
    const { base } = await start()
    const res = await fetch(`${base}/v1/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ protocol_version: 1, node_id: nodeA.id })
  })

  it("preflight allows the console origin and localhost only", async () => {
    const { base } = await start()
    const preflight = (origin: string) =>
      fetch(`${base}/v1/chat/turns`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" } })
    const ok = await preflight("https://story.example.test")
    expect(ok.status).toBe(204)
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://story.example.test")
    expect(ok.headers.get("access-control-allow-methods")).toContain("POST")
    expect(ok.headers.get("access-control-allow-headers")).toContain("authorization")
    expect((await preflight("http://localhost:5173")).headers.get("access-control-allow-origin")).toBe("http://localhost:5173")
    const evil = await preflight("https://evil.example.test")
    expect(evil.status).toBe(403)
    expect(evil.headers.get("access-control-allow-origin")).toBeNull()
    const blocked = await post(base, "/v1/chat/turns", {}, "tok-owner", { headers: { origin: "https://evil.example.test" } })
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toMatchObject({ code: "forbidden" })
  })
})

describe("pre-stream errors", () => {
  it("401 without or with a bad JWT", async () => {
    const { base } = await start()
    const session = await newSession()
    const body = { session_id: session, content: "你好", runtime_id: RUNTIME }
    for (const token of [null, "tok-forged"]) {
      const res = await post(base, "/v1/chat/turns", body, token)
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ code: "unauthorized" })
    }
    expect(await messages(session)).toEqual([])
  })

  it("403 for a viewer without agent.dispatch; nothing is written", async () => {
    const { base } = await start()
    const session = await newSession(org.members.viewer)
    const res = await post(base, "/v1/chat/turns", { session_id: session, content: "帮我写", runtime_id: RUNTIME }, "tok-viewer")
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "forbidden" })
    expect(await messages(session)).toEqual([])
  })

  it("422 for invalid bodies and unknown runtimes, 503 for unavailable runtimes, 429 over the rate limit", async () => {
    const { base } = await start({ turnsPerMinute: 6 }, { "api:fake:offline": "unavailable" })
    const session = await newSession()
    const cases: Array<[unknown, number, string]> = [
      [{ session_id: "nope", content: "x", runtime_id: RUNTIME }, 422, "invalid_request"],
      [{ session_id: session, content: "", runtime_id: RUNTIME }, 422, "invalid_request"],
      [{ session_id: session, content: "x", runtime_id: RUNTIME, parts: [{ type: "text", text: "x" }] }, 422, "invalid_request"],
      [{ session_id: session, content: "x", runtime_id: "api:fake:unknown" }, 422, "invalid_request"],
      [{ session_id: session, content: "x", runtime_id: "api:fake:offline" }, 503, "runtime_unavailable"],
      [{ session_id: session, content: "x", runtime_id: RUNTIME, thinking_effort: "max" }, 422, "invalid_request"],
    ]
    for (const [body, status, code] of cases) {
      const res = await post(base, "/v1/chat/turns", body)
      expect(res.status, JSON.stringify(body)).toBe(status)
      expect(await res.json()).toMatchObject({ code })
    }
    const limited = await post(base, "/v1/chat/turns", { session_id: session, content: "x", runtime_id: RUNTIME })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ code: "rate_limited" })
    expect(await messages(session)).toEqual([])
  })
})

describe("a turn end to end", () => {
  it("send → streamed events → assistant message with parts, usage step, auto title, job succeeded", async () => {
    const { base, steps, drivers } = await start({ turnLimits: { budgetCents: 30, maxRounds: 4 } })
    steps.next = [{ kind: "model", events: [{ type: "reasoning_delta", delta: "想一想" }, { type: "text_delta", delta: "你好，" }], costCents: 2 }, text("我是助手。")]
    const session = await newSession()
    const res = await post(base, "/v1/chat/turns", { session_id: session, content: "第一行标题\n第二行", runtime_id: RUNTIME, thinking_effort: "low" })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const events = await readSse(res)
    expect(events.map((e) => e.event)).toEqual(["turn_start", "reasoning_delta", "text_delta", "usage", "text_delta", "usage", "done"])
    const start0 = events[0].data
    expect(start0).toMatchObject({ nodeId: nodeA.id, runtime: RUNTIME, seq: 1 })
    expect(events.at(-1)!.data).toMatchObject({ status: "completed", seq: 2 })

    const [user, assistant] = await messages(session)
    expect(user).toMatchObject({ role: "user", content: "第一行标题\n第二行", agent_job_id: start0.jobId })
    expect(assistant).toMatchObject({ role: "assistant", content: "你好，我是助手。", status: "completed", reply_to_message_id: user.id, id: events.at(-1)!.data.assistantMessageId })
    expect(assistant.parts).toEqual([{ type: "reasoning", text: "想一想" }, { type: "text", text: "你好，我是助手。" }])
    const j = await job(String(start0.jobId))
    expect(j.status).toBe("succeeded")
    expect(j.payload).toMatchObject({ target_node_id: nodeA.id, runtime: { runtime_id: RUNTIME, driver_kind: "api", thinking_effort: "low" }, limits: { budget_cents: 30, max_rounds: 4 } })
    const steps2 = await pg<{ kind: string; usage: Record<string, unknown> }>("select kind, usage from public.agent_job_steps where job_id = $1 order by seq", [start0.jobId])
    expect(steps2.map((s) => s.kind)).toEqual(["generate", "generate"])
    expect(steps2[0].usage).toMatchObject({ input_tokens: 100, output_tokens: 50, cost_cents: 2, model: "fake-model", driver: RUNTIME })
    expect((await pg<{ title: string; runtime_config: Record<string, unknown> }>("select title, runtime_config from public.chat_sessions where id = $1", [session]))[0])
      .toMatchObject({ title: "第一行标题", runtime_config: { runtime_id: RUNTIME, node_id: nodeA.id } })
    // The driver got the system prompt, the user turn and the chat tools; never a JWT.
    const input = drivers[0].inputs[0]
    expect(input.messages[0].role).toBe("system")
    expect(input.messages.at(-1)).toEqual({ role: "user", content: "第一行标题\n第二行" })
    expect(input.tools.map((t) => t.name)).toEqual(["capture_intake", "read_work_item", "enqueue_content_draft"])
    expect(input.thinkingEffort).toBe("low")
    expect(JSON.stringify(input)).not.toContain("tok-owner")
  })

  it("history and @ references reach the driver; a bound work item is included", async () => {
    const { base, steps, drivers } = await start()
    const item = (await pg<{ id: string }>("insert into public.work_items(organization_id, title, brief) values ($1, '绑定的选题', '{\"text\":\"简介\"}') returning id", [org.organizationId]))[0].id
    const other = (await pg<{ id: string }>("insert into public.work_items(organization_id, title) values ($1, '被引用的选题') returning id", [org.organizationId]))[0].id
    const session = await newSession(org.members.owner, item)
    steps.next = [text("第一轮回答")]
    await readSse(await post(base, "/v1/chat/turns", { session_id: session, content: "第一轮", runtime_id: RUNTIME }))
    steps.next = [text("第二轮回答")]
    await readSse(await post(base, "/v1/chat/turns", {
      session_id: session, content: "第二轮", runtime_id: RUNTIME, parts: [{ type: "context_ref", kind: "work_item", id: other, label: "@被引用" }],
    }))
    const input = drivers[1].inputs[0]
    expect(input.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"])
    expect(input.messages[1].content).toBe("第一轮")
    expect(input.messages[2].content).toBe("第一轮回答")
    expect(input.messages[0].content).toContain("绑定的选题")
    expect(input.messages[0].content).toContain("被引用的选题")
    expect(input.turn.references.map((r) => r.label)).toEqual(["当前会话绑定的事项：绑定的选题", "事项：被引用的选题"])
    const stored = await messages(session)
    expect(stored[2].parts).toEqual([{ type: "context_ref", kind: "work_item", id: other, label: "@被引用" }])
  })

  it("regenerate: no new user message, reply_to the same user message, ACP session reset", async () => {
    const { base, steps, drivers, regenerated } = await start()
    const session = await newSession()
    steps.next = [text("版本一")]
    await readSse(await post(base, "/v1/chat/turns", { session_id: session, content: "问题", runtime_id: ACP_RUNTIME }))
    const [user] = await messages(session)
    steps.next = [text("版本二")]
    const res = await post(base, "/v1/chat/turns/regenerate", { session_id: session, user_message_id: user.id, runtime_id: ACP_RUNTIME })
    expect(res.status).toBe(200)
    const events = await readSse(res)
    expect(events.at(-1)).toMatchObject({ event: "done", data: { status: "completed" } })
    const all = await messages(session)
    expect(all.map((m) => [m.role, m.content, m.reply_to_message_id])).toEqual([
      ["user", "问题", null],
      ["assistant", "版本一", user.id],
      ["assistant", "版本二", user.id],
    ])
    expect(regenerated).toEqual([{ sessionId: session, runtimeId: ACP_RUNTIME }])
    // First turn resumed nothing; the regenerated turn starts without the stored ACP session.
    expect(drivers[0].inputs[0].execSession).toBeNull()
    expect((await pg<{ exec_session: unknown }>("select exec_session from public.chat_sessions where id = $1", [session]))[0].exec_session).toEqual({ driver: "acp", acp_session_id: "s-1" })
    expect(drivers[1].inputs[0].execSession).toBeNull()
    // The regenerated context never contains the reply it replaces.
    expect(drivers[1].inputs[0].messages.map((m) => m.content)).not.toContain("版本一")
  })

  it("409 turn_in_progress while the session has an active turn", async () => {
    const { base, steps } = await start()
    const session = await newSession()
    steps.next = [text("慢"), wait(400), text("完")]
    let started!: () => void
    const startedP = new Promise<void>((r) => (started = r))
    const first = post(base, "/v1/chat/turns", { session_id: session, content: "一", runtime_id: RUNTIME }).then((res) => readSse(res, (e) => e.event === "turn_start" && started()))
    await startedP
    const second = await post(base, "/v1/chat/turns", { session_id: session, content: "二", runtime_id: RUNTIME })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ code: "turn_in_progress" })
    expect((await first).at(-1)).toMatchObject({ event: "done", data: { status: "completed" } })
    expect((await messages(session)).map((m) => m.content)).toEqual(["一", "慢完"])
  })

  it("409 claim_failed when the job is not claimable by this node; the session is freed", async () => {
    // Misconfigured node id: the turn is targeted at node B, but this process holds node A's token.
    const { base } = await start({ nodeId: nodeB.id })
    const session = await newSession()
    const res = await post(base, "/v1/chat/turns", { session_id: session, content: "你好", runtime_id: RUNTIME })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "claim_failed" })
    const [user] = await messages(session)
    expect(await job(user.agent_job_id!)).toMatchObject({ status: "cancelled", node_id: null })

    // Another claimer won the race: same answer, and the next send is not blocked.
    const real = nodeApi()
    const racing = await start({ node: { ...bind(real), claimJob: async () => null } })
    const res2 = await post(racing.base, "/v1/chat/turns", { session_id: session, content: "再来", runtime_id: RUNTIME })
    expect(res2.status).toBe(409)
    expect(await res2.json()).toMatchObject({ code: "claim_failed" })
  })
})

/** Plain object view of a NodeChatApi (class methods are not own properties). */
function bind(api: NodeChatApi): NodeChatApi {
  return {
    claimJob: (...a) => api.claimJob(...a),
    chatContext: (...a) => api.chatContext(...a),
    heartbeat: (...a) => api.heartbeat(...a),
    recordUsageStep: (...a) => api.recordUsageStep(...a),
    appendChatMessage: (...a) => api.appendChatMessage(...a),
    reportCapabilities: (...a) => api.reportCapabilities(...a),
  }
}

describe("disconnect, stop and persistence", () => {
  it("a client disconnect does not cancel: the full reply is still persisted", async () => {
    const logs: string[] = []
    const { base, steps, entry } = await start({ logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) } })
    const session = await newSession()
    steps.next = [text("前半"), wait(300), text("后半")]
    const abort = new AbortController()
    const res = await post(base, "/v1/chat/turns", { session_id: session, content: "断线测试", runtime_id: RUNTIME }, "tok-owner", { signal: abort.signal })
    await readSse(res, (e) => {
      if (e.event === "text_delta") abort.abort()
    })
    await until(() => entry.activeTurns === 0)
    const [, assistant] = await messages(session)
    expect(logs).toContain("client disconnected; turn continues")
    expect(assistant).toMatchObject({ content: "前半后半", status: "completed" })
    expect(await job(assistant.agent_job_id!)).toMatchObject({ status: "succeeded" })
  })

  it("stop: cancel_agent_job → heartbeat sees cancel_requested → persisted as cancelled", async () => {
    const { base, steps } = await start()
    const session = await newSession()
    steps.next = [text("写到一半"), wait(5_000), text("不该出现")]
    let jobId = ""
    const events = await readSse(await post(base, "/v1/chat/turns", { session_id: session, content: "长回答", runtime_id: RUNTIME }), (e) => {
      if (e.event === "turn_start") jobId = String(e.data.jobId)
      if (e.event === "text_delta") {
        void db.asUser(org.members.owner, (tx) => tx.query("select public.cancel_agent_job($1)", [jobId]))
      }
    })
    expect(events.at(-1)).toMatchObject({ event: "done", data: { status: "cancelled" } })
    const [, assistant] = await messages(session)
    expect(assistant).toMatchObject({ content: "写到一半", status: "cancelled" })
    expect(await job(jobId)).toMatchObject({ status: "cancelled" })
  })

  it("persist failure: error persist_failed and no done", async () => {
    const real = bind(nodeApi())
    const { base, steps } = await start({ node: { ...real, appendChatMessage: async () => { throw new Error("db down") } } })
    steps.next = [text("回答")]
    const session = await newSession()
    const events = await readSse(await post(base, "/v1/chat/turns", { session_id: session, content: "x", runtime_id: RUNTIME }))
    expect(events.map((e) => e.event)).toEqual(["turn_start", "text_delta", "usage", "error"])
    expect(events.at(-1)!.data).toMatchObject({ code: "persist_failed", retryable: true })
  })

  it("an unreadable context still ends the turn: error reply persisted, then error and done", async () => {
    const real = bind(nodeApi())
    const { base } = await start({ node: { ...real, chatContext: async () => { throw new Error("context down") } } })
    const session = await newSession()
    const events = await readSse(await post(base, "/v1/chat/turns", { session_id: session, content: "x", runtime_id: RUNTIME }))
    expect(events.map((e) => e.event)).toEqual(["turn_start", "error", "done"])
    const [, assistant] = await messages(session)
    expect(assistant).toMatchObject({ status: "error", parts: [{ type: "error", code: "context_failed" }] })
    expect(await job(assistant.agent_job_id!)).toMatchObject({ status: "failed", error_code: "context_failed" })
  })

  it("a driver error is persisted first, then error and done(status error) are sent", async () => {
    const { base, steps } = await start()
    steps.next = [text("部分"), { kind: "throw", message: "上游炸了" }]
    const session = await newSession()
    const events = await readSse(await post(base, "/v1/chat/turns", { session_id: session, content: "x", runtime_id: RUNTIME }))
    expect(events.slice(-2).map((e) => [e.event, e.data.code ?? e.data.status])).toEqual([["error", "driver_failed"], ["done", "error"]])
    const [, assistant] = await messages(session)
    expect(assistant.status).toBe("error")
    expect(assistant.parts.at(-1)).toMatchObject({ type: "error", code: "driver_failed" })
    expect((await job(assistant.agent_job_id!)).error_code).toBe("driver_failed")
  })
})

describe("permissions and tools", () => {
  const ask: FakeStep = { kind: "permission", ask: { action: "write_file", summary: "写入 notes.md", options: [{ id: "a", label: "允许", kind: "allow" }, { id: "d", label: "拒绝", kind: "deny" }] } }

  it("permission round-trip: allow from the same user, 403 for another user, 404 for unknown ids", async () => {
    const { base, steps } = await start()
    steps.next = [ask, text("已写入")]
    const session = await newSession()
    let jobId = ""
    const statuses: number[] = []
    const events = await readSse(await post(base, "/v1/chat/turns", { session_id: session, content: "写文件", runtime_id: RUNTIME }), (e) => {
      if (e.event === "turn_start") jobId = String(e.data.jobId)
      if (e.event === "permission_request") {
        const path = `/v1/chat/turns/${jobId}/permissions/${String(e.data.requestId)}`
        void (async () => {
          statuses.push((await post(base, path, { decision: "allow" }, "tok-member")).status)
          statuses.push((await post(base, `/v1/chat/turns/${jobId}/permissions/unknown`, { decision: "allow" })).status)
          statuses.push((await post(base, path, { decision: "maybe" })).status)
          statuses.push((await post(base, path, { decision: "allow" })).status)
        })()
      }
    })
    expect(statuses).toEqual([403, 404, 422, 204])
    expect(events.map((e) => e.event)).toContain("permission_request")
    expect(events.at(-1)).toMatchObject({ event: "done", data: { status: "completed" } })
    const [, assistant] = await messages(session)
    expect(assistant.content).toBe("已写入")
    expect(assistant.parts.find((p) => p.type === "permission")).toMatchObject({ action: "write_file", decision: "allow" })
  })

  it("no answer within the timeout counts as timeout (deny)", async () => {
    const { base, steps } = await start({ permissionTimeoutMs: 100 })
    steps.next = [ask, text("不该出现")]
    const session = await newSession()
    const events = await readSse(await post(base, "/v1/chat/turns", { session_id: session, content: "写文件", runtime_id: RUNTIME }))
    expect(events.at(-1)).toMatchObject({ event: "done", data: { status: "completed" } })
    const [, assistant] = await messages(session)
    expect(assistant.content).toBe("（操作未获允许，已停止。）")
    expect(assistant.parts.find((p) => p.type === "permission")).toMatchObject({ decision: "timeout" })
  })

  it("tools run as the user: capture_intake writes an intake event, read_work_item reads through RLS", async () => {
    const { base, steps } = await start()
    const item = (await pg<{ id: string }>("insert into public.work_items(organization_id, title) values ($1, '工具读取的选题') returning id", [org.organizationId]))[0].id
    steps.next = [
      { kind: "tool", callId: "c1", name: "capture_intake", input: { text: "一条灵感", url: "https://example.test/a" } },
      { kind: "tool", callId: "c2", name: "read_work_item", input: { work_item_id: item } },
      { kind: "tool", callId: "c3", name: "read_work_item", input: { work_item_id: "not-a-uuid" } },
      text("好了"),
    ]
    const session = await newSession()
    const events = await readSse(await post(base, "/v1/chat/turns", { session_id: session, content: "记一下", runtime_id: RUNTIME }))
    const ends = events.filter((e) => e.event === "tool_end").map((e) => [e.data.callId, e.data.status])
    expect(ends).toEqual([["c1", "succeeded"], ["c2", "succeeded"], ["c3", "failed"]])
    expect(events.find((e) => e.event === "tool_end" && e.data.callId === "c2")!.data.outputSummary).toContain("工具读取的选题")
    const intake = await pg<{ source: string; text: string; url: string; created_by: string; payload: Record<string, unknown> }>(
      "select source, text, url, created_by, payload from public.intake_events where organization_id = $1 and source = 'chat'", [org.organizationId])
    expect(intake).toHaveLength(1)
    expect(intake[0]).toMatchObject({ text: "一条灵感", url: "https://example.test/a", created_by: org.members.owner, payload: { chat_session_id: session } })
  })
})

describe("capability report", () => {
  it("NodeCapabilityReporter publishes the catalog through node_report_capabilities", async () => {
    const registry = RuntimeRegistry.fromEnv({
      SENSE_API_RUNTIMES: "flash",
      SENSE_RUNTIME_FLASH_PROVIDER: "qwen",
      SENSE_RUNTIME_FLASH_MODEL: "qwen3.8-flash",
      SENSE_RUNTIME_FLASH_API_KEY: "sk-test-placeholder-not-real",
    })
    const node = nodeApi()
    const catalog = await startCapabilityReporting({
      registry,
      reporter: new NodeCapabilityReporter((caps) => node.reportCapabilities(caps)),
      catalog: { supportsHttpSse: true, httpEndpointHint: "https://node.example.test/?token=x" },
      intervalMs: 60_000,
      signal: AbortSignal.abort(),
    })
    expect(catalog).not.toBeNull()
    const [row] = await pg<{ capabilities: Record<string, unknown> }>("select capabilities from public.runner_nodes where id = $1", [nodeA.id])
    expect(row.capabilities).toMatchObject({ protocol_version: 1, supports_http_sse: true, http_endpoint_hint: "https://node.example.test", runtimes: [{ id: "api:qwen:qwen3.8-flash", status: "ready" }] })
    expect(JSON.stringify(row.capabilities)).not.toContain("sk-test")
  })
})
