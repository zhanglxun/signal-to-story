// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createSupabaseTestDb, runSqlAcceptanceScript, seedOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"

let db: SupabaseTestDb

beforeAll(async () => {
  db = await createSupabaseTestDb()
})
afterAll(async () => {
  await db?.close()
})

async function expectDenied(promise: Promise<unknown>, pattern?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as Error
  )
  expect(error, "expected the database to refuse").not.toBeNull()
  if (pattern) expect(error?.message).toMatch(pattern)
}

async function createDocument(userId: string, organizationId: string) {
  return db.asUser(userId, async (tx) => {
    const p = await tx.query<{ id: string }>("insert into public.content_projects(organization_id,title) values($1,'P') returning id", [organizationId])
    const d = await tx.query<{ id: string }>("insert into public.content_documents(organization_id,project_id,platform,title,body) values($1,$2,'x','T','B') returning id", [organizationId, p.rows[0].id])
    return d.rows[0].id
  })
}

async function enqueue(userId: string, organizationId: string, documentId: string, key: string, revision = 1) {
  return db.asUser(userId, async (tx) => {
    const r = await tx.query<{ id: string; status: string }>(
      "select (j).id, (j).status from (select public.enqueue_agent_job($1,'content_draft',$2,'{\"instruction\":\"x\"}'::jsonb,'content_document',$3,$4) j) s",
      [organizationId, key, documentId, revision]
    )
    return r.rows[0]
  })
}

describe("PGlite harness applies the full migration history", () => {
  it("applies every migration including the P1.5 kernel", () => {
    expect(db.appliedMigrations.length).toBeGreaterThanOrEqual(16)
    expect(db.appliedMigrations).toContain("20261115100200_approval_requests_mandate.sql")
  })

  it.each(["cloud_content_mvp.sql", "intake_gateway.sql", "agent_harness_kernel.sql"])("SQL acceptance script %s passes", async (file) => {
    await expect(runSqlAcceptanceScript(db, file)).resolves.toBeDefined()
  })
})

describe("agent_jobs RLS and queue RPCs", () => {
  it("isolates jobs and steps across organizations", async () => {
    const a = await seedOrganization(db, { members: [{ role: "owner" }] })
    const b = await seedOrganization(db, { members: [{ role: "owner" }] })
    const doc = await createDocument(a.members.owner, a.organizationId)
    const job = await enqueue(a.members.owner, a.organizationId, doc, "iso-1")
    const visibleToB = await db.asUser(b.members.owner, (tx) => tx.query("select id from public.agent_jobs where id=$1", [job.id]))
    expect(visibleToB.rows).toHaveLength(0)
    // B cannot enqueue against A's document or organization
    await expectDenied(enqueue(b.members.owner, a.organizationId, doc, "iso-2"), /权限/)
    await expectDenied(enqueue(b.members.owner, b.organizationId, doc, "iso-3"), /稿件/)
  })

  it("never hands the same job to two concurrent workers", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    const doc = await createDocument(org.members.owner, org.organizationId)
    for (let i = 0; i < 5; i++) await enqueue(org.members.owner, org.organizationId, doc, `conc-${i}`)
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        db.asServiceRole((tx) => tx.query<{ id: string; organization_id: string }>("select id, organization_id from public.claim_agent_job($1, array['content_draft'], 60)", [`w${i}`]))
      )
    )
    const mine = claims.flatMap((r) => r.rows).filter((r) => r.organization_id === org.organizationId).map((r) => r.id)
    expect(new Set(mine).size).toBe(mine.length)
    expect(mine.length).toBe(5)
  })

  it("recovers expired leases and fails jobs that exhausted attempts", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    const doc = await createDocument(org.members.owner, org.organizationId)
    const job = await enqueue(org.members.owner, org.organizationId, doc, "lease-1")
    await db.asServiceRole((tx) => tx.query("select * from public.claim_agent_job('crashy', array['content_draft'], 60)"))
    // simulate a crashed worker whose lease expired
    await db.asPostgres((tx) => tx.query("update public.agent_jobs set locked_until = now() - interval '1 second', priority = 0 where id=$1", [job.id]))
    const reclaimed = await db.asServiceRole((tx) => tx.query<{ id: string; attempts: number }>("select id, attempts from public.claim_agent_job('w2', array['content_draft'], 60)"))
    expect(reclaimed.rows[0]).toMatchObject({ id: job.id, attempts: 2 })
    await db.asPostgres((tx) => tx.query("update public.agent_jobs set locked_until = now() - interval '1 second' where id=$1", [job.id]))
    await db.asServiceRole((tx) => tx.query("select * from public.claim_agent_job('w3', array['nothing'], 60)"))
    const final = await db.asPostgres((tx) => tx.query<{ status: string; error_code: string }>("select status, error_code from public.agent_jobs where id=$1", [job.id]))
    expect(final.rows[0]).toMatchObject({ status: "failed", error_code: "lease_expired" })
  })

  it("only lets the lease holder complete, and fail() does not retry billable errors", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    const doc = await createDocument(org.members.owner, org.organizationId)
    const job = await enqueue(org.members.owner, org.organizationId, doc, "own-1")
    await db.asPostgres((tx) => tx.query("update public.agent_jobs set priority=0 where id=$1", [job.id]))
    await db.asServiceRole((tx) => tx.query("select * from public.claim_agent_job('owner-w', array['content_draft'], 60)"))
    await expectDenied(db.asServiceRole((tx) => tx.query("select public.complete_agent_job($1,'intruder','succeeded')", [job.id])), /租约/)
    await db.asServiceRole((tx) => tx.query("select public.fail_agent_job($1,'owner-w','timeout',false)", [job.id]))
    const row = await db.asPostgres((tx) => tx.query<{ status: string }>("select status from public.agent_jobs where id=$1", [job.id]))
    expect(row.rows[0].status).toBe("failed")
  })

  it("lets humans cancel and resume, never browsers write jobs directly", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "viewer" }] })
    const doc = await createDocument(org.members.owner, org.organizationId)
    const job = await enqueue(org.members.owner, org.organizationId, doc, "cancel-1")
    await expectDenied(db.asUser(org.members.viewer, (tx) => tx.query("select public.cancel_agent_job($1)", [job.id])))
    await expectDenied(db.asUser(org.members.owner, (tx) => tx.query("insert into public.agent_jobs(organization_id,job_type,idempotency_key) values($1,'content_draft','direct')", [org.organizationId])))
    const cancelled = await db.asUser(org.members.owner, (tx) => tx.query<{ status: string }>("select (public.cancel_agent_job($1)).status", [job.id]))
    expect(cancelled.rows[0].status).toBe("cancelled")
  })
})

describe("Mandate approvals", () => {
  async function setup() {
    const org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "member" }] })
    const doc = await createDocument(org.members.owner, org.organizationId)
    const draftJob = await enqueue(org.members.owner, org.organizationId, doc, `m-${crypto.randomUUID()}`)
    const ap = await db.asServiceRole((tx) =>
      tx.query<{ id: string; status: string }>(
        "select (a).id, (a).status from (select public.create_approval_request($1,'publish_external','content_document',$2,1,'publish','{}'::jsonb,null,$3) a) s",
        [org.organizationId, doc, draftJob.id]
      )
    )
    return { org, doc, approvalId: ap.rows[0].id }
  }

  it("agent (service_role) can create but never decide", async () => {
    const { approvalId } = await setup()
    await expectDenied(db.asServiceRole((tx) => tx.query("select public.decide_approval_request($1,'approved','')", [approvalId])), /permission denied|人类/)
    await expectDenied(db.asServiceRole((tx) => tx.query("update public.approval_requests set status='approved' where id=$1", [approvalId])), /permission denied/)
    // even a forged sub inside a service_role session cannot satisfy the role check
    await expectDenied(
      db.asServiceRole(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: crypto.randomUUID(), role: "service_role" })])
        return tx.query("select public.decide_approval_request($1,'approved','')", [approvalId])
      })
    )
  })

  it("requires the action permission; member cannot approve publishing", async () => {
    const { org, approvalId } = await setup()
    await expectDenied(db.asUser(org.members.member, (tx) => tx.query("select public.decide_approval_request($1,'approved','')", [approvalId])), /权限/)
    const ok = await db.asUser(org.members.owner, (tx) => tx.query<{ status: string }>("select (public.decide_approval_request($1,'approved','ok')).status", [approvalId]))
    expect(ok.rows[0].status).toBe("approved")
  })

  it("expires approvals when the target revision changes and blocks the gated job", async () => {
    const { org, doc, approvalId } = await setup()
    await db.asUser(org.members.owner, (tx) => tx.query("select public.decide_approval_request($1,'approved','ok')", [approvalId]))
    // queueing a gated job without approval is refused even for service_role
    await expectDenied(
      db.asServiceRole((tx) => tx.query("insert into public.agent_jobs(organization_id,job_type,idempotency_key,target_type,target_id,target_revision) values($1,'publish_external','no-ap','content_document',$2,1)", [org.organizationId, doc])),
      /Mandate/
    )
    await db.asServiceRole((tx) =>
      tx.query(
        "insert into public.agent_jobs(organization_id,job_type,idempotency_key,target_type,target_id,target_revision,approval_request_id,priority) values($1,'publish_external','with-ap','content_document',$2,1,$3,0)",
        [org.organizationId, doc, approvalId]
      )
    )
    await db.asUser(org.members.owner, (tx) => tx.query("update public.content_documents set body='v2' where id=$1", [doc]))
    const ap = await db.asPostgres((tx) => tx.query<{ status: string }>("select status from public.approval_requests where id=$1", [approvalId]))
    expect(ap.rows[0].status).toBe("expired")
    const claimed = await db.asServiceRole((tx) => tx.query("select * from public.claim_agent_job('pub-w', array['publish_external'], 60)"))
    expect(claimed.rows.filter((r) => (r as { organization_id: string }).organization_id === org.organizationId)).toHaveLength(0)
    const job = await db.asPostgres((tx) => tx.query<{ status: string; error_code: string }>("select status, error_code from public.agent_jobs where idempotency_key='with-ap' and organization_id=$1", [org.organizationId]))
    expect(job.rows[0]).toMatchObject({ status: "blocked_needs_human", error_code: "mandate_invalid" })
    // and an expired approval cannot be re-approved
    await expectDenied(db.asUser(org.members.owner, (tx) => tx.query("select public.decide_approval_request($1,'approved','again')", [approvalId])), /已处理/)
  })

  it("keeps the existing human publication gate: service_role cannot record publications", async () => {
    const { org, doc } = await setup()
    const channel = await db.asUser(org.members.owner, (tx) => tx.query<{ id: string }>("insert into public.publishing_channels(organization_id,platform,name) values($1,'x','acct') returning id", [org.organizationId]))
    await expectDenied(
      db.asServiceRole((tx) => tx.query("insert into public.content_publications(organization_id,document_id,revision,channel_id,scheduled_at) values($1,$2,1,$3,now())", [org.organizationId, doc, channel.rows[0].id])),
      /登录|permission/
    )
  })
})

describe("knowledge_entries and decision_memories", () => {
  it("keeps imports unreviewed, needs a reviewer to trust, and agents are read-only", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "member" }] })
    const inserted = await db.asUser(org.members.member, (tx) =>
      tx.query<{ id: string; trust_level: string }>("insert into public.knowledge_entries(organization_id,slug,title,content,trust_level) values($1,'note','N','<b>raw</b>','unreviewed') returning id, trust_level", [org.organizationId])
    )
    expect(inserted.rows[0].trust_level).toBe("unreviewed")
    await expectDenied(db.asUser(org.members.member, (tx) => tx.query("insert into public.knowledge_entries(organization_id,slug,title,content,trust_level) values($1,'sneaky','S','x','trusted')", [org.organizationId])), /审核者/)
    await db.asUser(org.members.owner, (tx) => tx.query("update public.knowledge_entries set trust_level='trusted' where id=$1", [inserted.rows[0].id]))
    const trusted = await db.asServiceRole((tx) => tx.query<{ trust_level: string; reviewed_by: string }>("select trust_level, reviewed_by from public.knowledge_entries where id=$1", [inserted.rows[0].id]))
    expect(trusted.rows[0]).toMatchObject({ trust_level: "trusted", reviewed_by: org.members.owner })
    await expectDenied(db.asServiceRole((tx) => tx.query("update public.knowledge_entries set content='agent edit' where id=$1", [inserted.rows[0].id])), /permission denied/)
    await expectDenied(db.asServiceRole((tx) => tx.query("insert into public.decision_memories(organization_id,kind,summary,created_by) values($1,'style_rule','x',$2)", [org.organizationId, org.members.owner])), /permission denied/)
  })

  it("seed SQL loads repository knowledge as trusted for every organization", async () => {
    const { readFileSync } = await import("node:fs")
    const { GENERATED_SQL } = await import("../../../sense-console/scripts/knowledge-seed")
    await db.db.exec(readFileSync(GENERATED_SQL, "utf8"))
    const rows = await db.asPostgres((tx) => tx.query<{ n: number }>("select count(*)::int n from public.knowledge_entries where slug='text-content-sop' and trust_level='trusted' and source_path like 'knowledge-base/%'"))
    const orgs = await db.asPostgres((tx) => tx.query<{ n: number }>("select count(*)::int n from public.organizations"))
    expect(rows.rows[0].n).toBe(orgs.rows[0].n)
  })
})
