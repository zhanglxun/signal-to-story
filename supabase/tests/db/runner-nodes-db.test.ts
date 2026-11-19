// @vitest-environment node
// DB2c-2 (database.md §4.4, DB-D16): node identity rules enforced by the database.
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createSupabaseTestDb, seedOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"
import { enqueueDemoJob, seedDemoWorkspace, type DemoWorkspace } from "../../../workers/agent/demo/demo-scenario"

let db: SupabaseTestDb
let ws: DemoWorkspace

const createNode = (userId: string, orgId: string, name = "节点") =>
  db.asUser(userId, async (tx) => (await tx.query<{ r: { id: string; token: string } }>("select public.create_runner_node($1,$2) as r", [orgId, name])).rows[0].r)
/** Call a node RPC the way the worker does: anon role, token in the arguments. */
const anon = <T = unknown>(sql: string, params: unknown[]) => db.asAnon(async (tx) => (await tx.query<{ r: T }>(sql, params)).rows[0]?.r)
const claim = (token: string) => anon<{ id: string; lease_epoch: number } | null>("select public.node_claim($1, array['content_draft'], 120) as r", [token])

beforeEach(async () => {
  db = await createSupabaseTestDb()
  ws = await seedDemoWorkspace(db)
})
afterEach(async () => {
  await db.close()
})

describe("runner_nodes (DB2c-2)", () => {
  it("only organization managers create and revoke nodes; the token is returned once and never readable", async () => {
    const node = await createNode(ws.ownerId, ws.organizationId)
    expect(node.token).toMatch(/^stn_[a-f0-9]{64}$/)

    const org = await seedOrganization(db, { members: [{ role: "editor", permissions: ["content.view", "content.manage"] }] })
    await expect(createNode(org.members.editor, org.organizationId)).rejects.toThrow(/没有管理执行节点的权限/)
    await expect(db.asUser(org.members.editor, (tx) => tx.query("select public.revoke_runner_node($1)", [node.id]))).rejects.toThrow(/没有管理执行节点的权限/)
    await expect(db.asAnon((tx) => tx.query("select public.create_runner_node($1,'x')", [ws.organizationId]))).rejects.toThrow(/permission denied/)

    const listed = await db.asUser(ws.ownerId, async (tx) => (await tx.query("select id, name, revoked_at, last_seen_at from public.runner_nodes")).rows)
    expect(listed).toEqual([{ id: node.id, name: "节点", revoked_at: null, last_seen_at: null }])
    await expect(db.asUser(ws.ownerId, (tx) => tx.query("select token_hash from public.runner_nodes"))).rejects.toThrow(/permission denied/)
    await expect(db.asAnon((tx) => tx.query("select id from public.runner_nodes"))).rejects.toThrow(/permission denied/)
    // Names are unique among live nodes; a revoked node's name can be reused for its replacement.
    await expect(createNode(ws.ownerId, ws.organizationId)).rejects.toThrow(/同名/)
    await db.asUser(ws.ownerId, (tx) => tx.query("select public.revoke_runner_node($1)", [node.id]))
    expect((await createNode(ws.ownerId, ws.organizationId)).token).not.toBe(node.token)
    // Another organization's member does not see the node.
    expect(await db.asUser(org.members.editor, async (tx) => (await tx.query("select id from public.runner_nodes")).rows)).toEqual([])
  })

  it("rejects bad or revoked tokens; anon still cannot call the service_role node RPCs", async () => {
    await enqueueDemoJob(db, ws)
    await expect(claim("stn_" + "0".repeat(64))).rejects.toThrow(/令牌无效或已吊销/)
    await expect(claim("not-a-token")).rejects.toThrow(/节点令牌无效/)
    const node = await createNode(ws.ownerId, ws.organizationId)
    await db.asUser(ws.ownerId, (tx) => tx.query("select public.revoke_runner_node($1)", [node.id]))
    await expect(claim(node.token)).rejects.toThrow(/已吊销/)
    await expect(db.asAnon((tx) => tx.query("select public.claim_agent_job(array['content_draft'], 120)"))).rejects.toThrow(/permission denied/)
  })

  it("claims only its own organization's jobs and records which node holds the job", async () => {
    const job = await enqueueDemoJob(db, ws)
    const other = await seedOrganization(db, { members: [{ role: "owner" }] })
    const foreign = await createNode(other.members.owner, other.organizationId)
    expect(await claim(foreign.token)).toBeNull()

    const node = await createNode(ws.ownerId, ws.organizationId)
    const claimed = await claim(node.token)
    expect(claimed).toMatchObject({ id: job.id, lease_epoch: 1 })
    const row = await db.asPostgres(async (tx) => (await tx.query("select status, node_id from public.agent_jobs where id=$1", [job.id])).rows[0])
    expect(row).toEqual({ status: "running", node_id: node.id })
    // A deleted node leaves the job without a node rather than blocking the delete.
    expect(await db.asPostgres(async (tx) => (await tx.query("select confdeltype from pg_constraint where conname='agent_jobs_node_id_fkey'")).rows[0])).toEqual({ confdeltype: "n" })
  })

  it("a node writes and reads only the job it holds, with the current lease epoch", async () => {
    const job = await enqueueDemoJob(db, ws)
    const holder = await createNode(ws.ownerId, ws.organizationId, "A")
    const peer = await createNode(ws.ownerId, ws.organizationId, "B")
    await claim(holder.token)

    const step = "select public.node_record_step($1, $2, $3, 'context', 'succeeded', '{}'::jsonb, '{}'::jsonb, null) as r"
    await expect(anon(step, [peer.token, job.id, 1])).rejects.toThrow(/不由本节点执行/)
    await expect(anon("select public.node_list_steps($1,$2) as r", [peer.token, job.id])).rejects.toThrow(/不由本节点执行/)
    await expect(anon("select public.node_draft_context($1,$2) as r", [peer.token, job.id])).rejects.toThrow(/不由本节点执行/)
    await expect(anon("select public.node_complete($1,$2,1,'failed') as r", [peer.token, job.id])).rejects.toThrow(/不由本节点执行/)
    expect(await anon("select public.node_heartbeat($1,$2,1,120) as r", [peer.token, job.id])).toEqual({ ok: false, cancel_requested: false })

    await expect(anon(step, [holder.token, job.id, 99])).rejects.toThrow(/lease_epoch/)
    expect(await anon<{ seq: number }>(step, [holder.token, job.id, 1])).toMatchObject({ seq: 1 })
    const ctx = await anon<{ document: { id: string }; source: { id: string } }>("select public.node_draft_context($1,$2) as r", [holder.token, job.id])
    expect(ctx).toMatchObject({ document: { id: ws.documentId }, source: { id: ws.sourceId } })
    expect(await anon("select public.node_heartbeat($1,$2,1,120) as r", [holder.token, job.id])).toEqual({ ok: true, cancel_requested: false })

    const done = await anon<{ status: string; node_id: string | null }>("select public.node_complete($1,$2,1,'failed',null,'x','test') as r", [holder.token, job.id])
    expect(done).toMatchObject({ status: "failed", node_id: null })
    // Once the job left running, even the former holder cannot touch it.
    await expect(anon(step, [holder.token, job.id, 1])).rejects.toThrow(/不由本节点执行/)
  })

  it("notices are scoped to the node's organization", async () => {
    const job = await enqueueDemoJob(db, ws)
    const node = await createNode(ws.ownerId, ws.organizationId)
    await claim(node.token)
    await anon("select public.node_complete($1,$2,1,'failed',null,'x','test') as r", [node.token, job.id])

    const other = await seedOrganization(db, { members: [{ role: "owner" }] })
    const foreign = await createNode(other.members.owner, other.organizationId)
    expect(await anon("select public.node_list_pending_notices($1, 50) as r", [foreign.token])).toEqual([])
    expect(await anon("select public.node_mark_notice_sent($1,'job',$2,'failed') as r", [foreign.token, job.id])).toBe(false)

    const mine = await anon<Array<{ id: string }>>("select public.node_list_pending_notices($1, 50) as r", [node.token])
    expect(mine.map((n) => n.id)).toEqual([job.id])
    expect(await anon("select public.node_mark_notice_sent($1,'job',$2,'failed') as r", [node.token, job.id])).toBe(true)
  })
})
