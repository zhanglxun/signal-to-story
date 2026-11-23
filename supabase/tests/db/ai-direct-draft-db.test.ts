// @vitest-environment node
// DB2c-3 (docs/database.md §4.3, DB-D15): AI writes directly to content_documents via
// write_document_draft / node_write_document_draft with base_revision optimistic concurrency.
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createSupabaseTestDb, seedOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"
import { enqueueDemoJob, seedDemoWorkspace, type DemoWorkspace } from "../../../workers/agent/demo/demo-scenario"

let db: SupabaseTestDb
let ws: DemoWorkspace

const createNode = (userId: string, orgId: string, name = "节点") =>
  db.asUser(userId, async (tx) => (await tx.query<{ r: { id: string; token: string } }>("select public.create_runner_node($1,$2) as r", [orgId, name])).rows[0].r)
const anon = <T = unknown>(sql: string, params: unknown[]) => db.asAnon(async (tx) => (await tx.query<{ r: T }>(sql, params)).rows[0]?.r)
const claim = (token: string) => anon<{ id: string; lease_epoch: number } | null>("select public.node_claim($1, array['content_draft'], 120) as r", [token])

beforeEach(async () => {
  db = await createSupabaseTestDb()
  ws = await seedDemoWorkspace(db)
})
afterEach(async () => {
  await db.close()
})

describe("ai direct draft write (DB2c-3)", () => {
  it("bumps revision, writes audit, records written_revision, and is idempotent on retry", async () => {
    const node = await createNode(ws.ownerId, ws.organizationId)
    const job = await enqueueDemoJob(db, ws, "direct-1")
    const claimed = await claim(node.token)
    expect(claimed).not.toBeNull()

    const first = await anon<{ document_id: string; revision: number; already_written: boolean }>(
      "select public.node_write_document_draft($1,$2,$3,$4,1,'光遗传学不是读心术（修订）','AI 生成的新正文内容') as r",
      [node.token, claimed!.id, claimed!.lease_epoch, ws.documentId]
    )
    expect(first).toEqual({ document_id: ws.documentId, revision: 2, already_written: false })

    // Second call for the same job (crash recovery after write) returns the recorded revision without bumping to v3.
    const second = await anon<{ document_id: string; revision: number; already_written: boolean }>(
      "select public.node_write_document_draft($1,$2,$3,$4,1,'忽略的标题','忽略的正文') as r",
      [node.token, claimed!.id, claimed!.lease_epoch, ws.documentId]
    )
    expect(second).toEqual({ document_id: ws.documentId, revision: 2, already_written: true })

    const seen = await db.asPostgres(async (tx) => ({
      doc: (await tx.query<{ title: string; body: string; revision: number; status: string; review_note: string }>(
        "select title, body, revision, status, review_note from public.content_documents where id=$1", [ws.documentId])).rows[0],
      job: (await tx.query<{ result: Record<string, unknown> }>("select result from public.agent_jobs where id=$1", [job.id])).rows[0],
      audit: (await tx.query<{ action: string; actor_user_id: string; metadata: Record<string, unknown> }>(
        "select action, actor_user_id, metadata from public.audit_events where target_id=$1 and action='content.ai_draft_written'", [ws.documentId])).rows,
    }))

    expect(seen.doc).toEqual({
      title: "光遗传学不是读心术（修订）",
      body: "AI 生成的新正文内容",
      revision: 2,
      status: "draft",
      review_note: "",
    })
    expect(seen.job.result).toEqual({ written_document_id: ws.documentId, written_revision: 2 })
    expect(seen.audit).toEqual([{
      action: "content.ai_draft_written",
      actor_user_id: ws.ownerId,
      metadata: { job_id: job.id, base_revision: 1, revision: 2 },
    }])
  })

  it("refuses to overwrite when a human edited the document (base_revision mismatch)", async () => {
    const node = await createNode(ws.ownerId, ws.organizationId)
    await enqueueDemoJob(db, ws, "stale-1")
    const claimed = await claim(node.token)

    await db.asUser(ws.ownerId, (tx) => tx.query("update public.content_documents set body='人工刚改过的正文' where id=$1", [ws.documentId]))

    await expect(
      anon("select public.node_write_document_draft($1,$2,$3,$4,1,null,'AI 覆盖正文') as r", [node.token, claimed!.id, claimed!.lease_epoch, ws.documentId])
    ).rejects.toThrow(/stale_revision/)

    const doc = await db.asPostgres((tx) => tx.query<{ body: string; revision: number }>("select body, revision from public.content_documents where id=$1", [ws.documentId]))
    expect(doc.rows[0]).toEqual({ body: "人工刚改过的正文", revision: 2 })
  })

  it("expires v1 pending and approved approval_requests when AI writes v2", async () => {
    const node = await createNode(ws.ownerId, ws.organizationId)
    const job = await enqueueDemoJob(db, ws, "expire-1")
    const approvedReq = await db.asUser(ws.ownerId, async (tx) =>
      (await tx.query<{ id: string }>(
        "select (public.create_approval_request($1,'publish_site','content_document',$2,1,'publish v1')).id",
        [ws.organizationId, ws.documentId]
      )).rows[0].id
    )
    await db.asUser(ws.ownerId, (tx) => tx.query("select public.decide_approval_request($1,'approved','ok')", [approvedReq]))
    const pendingReq = await db.asUser(ws.ownerId, async (tx) =>
      (await tx.query<{ id: string }>(
        "select (public.create_approval_request($1,'publish_external','content_document',$2,1,'ext v1')).id",
        [ws.organizationId, ws.documentId]
      )).rows[0].id
    )

    const claimed = await claim(node.token)
    expect(claimed!.id).toBe(job.id)
    await anon("select public.node_write_document_draft($1,$2,$3,$4,1,null,'AI v2 正文') as r", [node.token, claimed!.id, claimed!.lease_epoch, ws.documentId])

    const statuses = await db.asPostgres(async (tx) =>
      (await tx.query<{ id: string; status: string }>("select id, status from public.approval_requests where id = any($1) order by id", [[approvedReq, pendingReq]])).rows
    )
    expect(statuses.every((r) => r.status === "expired")).toBe(true)
  })

  it("enforces role, node ownership, lease_epoch, target match, and creator permission boundaries", async () => {
    const nodeA = await createNode(ws.ownerId, ws.organizationId, "A")
    const nodeB = await createNode(ws.ownerId, ws.organizationId, "B")
    const job = await enqueueDemoJob(db, ws, "sec-1")
    const claimed = await claim(nodeA.token)

    // Direct write_document_draft is service_role only.
    await expect(db.asAnon((tx) => tx.query("select public.write_document_draft($1,1,$2,1,null,'x')", [job.id, ws.documentId]))).rejects.toThrow(/permission denied/)
    await expect(db.asUser(ws.ownerId, (tx) => tx.query("select public.write_document_draft($1,1,$2,1,null,'x')", [job.id, ws.documentId]))).rejects.toThrow(/permission denied/)

    // Peer node, cross-org node, wrong lease epoch, wrong target document.
    await expect(anon("select public.node_write_document_draft($1,$2,$3,$4,1,null,'x') as r", [nodeB.token, claimed!.id, claimed!.lease_epoch, ws.documentId])).rejects.toThrow(/不由本节点执行/)
    const other = await seedOrganization(db, { members: [{ role: "owner" }] })
    const foreignNode = await createNode(other.members.owner, other.organizationId, "F")
    await expect(anon("select public.node_write_document_draft($1,$2,$3,$4,1,null,'x') as r", [foreignNode.token, claimed!.id, claimed!.lease_epoch, ws.documentId])).rejects.toThrow(/不由本节点执行/)
    await expect(anon("select public.node_write_document_draft($1,$2,99,$3,1,null,'x') as r", [nodeA.token, claimed!.id, ws.documentId])).rejects.toThrow(/lease_epoch/)

    const otherDoc = await db.asUser(ws.ownerId, async (tx) => {
      const item = (await tx.query<{ id: string }>("insert into public.work_items(organization_id,title) values($1,'他卡') returning id", [ws.organizationId])).rows[0].id
      return (await tx.query<{ id: string }>("insert into public.content_documents(organization_id,work_item_id,platform,title,body) values($1,$2,'master','T','B') returning id", [ws.organizationId, item])).rows[0].id
    })
    await expect(anon("select public.node_write_document_draft($1,$2,$3,$4,1,null,'x') as r", [nodeA.token, claimed!.id, claimed!.lease_epoch, otherDoc])).rejects.toThrow(/目标稿件不匹配/)

    // Revoked holder node cannot write.
    await db.asUser(ws.ownerId, (tx) => tx.query("select public.revoke_runner_node($1)", [nodeA.id]))
    await expect(anon("select public.node_write_document_draft($1,$2,$3,$4,1,null,'x') as r", [nodeA.token, claimed!.id, claimed!.lease_epoch, ws.documentId])).rejects.toThrow(/已吊销/)

    // Creator who lost content.manage permission cannot have drafts written on their behalf.
    const org2 = await seedOrganization(db, { members: [{ role: "owner" }, { role: "member", permissions: ["content.view", "content.manage", "agent.dispatch"] }, { role: "viewer", permissions: ["content.view"] }] })
    const doc2 = await db.asUser(org2.members.owner, async (tx) => {
      const item = (await tx.query<{ id: string }>("insert into public.work_items(organization_id,title) values($1,'K') returning id", [org2.organizationId])).rows[0].id
      return (await tx.query<{ id: string }>("insert into public.content_documents(organization_id,work_item_id,platform,title,body) values($1,$2,'master','T','B') returning id", [org2.organizationId, item])).rows[0].id
    })
    await db.asUser(org2.members.member, (tx) =>
      tx.query("select public.enqueue_agent_job($1,'content_draft','lost-perm','{\"instruction\":\"x\"}'::jsonb,'content_document',$2,1)", [org2.organizationId, doc2])
    )
    const node2 = await createNode(org2.members.owner, org2.organizationId, "N2")
    const claimed2 = await claim(node2.token)
    await db.asPostgres((tx) => tx.query("update public.organization_members set role='viewer' where organization_id=$1 and user_id=$2", [org2.organizationId, org2.members.member]))
    await expect(anon("select public.node_write_document_draft($1,$2,$3,$4,1,null,'x') as r", [node2.token, claimed2!.id, claimed2!.lease_epoch, doc2])).rejects.toThrow(/无内容编辑权限/)
  })

  it("marks matching pending_review content_draft job succeeded when human approves the document without moving work_items", async () => {
    const node = await createNode(ws.ownerId, ws.organizationId)
    const job = await enqueueDemoJob(db, ws, "approve-1")
    const claimed = await claim(node.token)

    await anon("select public.node_write_document_draft($1,$2,$3,$4,1,null,'待审核正文') as r", [node.token, claimed!.id, claimed!.lease_epoch, ws.documentId])
    await anon("select public.node_complete($1,$2,$3,'pending_review',$4::jsonb) as r", [
      node.token,
      claimed!.id,
      claimed!.lease_epoch,
      JSON.stringify({ written_revision: 2 }),
    ])

    const itemBefore = await db.asPostgres((tx) => tx.query<{ id: string; status: string }>(
      "select w.id, w.status from public.work_items w join public.content_documents d on d.work_item_id=w.id where d.id=$1", [ws.documentId]
    ))
    expect(itemBefore.rows[0].status).toBe("review")

    await db.asUser(ws.ownerId, async (tx) => {
      await tx.query("update public.content_documents set status='in_review' where id=$1", [ws.documentId])
      await tx.query("update public.content_documents set status='approved', review_note='通过' where id=$1", [ws.documentId])
    })

    const after = await db.asPostgres(async (tx) => ({
      job: (await tx.query<{ status: string; result: Record<string, unknown> }>("select status, result from public.agent_jobs where id=$1", [job.id])).rows[0],
      item: (await tx.query<{ status: string }>("select status from public.work_items where id=$1", [itemBefore.rows[0].id])).rows[0],
    }))
    expect(after.job.status).toBe("succeeded")
    expect(after.job.result).toMatchObject({ written_revision: 2, approved_revision: 2 })
    expect(after.item.status).toBe("review")
  })
})
