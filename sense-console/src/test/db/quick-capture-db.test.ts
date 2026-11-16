// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createSupabaseTestDb, seedOrganization, type SeededOrganization, type SupabaseTestDb } from "./pglite-harness"

let db: SupabaseTestDb
let org: SeededOrganization
let other: SeededOrganization

type CaptureResult = {
  capture_id: string
  intent: string
  duplicate: boolean
  signal_id: number
  selection_id: number
  project_id: string | null
  documents: Array<{ platform: string; document_id: string; job_id: string }>
  topic_path: string
  project_path: string | null
}

const capture = (userId: string, orgId: string, args: { url?: string | null; note?: string | null; intent: string; platforms?: string[]; key: string; title?: string | null }) =>
  db.asUser(userId, async (tx) => {
    const r = await tx.query<{ r: CaptureResult }>("select public.quick_capture($1,$2,$3,$4,$5,$6,$7) as r", [
      orgId, args.url ?? null, args.note ?? null, args.intent, args.platforms ?? [], args.key, args.title ?? null,
    ])
    return r.rows[0].r
  })

const count = async (table: string, orgId: string) =>
  db.asPostgres(async (tx) => Number((await tx.query<{ n: number }>(`select count(*)::int n from public.${table} where organization_id=$1`, [orgId])).rows[0].n))

beforeAll(async () => {
  db = await createSupabaseTestDb()
  org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "member" }, { role: "viewer" }, { role: "editor", permissions: ["content.view", "content.manage"] }] })
  other = await seedOrganization(db, { members: [{ role: "owner" }] })
})
afterAll(async () => {
  await db.close()
})

describe("quick_capture RPC", () => {
  it("capture_only saves signal + selection, no project or job, and is idempotent", async () => {
    const first = await capture(org.members.member, org.organizationId, { url: "https://example.com/a", note: "企业 AI 落地的角度", intent: "capture_only", platforms: ["x"], key: "web-capture-0001" })
    expect(first).toMatchObject({ intent: "capture_only", duplicate: false, project_id: null, documents: [], topic_path: `/topics/${first.selection_id}` })
    const again = await capture(org.members.member, org.organizationId, { url: "https://example.com/a", note: "企业 AI 落地的角度", intent: "capture_only", platforms: ["x"], key: "web-capture-0001" })
    expect(again).toMatchObject({ duplicate: true, capture_id: first.capture_id, selection_id: first.selection_id })
    const sig = await db.asUser(org.members.viewer, (tx) => tx.query<{ name: string; site_url: string; description: string }>("select name, site_url, description from public.signals where id=$1", [first.signal_id]))
    expect(sig.rows[0]).toEqual({ name: "企业 AI 落地的角度", site_url: "https://example.com/a", description: "企业 AI 落地的角度" })
    expect(await count("signals", org.organizationId)).toBe(1)
    expect(await count("agent_jobs", org.organizationId)).toBe(0)
  })

  it("same key with different input is a conflict", async () => {
    await expect(capture(org.members.member, org.organizationId, { note: "不同内容", intent: "capture_only", key: "web-capture-0001" })).rejects.toThrow(/idempotency_conflict/)
  })

  it("auto_draft creates project, master + platform documents and one queued job per document atomically", async () => {
    const r = await capture(org.members.owner, org.organizationId, { url: "https://example.com/b", intent: "auto_draft", platforms: ["xiaohongshu", "x", "x"], key: "web-auto-0001" })
    expect(r.project_id).toBeTruthy()
    expect(r.documents.map((d) => d.platform)).toEqual(["master", "xiaohongshu", "x"])
    const jobs = await db.asUser(org.members.viewer, (tx) =>
      tx.query<{ id: string; status: string; target_id: string; payload: { instruction: string; fetch_source: boolean; quick_capture_id: string } }>(
        "select id, status, target_id, payload from public.agent_jobs where payload->>'quick_capture_id'=$1 order by created_at", [r.capture_id]))
    expect(jobs.rows).toHaveLength(3)
    expect(jobs.rows.every((j) => j.status === "queued" && j.payload.fetch_source && j.payload.instruction.length > 0)).toBe(true)
    expect(new Set(jobs.rows.map((j) => j.target_id))).toEqual(new Set(r.documents.map((d) => d.document_id)))
    const project = await db.asPostgres((tx) => tx.query<{ selection_id: number; title: string }>("select selection_id, title from public.content_projects where id=$1", [r.project_id]))
    expect(project.rows[0]).toEqual({ selection_id: r.selection_id, title: "example.com/b" })

    const dup = await capture(org.members.owner, org.organizationId, { url: "https://example.com/b", intent: "auto_draft", platforms: ["xiaohongshu", "x", "x"], key: "web-auto-0001" })
    expect(dup).toMatchObject({ duplicate: true, project_id: r.project_id })
    expect(await count("content_projects", org.organizationId)).toBe(1)
    expect(await count("agent_jobs", org.organizationId)).toBe(3)
  })

  it("rolls back everything when a later step fails (atomicity)", async () => {
    const before = { s: await count("signals", org.organizationId), p: await count("content_projects", org.organizationId) }
    // content.manage without agent.dispatch: rejected before any write
    await expect(capture(org.members.editor, org.organizationId, { note: "想法", intent: "auto_draft", key: "web-auto-edit1" })).rejects.toThrow(/调度/)
    // Force a failure deep inside the pipeline (after signal/selection/project inserts) by breaking enqueue.
    await db.asPostgres((tx) => tx.query("alter table public.agent_jobs add constraint qc_test_block check (job_type <> 'content_draft') not valid"))
    try {
      await expect(capture(org.members.owner, org.organizationId, { note: "会失败的想法", intent: "auto_draft", key: "web-auto-fail1" })).rejects.toThrow()
    } finally {
      await db.asPostgres((tx) => tx.query("alter table public.agent_jobs drop constraint qc_test_block"))
    }
    expect({ s: await count("signals", org.organizationId), p: await count("content_projects", org.organizationId) }).toEqual(before)
    expect(await db.asPostgres(async (tx) => (await tx.query("select 1 from public.quick_captures where idempotency_key='web-auto-fail1'")).rows.length)).toBe(0)
  })

  it("rejects viewers, outsiders, anon, bad input and cross-org reads", async () => {
    await expect(capture(org.members.viewer, org.organizationId, { note: "x", intent: "capture_only", key: "web-view-0001" })).rejects.toThrow(/权限/)
    await expect(capture(other.members.owner, org.organizationId, { note: "x", intent: "capture_only", key: "web-out-00001" })).rejects.toThrow(/权限/)
    await expect(db.asAnon((tx) => tx.query("select public.quick_capture($1,null,'x','capture_only','{}','web-anon-0001')", [org.organizationId]))).rejects.toThrow(/permission denied/)
    await expect(capture(org.members.owner, org.organizationId, { intent: "capture_only", key: "web-empty-001" })).rejects.toThrow(/链接或一句话/)
    await expect(capture(org.members.owner, org.organizationId, { url: "javascript:alert(1)", intent: "capture_only", key: "web-bad-00001" })).rejects.toThrow(/http/)
    await expect(capture(org.members.owner, org.organizationId, { url: "https://u:p@example.com/", intent: "capture_only", key: "web-bad-00002" })).rejects.toThrow(/http/)
    await expect(capture(org.members.owner, org.organizationId, { note: "x", intent: "auto_draft", platforms: ["myspace"], key: "web-bad-00003" })).rejects.toThrow(/不支持的平台/)
    await expect(capture(org.members.owner, org.organizationId, { note: "x", intent: "capture_only", key: "conn:spoof:1" })).rejects.toThrow(/幂等键/)
    // other org sees nothing
    const seen = await db.asUser(other.members.owner, async (tx) => ({
      qc: (await tx.query("select * from public.quick_captures")).rows.length,
      jobs: (await tx.query("select * from public.agent_jobs")).rows.length,
    }))
    expect(seen).toEqual({ qc: 0, jobs: 0 })
    // direct writes are not allowed
    await expect(db.asUser(org.members.owner, (tx) => tx.query("delete from public.quick_captures"))).rejects.toThrow(/permission denied/)
    // service_role cannot call the browser entry as if it were a user
    await expect(db.asServiceRole((tx) => tx.query("select public.quick_capture($1,null,'x','capture_only','{}','web-svc-00001')", [org.organizationId]))).rejects.toThrow()
  })
})

describe("quick_capture_for_connection (trusted server path)", () => {
  const hash = "a".repeat(64)
  beforeAll(async () => {
    await db.asPostgres((tx) =>
      tx.query("insert into public.intake_connections(organization_id,created_by,name,adapter,token_hash) values($1,$2,'IM','generic',$3)", [org.organizationId, org.members.member, hash]))
  })
  const call = (input: Record<string, unknown>, token = hash) =>
    db.asServiceRole(async (tx) => {
      const r = await tx.query<{ r: CaptureResult & { receipt_id?: string } }>("select public.quick_capture_for_connection($1,$2) as r", [token, input])
      const after = await tx.query<{ sub: string | null }>("select auth.uid()::text as sub")
      return { ...r.rows[0].r, subAfter: after.rows[0].sub }
    })

  it("auto_draft acts as the connection creator, is idempotent per external_id and restores claims", async () => {
    const input = { version: 1, intent: "auto_draft", external_id: "im:msg-1", text: "这篇讲 Agent 评估", url: "https://example.com/c", platforms: ["wechat_official"] }
    const r = await call(input)
    expect(r.subAfter).toBeNull()
    expect(r.documents.map((d) => d.platform)).toEqual(["master", "wechat_official"])
    const job = await db.asPostgres((tx) => tx.query<{ created_by: string }>("select created_by from public.agent_jobs where id=$1", [r.documents[0].job_id]))
    expect(job.rows[0].created_by).toBe(org.members.member)
    expect((await call(input)).duplicate).toBe(true)
    await expect(call({ ...input, text: "改了" })).rejects.toThrow(/idempotency_conflict/)
  })

  it("capture delegates to accept_intake; bad tokens and creators without permission are rejected", async () => {
    const r = await call({ version: 1, intent: "capture", external_id: "im:msg-2", text: "收藏", title: "收藏" })
    expect(r.receipt_id).toBeTruthy()
    await expect(call({ version: 1, intent: "auto_draft", external_id: "x", text: "t" }, "b".repeat(64))).rejects.toThrow(/invalid_connection/)
    await db.asPostgres((tx) => tx.query("update public.organization_roles set permissions=array['content.view','content.manage'] where organization_id=$1 and role_key='member'", [org.organizationId]))
    await expect(call({ version: 1, intent: "auto_draft", external_id: "im:msg-3", text: "t" })).rejects.toThrow(/invalid_connection/)
    await expect(db.asUser(org.members.owner, (tx) => tx.query("select public.quick_capture_for_connection($1,'{}')", [hash]))).rejects.toThrow(/permission denied/)
  })
})
