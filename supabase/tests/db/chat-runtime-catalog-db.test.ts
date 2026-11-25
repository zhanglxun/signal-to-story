// @vitest-environment node
// DB3b (docs/modules/chat.md §6.1): chat turn correctness, structured messages, regenerate,
// node context and targeted claims, and the node runtime catalog — all enforced by the database.
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createSupabaseTestDb, seedOrganization, type SeededOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"

let db: SupabaseTestDb
let org: SeededOrganization
let owner: string

type Turn = { message_id: string; seq: number; agent_job_id: string | null }
type Job = { id: string; status: string; lease_epoch: number; node_id: string | null; max_attempts: number; payload: Record<string, unknown>; error_code: string | null; error: string | null }
type Msg = { id: string; seq: number; role: string; content: string; parts: unknown[]; status: string; reply_to_message_id: string | null; agent_job_id: string | null }

const one = async <T>(fn: () => Promise<{ rows: Array<{ r: T }> }>) => (await fn()).rows[0]?.r
const asUser = <T = unknown>(uid: string, sql: string, params: unknown[] = [], claims?: Record<string, unknown>) =>
  db.asUser(uid, (tx) => one<T>(() => tx.query<{ r: T }>(sql, params)), claims)
const anon = <T = unknown>(sql: string, params: unknown[] = []) => db.asAnon((tx) => one<T>(() => tx.query<{ r: T }>(sql, params)))
const pg = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.asPostgres(async (tx) => (await tx.query<T>(sql, params)).rows)

const createNode = (uid: string, orgId: string, name: string) =>
  asUser<{ id: string; token: string }>(uid, "select public.create_runner_node($1,$2) as r", [orgId, name])
const newSession = async (uid: string, orgId: string, workItem: string | null = null) =>
  (await db.asUser(uid, (tx) => tx.query<{ id: string }>("insert into public.chat_sessions(organization_id, work_item_id) values ($1,$2) returning id", [orgId, workItem]))).rows[0].id
const send = (uid: string, session: string, content: string, run = true, opts: { parts?: unknown[]; runtime?: unknown; target?: string | null } = {}) =>
  asUser<Turn>(uid, "select public.send_chat_message($1,$2,$3,$4::jsonb,$5::jsonb,$6) as r",
    [session, content, run, JSON.stringify(opts.parts ?? []), opts.runtime === undefined ? null : JSON.stringify(opts.runtime), opts.target ?? null])
const regenerate = (uid: string, session: string, message: string, runtime: unknown = null, target: string | null = null) =>
  asUser<Turn>(uid, "select public.regenerate_chat_turn($1,$2,$3::jsonb,$4) as r", [session, message, runtime === null ? null : JSON.stringify(runtime), target])
const claimJob = (token: string, job: string) => anon<Job | null>("select public.node_claim_job($1,$2,120) as r", [token, job])
const claimQueue = (token: string, kinds: string[]) => anon<Job | null>("select public.node_claim($1,$2,120) as r", [token, kinds])
const append = (token: string, job: string, epoch: number, content: string, o: { parts?: unknown[]; status?: string; finish?: boolean; title?: string | null; exec?: unknown } = {}) =>
  anon<{ message_id: string; seq: number; status: string; job_status: string; existing: boolean }>(
    "select public.node_append_chat_message($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) as r",
    [token, job, epoch, content, o.exec === undefined ? null : JSON.stringify(o.exec), JSON.stringify(o.parts ?? []), o.status ?? "completed", o.finish ?? true, o.title ?? null])
const context = (token: string, job: string, limit = 40) =>
  anon<{ turn: Record<string, unknown>; session: Record<string, unknown>; messages: Msg[]; work_item: Record<string, unknown> | null; documents: Array<Record<string, unknown>> }>(
    "select public.node_chat_context($1,$2,$3) as r", [token, job, limit])
const job = async (id: string) => (await pg<Job>("select * from public.agent_jobs where id = $1", [id]))[0]
const messages = (session: string) => pg<Msg>("select * from public.chat_messages where session_id = $1 order by seq", [session])
/** Run one full turn on a node: claim by id, then append + finish. */
const answer = async (token: string, turn: Turn, content: string, o: Parameters<typeof append>[4] = {}) => {
  const claimed = await claimJob(token, turn.agent_job_id!)
  expect(claimed).toMatchObject({ id: turn.agent_job_id, status: "running" })
  return append(token, turn.agent_job_id!, claimed!.lease_epoch, content, o)
}
/** Move a job's clock back (as the platform would see it after time passes). */
const age = (id: string, column: "created_at" | "locked_until", minutes: number) =>
  db.asPostgres(async (tx) => {
    await tx.query("set local session_replication_role = replica")
    await tx.query(`update public.agent_jobs set ${column} = now() - make_interval(mins => $2) where id = $1`, [id, minutes])
  })

async function expectDenied(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(() => null, (e: unknown) => e as Error)
  expect(error, "expected the database to refuse").not.toBeNull()
  expect(error?.message).toMatch(pattern)
}

beforeEach(async () => {
  db = await createSupabaseTestDb()
  org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "member" }, { role: "viewer" }] })
  owner = org.members.owner
})
afterEach(async () => {
  await db.close()
})

describe("1. permissions and forgery", () => {
  it("the browser cannot write messages, seq, exec_session, capabilities or read token_hash", async () => {
    const s = await newSession(owner, org.organizationId)
    const t = await send(owner, s, "你好", false)
    const asOwner = (sql: string, params: unknown[] = []) => db.asUser(owner, (tx) => tx.query(sql, params))
    await expectDenied(asOwner("insert into public.chat_messages(organization_id, session_id, seq, role, content) values ($1,$2,9,'assistant','伪造')", [org.organizationId, s]), /permission denied/)
    await expectDenied(asOwner("update public.chat_messages set content = 'x', parts = '[]', status = 'error' where id = $1", [t.message_id]), /permission denied/)
    await expectDenied(asOwner("update public.chat_sessions set last_seq = 99 where id = $1", [s]), /permission denied/)
    await expectDenied(asOwner("update public.chat_sessions set exec_session = '{\"x\":1}' where id = $1", [s]), /permission denied/)
    // runtime_config and title are the browser's to change.
    await asOwner("update public.chat_sessions set runtime_config = '{\"runtime_id\":\"api:qwen:qwen3.8-flash\"}', title = '标题' where id = $1", [s])
    await expectDenied(asOwner("update public.chat_sessions set runtime_config = '[]' where id = $1", [s]), /check constraint/)

    const node = await createNode(owner, org.organizationId, "A")
    await anon("select public.node_report_capabilities($1, '{\"runtimes\":[]}'::jsonb) as r", [node.token])
    expect(await asUser(owner, "select jsonb_build_object('c', capabilities, 'at', capabilities_updated_at is not null) as r from public.runner_nodes"))
      .toEqual({ c: { runtimes: [] }, at: true })
    await expectDenied(asOwner("update public.runner_nodes set capabilities = '{}' where id = $1", [node.id]), /permission denied/)
    await expectDenied(asOwner("update public.runner_nodes set token_hash = repeat('0', 64) where id = $1", [node.id]), /permission denied/)
    await expectDenied(asOwner("select token_hash from public.runner_nodes"), /permission denied/)
    await expectDenied(db.asAnon((tx) => tx.query("select public.send_chat_message($1,'x')", [s])), /permission denied/)
    await expectDenied(db.asAnon((tx) => tx.query("select public.regenerate_chat_turn($1,$2)", [s, t.message_id])), /permission denied/)
  })

  it("only the session owner, signed in and not anonymous, may send or regenerate; regenerate needs agent.dispatch", async () => {
    const s = await newSession(owner, org.organizationId)
    const t = await send(owner, s, "第一条", false)
    // Same organization, not the owner.
    await expectDenied(send(org.members.member, s, "插话"), /会话不存在或没有权限/)
    await expectDenied(regenerate(org.members.member, s, t.message_id), /会话不存在或没有权限/)
    // Another organization.
    const other = await seedOrganization(db, { members: [{ role: "owner" }] })
    await expectDenied(send(other.members.owner, s, "跨组织"), /会话不存在或没有权限/)
    await expectDenied(regenerate(other.members.owner, s, t.message_id), /会话不存在或没有权限/)
    // An anonymous sign-in is not a user (security definer still sees auth.uid() / the JWT, as through PostgREST).
    await expectDenied(asUser(owner, "select public.send_chat_message($1,'x') as r", [s], { is_anonymous: true }), /需要登录/)
    // A message id from another session.
    const s2 = await newSession(owner, org.organizationId)
    const t2 = await send(owner, s2, "别的会话", false)
    await expectDenied(regenerate(owner, s, t2.message_id), /不存在或不属于该会话/)

    // A viewer can chat without the agent, but cannot start or regenerate a turn.
    const viewer = org.members.viewer
    const vs = await newSession(viewer, org.organizationId)
    const vt = await send(viewer, vs, "只是记一下", false)
    expect(vt.agent_job_id).toBeNull()
    await expectDenied(send(viewer, vs, "帮我写"), /没有调度 Agent 任务的权限/)
    await expectDenied(regenerate(viewer, vs, vt.message_id), /没有调度 Agent 任务的权限/)
    expect((await messages(vs)).map((m) => m.content)).toEqual(["只是记一下"])
  })

  it("a chat_turn enqueued by hand cannot point a node at someone else's session", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const s = await newSession(owner, org.organizationId)
    const t = await send(owner, s, "私人对话", false)
    const forged = await asUser<Job>(org.members.member, "select to_jsonb(public.enqueue_agent_job($1,'chat_turn','forged',$2::jsonb)) as r",
      [org.organizationId, JSON.stringify({ session_id: s, message_id: t.message_id, seq: t.seq })])
    expect(forged.max_attempts).toBe(1)
    const c = await claimJob(node.token, forged.id)
    await expectDenied(context(node.token, forged.id), /会话不存在/)
    await expectDenied(append(node.token, forged.id, c!.lease_epoch, "注入"), /会话不存在/)
    expect((await messages(s)).map((m) => m.content)).toEqual(["私人对话"])
  })
})

describe("2. structured messages and regenerate", () => {
  it("send stores parts, runtime and target node; limits default to 8 rounds / 50 cents and are clamped", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const s = await newSession(owner, org.organizationId)
    const parts = [{ type: "context_ref", kind: "work_item", id: "w1", label: "卡片" }]
    const runtime = { runtime_id: "api:qwen:qwen3.8-flash", driver_kind: "api", model: "qwen3.8-flash", thinking_effort: "medium", budget_cents: 99999, max_rounds: 50 }
    const t = await send(owner, s, "@卡片 帮我列提纲", true, { parts, runtime, target: node.id })
    const [m] = await messages(s)
    expect(m).toMatchObject({ role: "user", parts, status: "completed", agent_job_id: t.agent_job_id, reply_to_message_id: null })
    const j = await job(t.agent_job_id!)
    expect(j).toMatchObject({ status: "queued", max_attempts: 1 })
    expect(j.payload).toMatchObject({ schema_version: 1, session_id: s, message_id: t.message_id, seq: 1, runtime, target_node_id: node.id,
      target: { type: "chat_session", id: s }, limits: { max_rounds: 20, budget_cents: 500 } })
    // The session remembers the choice (without the per-turn limits) and the node.
    expect((await pg<{ runtime_config: unknown }>("select runtime_config from public.chat_sessions where id = $1", [s]))[0].runtime_config)
      .toEqual({ runtime_id: "api:qwen:qwen3.8-flash", driver_kind: "api", model: "qwen3.8-flash", thinking_effort: "medium", node_id: node.id })

    await answer(node.token, t, "好的")
    const t2 = await send(owner, s, "继续")
    expect((await job(t2.agent_job_id!)).payload).toMatchObject({ limits: { max_rounds: 8, budget_cents: 50 } })
    expect((await job(t2.agent_job_id!)).payload).not.toHaveProperty("target_node_id")
    await answer(node.token, t2, "好")
    const t3 = await send(owner, s, "再来", true, { runtime: { budget_cents: 0, max_rounds: 0 } })
    expect((await job(t3.agent_job_id!)).payload).toMatchObject({ limits: { max_rounds: 1, budget_cents: 1 } })
    await expectDenied(send(owner, s, "x", false, { parts: { not: "an array" } as unknown as unknown[] }), /parts 必须是/)
    await expectDenied(send(owner, s, "x", true, { runtime: ["not", "an", "object"] }), /runtime 必须是/)
  })

  it("rejects a target node that is revoked or belongs to another organization", async () => {
    const s = await newSession(owner, org.organizationId)
    const revoked = await createNode(owner, org.organizationId, "旧")
    await db.asUser(owner, (tx) => tx.query("select public.revoke_runner_node($1)", [revoked.id]))
    await expectDenied(send(owner, s, "x", true, { target: revoked.id }), /目标节点不存在、已吊销/)
    const other = await seedOrganization(db, { members: [{ role: "owner" }] })
    const foreign = await createNode(other.members.owner, other.organizationId, "外")
    await expectDenied(send(owner, s, "x", true, { target: foreign.id }), /目标节点不存在、已吊销/)
    expect(await messages(s)).toEqual([]) // rolled back with the refusal
  })

  it("regenerate adds no user message, queues a new chat_turn for the original message, keeps its first job id", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const s = await newSession(owner, org.organizationId)
    const t = await send(owner, s, "写个标题")
    await answer(node.token, t, "标题一")
    const r = await regenerate(owner, s, t.message_id, { runtime_id: "api:deepseek:deepseek-chat", max_rounds: 3 }, node.id)
    expect(r).toMatchObject({ message_id: t.message_id, seq: t.seq })
    expect(r.agent_job_id).not.toBe(t.agent_job_id)
    const j = await job(r.agent_job_id!)
    expect(j.payload).toMatchObject({ message_id: t.message_id, seq: t.seq, regenerate: true, target_node_id: node.id, limits: { max_rounds: 3, budget_cents: 50 } })
    await answer(node.token, r, "标题二")
    const all = await messages(s)
    expect(all.filter((m) => m.role === "user")).toHaveLength(1)
    expect(all.find((m) => m.role === "user")?.agent_job_id).toBe(t.agent_job_id)
    expect(all.filter((m) => m.role === "assistant").map((m) => [m.content, m.reply_to_message_id, m.agent_job_id]))
      .toEqual([["标题一", t.message_id, t.agent_job_id], ["标题二", t.message_id, r.agent_job_id]])
  })

  it("node_append writes parts and error / cancelled status, finishing the job to match; refuses stale leases and other job kinds", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const s = await newSession(owner, org.organizationId)

    const t1 = await send(owner, s, "一")
    const c1 = await claimJob(node.token, t1.agent_job_id!)
    await expectDenied(append(node.token, t1.agent_job_id!, c1!.lease_epoch + 5, "x"), /lease_epoch/)
    await expectDenied(append(node.token, t1.agent_job_id!, c1!.lease_epoch, "x", { status: "done" }), /无效的回复状态/)
    const errParts = [{ type: "text", text: "写到一半" }, { type: "error", code: "budget_exceeded", message: "本轮已达费用上限" }]
    // Text may be empty when the reply failed.
    const e1 = await append(node.token, t1.agent_job_id!, c1!.lease_epoch, "", { status: "error", parts: errParts })
    expect(e1).toMatchObject({ status: "error", job_status: "failed", existing: false })
    expect(await job(t1.agent_job_id!)).toMatchObject({ status: "failed", error_code: "budget_exceeded", error: "本轮已达费用上限" })
    expect((await messages(s)).at(-1)).toMatchObject({ role: "assistant", status: "error", parts: errParts, content: "" })

    const t2 = await send(owner, s, "二")
    const done = await answer(node.token, t2, "半截", { status: "cancelled", parts: [{ type: "reasoning", text: "想" }] })
    expect(done).toMatchObject({ status: "cancelled", job_status: "cancelled" })
    expect((await job(t2.agent_job_id!)).status).toBe("cancelled")

    const t3 = await send(owner, s, "三")
    expect(await answer(node.token, t3, "完整", { parts: [{ type: "text", text: "完整" }] })).toMatchObject({ status: "completed", job_status: "succeeded" })
    expect(await job(t3.agent_job_id!)).toMatchObject({ status: "succeeded", error_code: null })
    // A completed reply still needs text or parts.
    const t4 = await send(owner, s, "四")
    const c4 = await claimJob(node.token, t4.agent_job_id!)
    await expectDenied(append(node.token, t4.agent_job_id!, c4!.lease_epoch, ""), /1–200000/)

    // Not a chat turn.
    const other = await asUser<Job>(owner, "select to_jsonb(public.enqueue_agent_job($1,'evaluate','ev-1','{}'::jsonb)) as r", [org.organizationId])
    const ce = await claimQueue(node.token, ["evaluate"])
    expect(ce?.id).toBe(other.id)
    await expectDenied(append(node.token, other.id, ce!.lease_epoch, "x"), /只有 Chat 回合任务/)
  })
})

describe("3. node context and targeted claims", () => {
  it("returns history up to the turn's user message, latest completed version per reply, plus the card", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const card = await db.asUser(owner, async (tx) => {
      const item = (await tx.query<{ id: string }>("insert into public.work_items(organization_id, title, brief) values ($1, '量子计算科普', '{\"angle\":\"入门\"}') returning id", [org.organizationId])).rows[0].id
      await tx.query("insert into public.content_documents(organization_id, work_item_id, platform, title, body) values ($1,$2,'master','母稿','正文内容')", [org.organizationId, item])
      return item
    })
    const s = await newSession(owner, org.organizationId, card)
    const u1 = await send(owner, s, "U1")
    await answer(node.token, u1, "A1")
    const u2 = await send(owner, s, "U2")
    await answer(node.token, u2, "A2")

    // Regenerate U1: the context ends at U1 and does not contain its old reply or anything after it.
    const r1 = await regenerate(owner, s, u1.message_id)
    const c = await claimJob(node.token, r1.agent_job_id!)
    const ctx = await context(node.token, r1.agent_job_id!)
    expect(ctx.messages.map((m) => m.content)).toEqual(["U1"])
    expect(ctx.turn).toMatchObject({ job_id: r1.agent_job_id, user_message_id: u1.message_id, seq: 1, regenerate: true, limits: { max_rounds: 8, budget_cents: 50 } })
    expect(ctx.session).toMatchObject({ id: s, work_item_id: card, runtime_config: {}, exec_session: {} })
    expect(ctx.work_item).toMatchObject({ id: card, title: "量子计算科普", brief: { angle: "入门" } })
    expect(ctx.documents).toEqual([expect.objectContaining({ platform: "master", title: "母稿", excerpt: "正文内容", revision: 1 })])
    await append(node.token, r1.agent_job_id!, c!.lease_epoch, "A1 v2", { parts: [{ type: "reasoning", text: "重想" }] })
    // A failed version of U2 is skipped in favour of its latest completed one.
    const r2 = await regenerate(owner, s, u2.message_id)
    await answer(node.token, r2, "", { status: "error", parts: [{ type: "error", code: "x", message: "失败" }] })

    const u3 = await send(owner, s, "U3")
    await claimJob(node.token, u3.agent_job_id!)
    const full = await context(node.token, u3.agent_job_id!)
    expect(full.messages.map((m) => m.content)).toEqual(["U1", "A1 v2", "U2", "A2", "U3"])
    expect(full.messages[1]).toMatchObject({ role: "assistant", status: "completed", reply_to_message_id: u1.message_id, parts: [{ type: "reasoning", text: "重想" }] })
    expect((await context(node.token, u3.agent_job_id!, 2)).messages.map((m) => m.content)).toEqual(["A2", "U3"])
  })

  it("refuses the context to a node that does not hold the job or is in another organization", async () => {
    const a = await createNode(owner, org.organizationId, "A")
    const b = await createNode(owner, org.organizationId, "B")
    const other = await seedOrganization(db, { members: [{ role: "owner" }] })
    const foreign = await createNode(other.members.owner, other.organizationId, "X")
    const s = await newSession(owner, org.organizationId)
    const t = await send(owner, s, "hi")
    await expectDenied(context(a.token, t.agent_job_id!), /不由本节点执行/) // queued, nobody holds it
    await claimJob(a.token, t.agent_job_id!)
    await expectDenied(context(b.token, t.agent_job_id!), /不由本节点执行/)
    await expectDenied(context(foreign.token, t.agent_job_id!), /不由本节点执行/)
    expect((await context(a.token, t.agent_job_id!)).messages).toHaveLength(1)
  })

  it("a node never claims a job targeted at another node, by queue or by id; claim_job returns null for running / cancelled jobs", async () => {
    const a = await createNode(owner, org.organizationId, "A")
    const b = await createNode(owner, org.organizationId, "B")
    const other = await seedOrganization(db, { members: [{ role: "owner" }] })
    const foreign = await createNode(other.members.owner, other.organizationId, "X")
    const s = await newSession(owner, org.organizationId)
    const t = await send(owner, s, "给 B", true, { target: b.id })
    expect(await claimQueue(a.token, ["chat_turn"])).toBeNull()
    expect(await claimJob(a.token, t.agent_job_id!)).toBeNull()
    expect(await claimJob(foreign.token, t.agent_job_id!)).toBeNull()
    const got = await claimJob(b.token, t.agent_job_id!)
    expect(got).toMatchObject({ id: t.agent_job_id, status: "running", node_id: b.id, lease_epoch: 1, attempts: 1 })
    expect(await claimJob(b.token, t.agent_job_id!)).toBeNull() // already running
    await append(b.token, t.agent_job_id!, got!.lease_epoch, "done")

    // The queue path honours the target too.
    const t2 = await send(owner, s, "队列给 B", true, { target: b.id })
    expect(await claimQueue(a.token, ["chat_turn"])).toBeNull()
    expect((await claimQueue(b.token, ["chat_turn"]))?.id).toBe(t2.agent_job_id)
    await expectDenied(append(a.token, t2.agent_job_id!, 1, "抢答"), /不由本节点执行/)
    await append(b.token, t2.agent_job_id!, 1, "ok")

    // Cancelled before anyone claimed it.
    const t3 = await send(owner, s, "算了")
    await db.asUser(owner, (tx) => tx.query("select public.cancel_agent_job($1)", [t3.agent_job_id]))
    expect(await claimJob(a.token, t3.agent_job_id!)).toBeNull()
    // Only chat turns are claimed by id.
    const ev = await asUser<Job>(owner, "select to_jsonb(public.enqueue_agent_job($1,'evaluate','ev-2','{}'::jsonb)) as r", [org.organizationId])
    expect(await claimJob(a.token, ev.id)).toBeNull()
    await expectDenied(anon("select public.node_claim_job($1,$2,5) as r", [a.token, ev.id]), /lease_seconds/)
    await expectDenied(claimJob("stn_" + "0".repeat(64), t3.agent_job_id!), /令牌无效或已吊销/)
  })
})

describe("4. turn correctness (requirement 0)", () => {
  it("allows one active turn per session; the database backstops a concurrent insert", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const s = await newSession(owner, org.organizationId)
    const t = await send(owner, s, "一")
    await expectDenied(send(owner, s, "二"), /上一轮还在生成/)
    await expectDenied(regenerate(owner, s, t.message_id), /上一轮还在生成/)
    // A plain message (no agent) is still fine, and the refused sends left no user message behind.
    await send(owner, s, "备注", false)
    expect((await messages(s)).map((m) => m.content)).toEqual(["一", "备注"])
    // Another session of the same user is independent.
    const other = await newSession(owner, org.organizationId)
    expect((await send(owner, other, "并行")).agent_job_id).not.toBeNull()
    // Unique index backstop, whoever writes.
    await expectDenied(pg("insert into public.agent_jobs(organization_id, kind, idempotency_key, payload) values ($1,'chat_turn','dup',$2::jsonb)",
      [org.organizationId, JSON.stringify({ target: { type: "chat_session", id: s }, limits: { max_rounds: 8, max_hops: 8, budget_cents: 50 } })]), /agent_jobs_one_active_chat_turn|duplicate/)

    await answer(node.token, t, "完成")
    expect((await send(owner, s, "三")).agent_job_id).not.toBeNull()
  })

  it("a repeated append for one job yields one assistant message; p_finish=false leaves the job running", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const s = await newSession(owner, org.organizationId)
    const t = await send(owner, s, "hi")
    const c = await claimJob(node.token, t.agent_job_id!)
    const first = await append(node.token, t.agent_job_id!, c!.lease_epoch, "回复", { finish: false })
    expect(first).toMatchObject({ existing: false, job_status: "running" })
    const again = await append(node.token, t.agent_job_id!, c!.lease_epoch, "回复（重试）", { finish: false })
    expect(again).toMatchObject({ message_id: first!.message_id, seq: first!.seq, existing: true })
    expect((await job(t.agent_job_id!)).status).toBe("running")
    await anon("select public.node_complete($1,$2,$3,'succeeded') as r", [node.token, t.agent_job_id, c!.lease_epoch])
    // Retried after the job finished (the response was lost): still the same row, nothing new.
    expect(await append(node.token, t.agent_job_id!, c!.lease_epoch, "回复（再试）")).toMatchObject({ message_id: first!.message_id, existing: true, job_status: "succeeded" })
    expect((await messages(s)).filter((m) => m.role === "assistant").map((m) => m.content)).toEqual(["回复"])
    // A stale lease after completion does not get the shortcut.
    await expectDenied(append(node.token, t.agent_job_id!, c!.lease_epoch + 1, "x"), /不由本节点执行/)
    // Database-level: one assistant row per job.
    await expectDenied(pg("insert into public.chat_messages(organization_id, session_id, seq, role, content, agent_job_id) values ($1,$2,99,'assistant','dup',$3)",
      [org.organizationId, s, t.agent_job_id]), /chat_messages_one_reply_per_job|duplicate/)
  })

  it("chat turns are not retried: an expired lease fails the turn and frees the session", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const s = await newSession(owner, org.organizationId)
    const t = await send(owner, s, "hi")
    await claimJob(node.token, t.agent_job_id!)
    await age(t.agent_job_id!, "locked_until", 1)
    const t2 = await send(owner, s, "再问一次")
    expect(await job(t.agent_job_id!)).toMatchObject({ status: "failed", error_code: "lease_expired" })
    expect(t2.agent_job_id).not.toBeNull()
  })

  it("an unclaimed chat_turn expires after 10 minutes, on the node sweep or on the next send", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const s = await newSession(owner, org.organizationId)
    const t = await send(owner, s, "没人接")
    await age(t.agent_job_id!, "created_at", 9)
    expect(await claimQueue(node.token, ["content_draft"])).toBeNull()
    expect((await job(t.agent_job_id!)).status).toBe("queued") // 9 minutes: still waiting
    await age(t.agent_job_id!, "created_at", 11)
    expect(await claimQueue(node.token, ["content_draft"])).toBeNull()
    expect(await job(t.agent_job_id!)).toMatchObject({ status: "failed", error_code: "chat_turn_unclaimed" })
    const t2 = await send(owner, s, "再发")
    expect(t2.agent_job_id).not.toBeNull()

    // Without any node polling, the next send in the session clears it itself; claim_job refuses the expired one.
    await age(t2.agent_job_id!, "created_at", 11)
    expect(await claimJob(node.token, t2.agent_job_id!)).toBeNull()
    expect((await job(t2.agent_job_id!)).error_code).toBe("chat_turn_unclaimed")
    const s2 = await newSession(owner, org.organizationId)
    const t3 = await send(owner, s2, "又没人接")
    await age(t3.agent_job_id!, "created_at", 11)
    expect((await send(owner, s2, "第二次")).agent_job_id).not.toBeNull()
    expect((await job(t3.agent_job_id!)).error_code).toBe("chat_turn_unclaimed")
  })

  it("p_title names an untitled session once and never overwrites a title the user set", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const s = await newSession(owner, org.organizationId)
    const title = async () => (await pg<{ title: string }>("select title from public.chat_sessions where id = $1", [s]))[0].title
    await answer(node.token, await send(owner, s, "量子计算是什么"), "答", { title: "  量子计算入门  ", exec: { driver: "pi", session_id: "x" } })
    expect(await title()).toBe("量子计算入门")
    expect((await pg<{ exec_session: unknown }>("select exec_session from public.chat_sessions where id = $1", [s]))[0].exec_session).toEqual({ driver: "pi", session_id: "x" })
    await answer(node.token, await send(owner, s, "再说说"), "答", { title: "别的标题" })
    expect(await title()).toBe("量子计算入门")
    await db.asUser(owner, (tx) => tx.query("update public.chat_sessions set title = '' where id = $1", [s]))
    await db.asUser(owner, (tx) => tx.query("update public.chat_sessions set title = '我的会话' where id = $1", [s]))
    await answer(node.token, await send(owner, s, "继续"), "答", { title: "自动标题" })
    expect(await title()).toBe("我的会话")
  })
})

describe("5. node runtime catalog", () => {
  const catalog = (runtimes: unknown[], extra: Record<string, unknown> = {}) => ({ protocol_version: 1, supports_http_sse: true, http_endpoint_hint: "http://localhost:4310", runtimes, ...extra })
  const qwen = { id: "api:qwen:qwen3.8-flash", kind: "api", provider: "qwen", model: "qwen3.8-flash", context_window: 131072, max_output_tokens: 8192, max_tokens: 4096,
    capabilities: { streaming: true, reasoning: true, tools: true }, usage: { inputTokens: 0, outputTokens: 0 }, priced: true, status: "ready" }
  const report = (token: string, caps: unknown) => anon<{ capabilities_updated_at: string }>("select public.node_report_capabilities($1,$2::jsonb) as r", [token, JSON.stringify(caps)])

  it("stores a clean catalog (token-like key names such as max_tokens are fine) and shows it to members", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const ok = catalog([qwen, { id: "acp:opencode-cli", kind: "acp", model: "local-default" }, { id: "exec:codex.v1:latest", kind: "exec" }])
    expect((await report(node.token, ok))?.capabilities_updated_at).toBeTruthy()
    expect(await asUser(owner, "select capabilities as r from public.runner_nodes where id = $1", [node.id])).toEqual(ok)
    const other = await seedOrganization(db, { members: [{ role: "owner" }] })
    expect(await asUser(other.members.owner, "select count(*)::int as r from public.runner_nodes")).toBe(0)
  })

  it("rejects secrets by exact key name or key-shaped values, bad runtime ids, too many runtimes, bad shapes and revoked nodes", async () => {
    const node = await createNode(owner, org.organizationId, "A")
    const bad: Array<[unknown, RegExp]> = [
      [catalog([{ ...qwen, api_key: "x" }]), /密钥/],
      [catalog([qwen], { profiles: [{ name: "q", settings: { "Api-Key": "x" } }] }), /密钥/],
      [catalog([qwen], { authorization: "x" }), /密钥/],
      [catalog([qwen], { refresh_token: "x" }), /密钥/],
      [catalog([{ ...qwen, label: "sk-abcdef0123456789" }]), /密钥/],
      [catalog([qwen], { note: "stn_" + "a".repeat(64) }), /密钥/],
      [catalog([{ ...qwen, id: "cli:opencode" }]), /运行时 id 无效/],
      [catalog([{ ...qwen, id: "api:Qwen:Max" }]), /运行时 id 无效/],
      [catalog([{ kind: "api" }]), /运行时 id 无效/],
      [catalog(Array.from({ length: 65 }, (_, i) => ({ id: `api:p:m${i}` }))), /64/],
      [{ protocol_version: 1 }, /runtimes/],
      [[qwen], /JSON 对象/],
      [catalog([qwen], { blob: "x".repeat(40000) }), /32KB/],
    ]
    for (const [caps, pattern] of bad) await expectDenied(report(node.token, caps), pattern)
    expect(await asUser(owner, "select capabilities as r from public.runner_nodes where id = $1", [node.id])).toEqual({})
    // Exactly 64 is fine.
    await report(node.token, catalog(Array.from({ length: 64 }, (_, i) => ({ id: `api:p:m${i}` }))))
    await db.asUser(owner, (tx) => tx.query("select public.revoke_runner_node($1)", [node.id]))
    await expectDenied(report(node.token, catalog([qwen])), /已吊销/)
  })
})
