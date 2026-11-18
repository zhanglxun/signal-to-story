// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createSupabaseTestDb, seedOrganization, type SeededOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"

let db: SupabaseTestDb
let org: SeededOrganization
let other: SeededOrganization

type CaptureResult = {
  event_id: string
  intent: string
  duplicate: boolean
  work_item_id: string | null
  documents: Array<{ platform: string; document_id: string; job_id: string }>
  inbox_path: string
  item_path: string | null
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
  it("capture_only writes one intake event, no work item or job, and is idempotent", async () => {
    const first = await capture(org.members.member, org.organizationId, { url: "https://example.com/a", note: "企业 AI 落地的角度", intent: "capture_only", platforms: ["x"], key: "web-capture-0001" })
    expect(first).toMatchObject({ intent: "capture_only", duplicate: false, work_item_id: null, documents: [], inbox_path: "/intake", item_path: null })
    const again = await capture(org.members.member, org.organizationId, { url: "https://example.com/a", note: "企业 AI 落地的角度", intent: "capture_only", platforms: ["x"], key: "web-capture-0001" })
    expect(again).toMatchObject({ duplicate: true, event_id: first.event_id, work_item_id: null })
    const ev = await db.asUser(org.members.viewer, (tx) => tx.query<{ source: string; text: string; url: string; work_item_id: string | null; created_by: string }>("select source, text, url, work_item_id, created_by from public.intake_events where id=$1", [first.event_id]))
    expect(ev.rows[0]).toEqual({ source: "web", text: "企业 AI 落地的角度\n\n企业 AI 落地的角度", url: "https://example.com/a", work_item_id: null, created_by: org.members.member })
    expect(await count("intake_events", org.organizationId)).toBe(1)
    expect(await count("work_items", org.organizationId)).toBe(0)
    expect(await count("agent_jobs", org.organizationId)).toBe(0)
  })

  it("same key with different input is a conflict", async () => {
    await expect(capture(org.members.member, org.organizationId, { note: "不同内容", intent: "capture_only", key: "web-capture-0001" })).rejects.toThrow(/idempotency_conflict/)
  })

  it("auto_draft creates a work item, master + platform documents and one queued job per document atomically", async () => {
    const r = await capture(org.members.owner, org.organizationId, { url: "https://example.com/b", intent: "auto_draft", platforms: ["xiaohongshu", "x", "x"], key: "web-auto-0001" })
    expect(r.work_item_id).toBeTruthy()
    expect(r.item_path).toBe(`/work-items/${r.work_item_id}`)
    expect(r.documents.map((d) => d.platform)).toEqual(["master", "x", "xiaohongshu"])
    const jobs = await db.asUser(org.members.viewer, (tx) =>
      tx.query<{ id: string; status: string; target_id: string; work_item_id: string; idempotency_key: string; payload: { instruction: string; fetch_source: boolean; intake_event_id: string; source: string } }>(
        "select id, status, payload->'target'->>'id' as target_id, work_item_id, idempotency_key, payload from public.agent_jobs where payload->>'intake_event_id'=$1 order by created_at", [r.event_id]))
    expect(jobs.rows).toHaveLength(3)
    expect(jobs.rows.every((j) => j.status === "queued" && j.payload.source === "capture" && j.payload.fetch_source && j.payload.instruction.length > 0)).toBe(true)
    expect(new Set(jobs.rows.map((j) => j.idempotency_key))).toEqual(new Set(["master", "x", "xiaohongshu"].map((p) => `capture:${r.event_id}:${p}`)))
    expect(new Set(jobs.rows.map((j) => j.target_id))).toEqual(new Set(r.documents.map((d) => d.document_id)))
    expect(jobs.rows.every((j) => j.work_item_id === r.work_item_id)).toBe(true)
    expect(new Set(jobs.rows.map((j) => j.id))).toEqual(new Set(r.documents.map((d) => d.job_id)))
    const item = await db.asPostgres((tx) => tx.query<{ status: string; title: string; brief: Record<string, unknown> }>("select status, title, brief from public.work_items where id=$1", [r.work_item_id]))
    expect(item.rows[0]).toMatchObject({ status: "doing", title: "example.com/b", brief: { url: "https://example.com/b", platforms: ["xiaohongshu", "x"], intake_event_id: r.event_id } })
    const ev = await db.asPostgres((tx) => tx.query<{ work_item_id: string }>("select work_item_id from public.intake_events where id=$1", [r.event_id]))
    expect(ev.rows[0].work_item_id).toBe(r.work_item_id)
    const docs = await db.asPostgres((tx) => tx.query<{ work_item_id: string; project_id: string | null }>("select work_item_id, project_id from public.content_documents where id = any($1)", [r.documents.map((d) => d.document_id)]))
    expect(docs.rows.every((d) => d.work_item_id === r.work_item_id && d.project_id === null)).toBe(true)

    const dup = await capture(org.members.owner, org.organizationId, { url: "https://example.com/b", intent: "auto_draft", platforms: ["xiaohongshu", "x", "x"], key: "web-auto-0001" })
    expect(dup).toMatchObject({ duplicate: true, event_id: r.event_id, work_item_id: r.work_item_id })
    expect(dup.documents).toEqual(r.documents)
    expect(await count("work_items", org.organizationId)).toBe(1)
    expect(await count("agent_jobs", org.organizationId)).toBe(3)
  })

  it("rolls back everything when a later step fails (atomicity)", async () => {
    const snap = async () => ({ e: await count("intake_events", org.organizationId), w: await count("work_items", org.organizationId), d: await count("content_documents", org.organizationId), j: await count("agent_jobs", org.organizationId) })
    const before = await snap()
    // content.manage without agent.dispatch: rejected before any write
    await expect(capture(org.members.editor, org.organizationId, { note: "想法", intent: "auto_draft", key: "web-auto-edit1" })).rejects.toThrow(/调度/)
    // Force a failure deep inside the pipeline (after the event/work item/document inserts) by breaking enqueue.
    await db.asPostgres((tx) => tx.query("alter table public.agent_jobs add constraint qc_test_block check (kind <> 'content_draft') not valid"))
    try {
      await expect(capture(org.members.owner, org.organizationId, { note: "会失败的想法", intent: "auto_draft", key: "web-auto-fail1" })).rejects.toThrow()
    } finally {
      await db.asPostgres((tx) => tx.query("alter table public.agent_jobs drop constraint qc_test_block"))
    }
    expect(await snap()).toEqual(before)
    expect(await db.asPostgres(async (tx) => (await tx.query("select 1 from public.intake_events where external_id='web-auto-fail1'")).rows.length)).toBe(0)
  })

  it("rejects viewers, outsiders, anon, bad input and cross-org reads", async () => {
    await expect(capture(org.members.viewer, org.organizationId, { note: "x", intent: "capture_only", key: "web-view-0001" })).rejects.toThrow(/权限/)
    await expect(capture(other.members.owner, org.organizationId, { note: "x", intent: "capture_only", key: "web-out-00001" })).rejects.toThrow(/权限/)
    await expect(db.asAnon((tx) => tx.query("select public.quick_capture($1,null,'x','capture_only','{}','web-anon-0001')", [org.organizationId]))).rejects.toThrow(/permission denied/)
    await expect(capture(org.members.owner, org.organizationId, { intent: "capture_only", key: "web-empty-001" })).rejects.toThrow(/链接或一句话/)
    await expect(capture(org.members.owner, org.organizationId, { url: "javascript:alert(1)", intent: "capture_only", key: "web-bad-00001" })).rejects.toThrow(/http/)
    await expect(capture(org.members.owner, org.organizationId, { url: "https://u:p@example.com/", intent: "capture_only", key: "web-bad-00002" })).rejects.toThrow(/http/)
    await expect(capture(org.members.owner, org.organizationId, { note: "x", intent: "auto_draft", platforms: ["myspace"], key: "web-bad-00003" })).rejects.toThrow(/不支持的平台/)
    await expect(capture(org.members.owner, org.organizationId, { note: "x", intent: "capture_only", key: "short" })).rejects.toThrow(/幂等键/)
    // other org sees nothing
    const seen = await db.asUser(other.members.owner, async (tx) => ({
      ev: (await tx.query("select * from public.intake_events")).rows.length,
      items: (await tx.query("select * from public.work_items")).rows.length,
      jobs: (await tx.query("select * from public.agent_jobs")).rows.length,
    }))
    expect(seen).toEqual({ ev: 0, items: 0, jobs: 0 })
    // direct writes are not allowed
    await expect(db.asUser(org.members.owner, (tx) => tx.query("delete from public.intake_events"))).rejects.toThrow(/permission denied/)
    // service_role cannot call the browser entry as if it were a user
    await expect(db.asServiceRole((tx) => tx.query("select public.quick_capture($1,null,'x','capture_only','{}','web-svc-00001')", [org.organizationId]))).rejects.toThrow()
  })
})

describe("quick_capture rate limit", () => {
  it("rejects the 121st web capture within an hour, per user", async () => {
    const rl = await seedOrganization(db, { members: [{ role: "owner" }] })
    await db.asPostgres((tx) =>
      tx.query("insert into public.intake_events(organization_id,source,external_id,text,created_by) select $1,'web','rl-'||n,'x',$2 from generate_series(1,120) n", [rl.organizationId, rl.members.owner]))
    await expect(capture(rl.members.owner, rl.organizationId, { note: "多一条", intent: "capture_only", key: "web-rate-0001" })).rejects.toThrow(/rate_limited/)
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
    expect(r.work_item_id).toBeTruthy()
    const job = await db.asPostgres((tx) => tx.query<{ created_by: string }>("select created_by from public.agent_jobs where id=$1", [r.documents[0].job_id]))
    expect(job.rows[0].created_by).toBe(org.members.member)
    const ev = await db.asPostgres((tx) => tx.query<{ source: string; connection_id: string | null }>("select source, connection_id from public.intake_events where id=$1", [r.event_id]))
    expect(ev.rows[0].source).toBe("api")
    expect(ev.rows[0].connection_id).toBeTruthy()
    expect((await call(input)).duplicate).toBe(true)
    await expect(call({ ...input, text: "改了" })).rejects.toThrow(/idempotency_conflict/)
  })

  it("intent capture is treated as capture_only; accept_intake keeps the V1 contract", async () => {
    const r = await call({ version: 1, intent: "capture", external_id: "im:msg-2", text: "收藏", title: "收藏" })
    expect(r).toMatchObject({ intent: "capture_only", work_item_id: null, documents: [] })
    const receipt = await db.asServiceRole(async (tx) => (await tx.query<{ r: Record<string, unknown> }>("select public.accept_intake($1,$2) as r", [hash, { version: 1, intent: "capture", external_id: "v1-1", text: "原始想法", title: "选题", url: "https://example.com" }])).rows[0].r)
    expect(receipt).toMatchObject({ duplicate: false, status: "captured", topic_path: "/intake" })
    expect(receipt.receipt_id).toBe(receipt.event_id)
    const again = await db.asServiceRole(async (tx) => (await tx.query<{ r: Record<string, unknown> }>("select public.accept_intake($1,$2) as r", [hash, { version: 1, intent: "capture", external_id: "v1-1", text: "原始想法", title: "选题", url: "https://example.com" }])).rows[0].r)
    expect(again).toMatchObject({ duplicate: true, event_id: receipt.event_id })
    await expect(db.asServiceRole((tx) => tx.query("select public.accept_intake($1,$2)", [hash, { version: 1, intent: "auto_draft", external_id: "v1-2", text: "x", title: "t" }]))).rejects.toThrow(/invalid_input/)
  })

  it("rejects bad tokens, revoked/expired connections, creators without permission and non-service callers", async () => {
    const draft = { version: 1, intent: "auto_draft", external_id: "im:msg-3", text: "t" }
    await expect(call(draft, "b".repeat(64))).rejects.toThrow(/invalid_connection/)
    const h2 = "c".repeat(64)
    await db.asPostgres((tx) => tx.query("insert into public.intake_connections(organization_id,created_by,name,adapter,token_hash,revoked_at) values($1,$2,'old','generic',$3,now())", [org.organizationId, org.members.member, h2]))
    await expect(call({ version: 1, intent: "capture", external_id: "r1", text: "t" }, h2)).rejects.toThrow(/invalid_connection/)
    const h3 = "d".repeat(64)
    await db.asPostgres((tx) => tx.query("insert into public.intake_connections(organization_id,created_by,name,adapter,token_hash,expires_at) values($1,$2,'exp','generic',$3,now())", [org.organizationId, org.members.member, h3]))
    await expect(call({ version: 1, intent: "capture", external_id: "e1", text: "t" }, h3)).rejects.toThrow(/invalid_connection/)
    // creator keeps content.manage but loses agent.dispatch: auto_draft refused, capture_only still works
    await db.asPostgres((tx) => tx.query("update public.organization_roles set permissions=array['content.view','content.manage'] where organization_id=$1 and role_key='member'", [org.organizationId]))
    await expect(call({ ...draft, external_id: "im:msg-3a" })).rejects.toThrow(/invalid_connection/)
    expect((await call({ version: 1, intent: "capture_only", external_id: "im:msg-3b", text: "仍可收录" })).duplicate).toBe(false)
    // creator loses content.manage: everything refused
    await db.asPostgres((tx) => tx.query("update public.organization_roles set permissions=array['content.view'] where organization_id=$1 and role_key='member'", [org.organizationId]))
    await expect(call({ version: 1, intent: "capture_only", external_id: "im:msg-3c", text: "t" })).rejects.toThrow(/invalid_connection/)
    await expect(db.asUser(org.members.owner, (tx) => tx.query("select public.quick_capture_for_connection($1,'{}')", [hash]))).rejects.toThrow(/permission denied/)
  })

  it("rate limits a connection at 100 events per hour", async () => {
    const h = "e".repeat(64)
    const id = await db.asPostgres(async (tx) => {
      const c = await tx.query<{ id: string }>("insert into public.intake_connections(organization_id,created_by,name,adapter,token_hash) values($1,$2,'busy','generic',$3) returning id", [org.organizationId, org.members.owner, h])
      await tx.query("insert into public.intake_events(organization_id,source,connection_id,external_id,text) select $1,'api',$2,'rl-'||n,'x' from generate_series(1,100) n", [org.organizationId, c.rows[0].id])
      return c.rows[0].id
    })
    expect(id).toBeTruthy()
    await expect(call({ version: 1, intent: "capture", external_id: "over", text: "t" }, h)).rejects.toThrow(/rate_limited/)
  })
})

describe("cross-org isolation", () => {
  it("another organization sees none of the events, work items or jobs", async () => {
    const seen = await db.asUser(other.members.owner, async (tx) => ({
      ev: (await tx.query("select 1 from public.intake_events")).rows.length,
      items: (await tx.query("select 1 from public.work_items")).rows.length,
      docs: (await tx.query("select 1 from public.content_documents")).rows.length,
    }))
    expect(seen).toEqual({ ev: 0, items: 0, docs: 0 })
  })
})
