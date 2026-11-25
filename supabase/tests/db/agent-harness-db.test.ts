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
    const p = await tx.query<{ id: string }>("insert into public.work_items(organization_id,title) values($1,'P') returning id", [organizationId])
    const d = await tx.query<{ id: string }>("insert into public.content_documents(organization_id,work_item_id,platform,title,body) values($1,$2,'x','T','B') returning id", [organizationId, p.rows[0].id])
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

/** Claim exactly this job (other tests' queued jobs share the database) and return its lease epoch. */
async function claimJob(jobId: string): Promise<number> {
  return db.asPostgres(async (tx) => {
    await tx.query("update public.agent_jobs set run_after = now() + interval '1 hour' where status = 'queued' and id <> $1", [jobId])
    await tx.query("set local role service_role")
    await tx.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)")
    const r = await tx.query<{ id: string; lease_epoch: number }>("select id, lease_epoch from public.claim_agent_job(array['content_draft'], 60)")
    await tx.query("reset role")
    await tx.query("update public.agent_jobs set run_after = now() where status = 'queued' and run_after > now() + interval '50 minutes'")
    expect(r.rows[0]?.id).toBe(jobId)
    return Number(r.rows[0].lease_epoch)
  })
}

describe("PGlite harness applies the full migration history", () => {
  it("applies every migration including the P1.5 kernel", () => {
    expect(db.appliedMigrations.length).toBeGreaterThanOrEqual(16)
    expect(db.appliedMigrations).toContain("20261115100200_approval_requests_mandate.sql")
  })

  it.each(["intake_gateway.sql", "agent_harness_kernel.sql"])("SQL acceptance script %s passes", async (file) => {
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
    // One card per job: a card runs at most one non-chat job at a time (agent_jobs_one_running_per_item).
    for (let i = 0; i < 5; i++) {
      const doc = await createDocument(org.members.owner, org.organizationId)
      await enqueue(org.members.owner, org.organizationId, doc, `conc-${i}`)
    }
    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.asServiceRole((tx) => tx.query<{ id: string; organization_id: string }>("select id, organization_id from public.claim_agent_job(array['content_draft'], 60)"))
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
    // FIFO by run_after: move this job to the front of the shared queue
    await db.asPostgres((tx) => tx.query("update public.agent_jobs set run_after = now() - interval '1 day' where id=$1", [job.id]))
    await db.asServiceRole((tx) => tx.query("select * from public.claim_agent_job(array['content_draft'], 60)"))
    // simulate a crashed worker whose lease expired
    await db.asPostgres((tx) => tx.query("update public.agent_jobs set locked_until = now() - interval '1 second' where id=$1", [job.id]))
    const reclaimed = await db.asServiceRole((tx) => tx.query<{ id: string; attempts: number; lease_epoch: number }>("select id, attempts, lease_epoch from public.claim_agent_job(array['content_draft'], 60)"))
    expect(reclaimed.rows[0]).toMatchObject({ id: job.id, attempts: 2 })
    expect(Number(reclaimed.rows[0].lease_epoch)).toBe(2)
    await db.asPostgres((tx) => tx.query("update public.agent_jobs set locked_until = now() - interval '1 second' where id=$1", [job.id]))
    await db.asServiceRole((tx) => tx.query("select * from public.claim_agent_job(array['nothing'], 60)"))
    const final = await db.asPostgres((tx) => tx.query<{ status: string; error_code: string }>("select status, error_code from public.agent_jobs where id=$1", [job.id]))
    expect(final.rows[0]).toMatchObject({ status: "failed", error_code: "lease_expired" })
  })

  it("only lets the current lease complete, and fail() does not retry billable errors", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    const doc = await createDocument(org.members.owner, org.organizationId)
    const job = await enqueue(org.members.owner, org.organizationId, doc, "own-1")
    const epoch = await claimJob(job.id)
    await expectDenied(db.asServiceRole((tx) => tx.query("select public.complete_agent_job($1,$2,'succeeded')", [job.id, epoch - 1])), /租约/)
    await db.asServiceRole((tx) => tx.query("select public.fail_agent_job($1,$2,'timeout',false)", [job.id, epoch]))
    const row = await db.asPostgres((tx) => tx.query<{ status: string }>("select status from public.agent_jobs where id=$1", [job.id]))
    expect(row.rows[0].status).toBe("failed")
  })

  it("rejects every write from a stale lease after the job was re-claimed", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    const doc = await createDocument(org.members.owner, org.organizationId)
    const job = await enqueue(org.members.owner, org.organizationId, doc, "epoch-1")
    const first = await claimJob(job.id)
    await db.asServiceRole((tx) => tx.query("select public.record_agent_job_step($1,$2,'context','succeeded','{\"round\":0}'::jsonb)", [job.id, first]))
    // node A goes silent; its lease expires and node B claims the job again
    await db.asPostgres((tx) => tx.query("update public.agent_jobs set locked_until = now() - interval '1 second' where id=$1", [job.id]))
    const second = await claimJob(job.id)
    expect(second).toBe(first + 1)
    const late = (sql: string, params: unknown[]) => expectDenied(db.asServiceRole((tx) => tx.query(sql, params)), /租约|lease_epoch/)
    await late("select public.record_agent_job_step($1,$2,'generate')", [job.id, first])
    await late("select public.complete_agent_job($1,$2,'pending_review')", [job.id, first])
    await late("select public.fail_agent_job($1,$2,'x',true)", [job.id, first])
    await late(`select public.ask_question($1,'{"title":"t"}'::jsonb,$2)`, [job.id, first])
    const beat = await db.asServiceRole((tx) => tx.query<{ b: { ok: boolean } }>("select public.heartbeat_agent_job($1,$2,60) b", [job.id, first]))
    expect(beat.rows[0].b.ok).toBe(false)
    // the current lease writes fine; seq continues and steps are append-only
    await db.asServiceRole((tx) => tx.query("select public.record_agent_job_step($1,$2,'generate','succeeded','{\"round\":1}'::jsonb,'{\"cost_cents\":1}'::jsonb)", [job.id, second]))
    const steps = await db.asPostgres((tx) => tx.query<{ seq: number; kind: string }>("select seq, kind from public.agent_job_steps where job_id=$1 order by seq", [job.id]))
    expect(steps.rows).toEqual([{ seq: 1, kind: "context" }, { seq: 2, kind: "generate" }])
    await expectDenied(db.asPostgres((tx) => tx.query("update public.agent_job_steps set status='failed' where job_id=$1", [job.id])), /只追加/)
    await expectDenied(db.asServiceRole((tx) => tx.query("insert into public.agent_job_steps(organization_id,job_id,seq,kind) values($1,$2,9,'persist')", [org.organizationId, job.id])), /permission denied/)
    await expectDenied(db.asServiceRole((tx) => tx.query("update public.agent_jobs set status='succeeded' where id=$1", [job.id])), /permission denied/)
  })

  it("lets humans cancel and resume, never browsers write jobs directly", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "viewer" }] })
    const doc = await createDocument(org.members.owner, org.organizationId)
    const job = await enqueue(org.members.owner, org.organizationId, doc, "cancel-1")
    await expectDenied(db.asUser(org.members.viewer, (tx) => tx.query("select public.cancel_agent_job($1)", [job.id])))
    await expectDenied(db.asUser(org.members.owner, (tx) => tx.query("insert into public.agent_jobs(organization_id,kind,idempotency_key) values($1,'content_draft','direct')", [org.organizationId])))
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
    const target = (rev: number) => JSON.stringify({ target: { type: "content_document", id: doc, revision: rev } })
    // queueing a gated job without approval is refused for every writer: humans via the RPC, and even the table owner
    await expectDenied(
      db.asUser(org.members.owner, (tx) => tx.query("select public.enqueue_agent_job($1,'publish_external','no-ap','{}'::jsonb,'content_document',$2,1)", [org.organizationId, doc])),
      /Mandate/
    )
    await expectDenied(db.asPostgres((tx) => tx.query("insert into public.agent_jobs(organization_id,kind,idempotency_key,payload) values($1,'publish_external','no-ap',$2::jsonb)", [org.organizationId, target(1)])), /Mandate/)
    // an approval for another target does not help
    const otherDoc = await createDocument(org.members.owner, org.organizationId)
    await expectDenied(
      db.asUser(org.members.owner, (tx) => tx.query("select public.enqueue_agent_job($1,'publish_external','wrong-ap','{}'::jsonb,'content_document',$2,1,null,null,$3)", [org.organizationId, otherDoc, approvalId])),
      /Mandate/
    )
    await db.asUser(org.members.owner, (tx) =>
      tx.query("select public.enqueue_agent_job($1,'publish_external','with-ap','{}'::jsonb,'content_document',$2,1,null,null,$3)", [org.organizationId, doc, approvalId])
    )
    const queued = await db.asPostgres((tx) => tx.query<{ payload: Record<string, unknown> }>("select payload from public.agent_jobs where idempotency_key='with-ap' and organization_id=$1", [org.organizationId]))
    expect(queued.rows[0].payload).toMatchObject({ approval_request_id: approvalId, target: { type: "content_document", id: doc, revision: 1 }, limits: { max_rounds: 3, max_hops: 8, budget_cents: 100 } })
    await db.asUser(org.members.owner, (tx) => tx.query("update public.content_documents set body='v2' where id=$1", [doc]))
    const ap = await db.asPostgres((tx) => tx.query<{ status: string }>("select status from public.approval_requests where id=$1", [approvalId]))
    expect(ap.rows[0].status).toBe("expired")
    const claimed = await db.asServiceRole((tx) => tx.query("select * from public.claim_agent_job(array['publish_external'], 60)"))
    expect(claimed.rows.filter((r) => (r as { organization_id: string }).organization_id === org.organizationId)).toHaveLength(0)
    const job = await db.asPostgres((tx) => tx.query<{ status: string; error_code: string }>("select status, error_code from public.agent_jobs where idempotency_key='with-ap' and organization_id=$1", [org.organizationId]))
    expect(job.rows[0]).toMatchObject({ status: "blocked_needs_human", error_code: "mandate_invalid" })
    // and an expired approval cannot be re-approved
    await expectDenied(db.asUser(org.members.owner, (tx) => tx.query("select public.decide_approval_request($1,'approved','again')", [approvalId])), /已处理/)
  })
})
