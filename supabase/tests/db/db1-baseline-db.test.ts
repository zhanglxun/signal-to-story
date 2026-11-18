// @vitest-environment node
// DB1 baseline fixes (docs/database.md §9): agent questions share approval_requests (B5);
// video asset references are tenant-scoped by composite foreign keys (B1).
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createSupabaseTestDb, seedOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"

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

async function runningJob(key: string) {
  const org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "viewer" }] })
  const { owner } = org.members
  const job = await db.asUser(owner, async (tx) => {
    const p = await tx.query<{ id: string }>("insert into public.content_projects(organization_id,title) values($1,'P') returning id", [org.organizationId])
    const d = await tx.query<{ id: string }>(
      "insert into public.content_documents(organization_id,project_id,platform,title,body) values($1,$2,'x','T','B') returning id",
      [org.organizationId, p.rows[0].id]
    )
    const j = await tx.query<{ id: string }>(
      "select (j).id from (select public.enqueue_agent_job($1,'content_draft',$2,'{}'::jsonb,'content_document',$3,1) j) s",
      [org.organizationId, key, d.rows[0].id]
    )
    return j.rows[0].id
  })
  // The database is shared across tests: keep other queued jobs out of this claim.
  await db.asPostgres((tx) => tx.query("update public.agent_jobs set run_after = now() + interval '1 hour' where status = 'queued' and id <> $1", [job]))
  const claimed = await db.asServiceRole((tx) => tx.query<{ id: string }>("select id from public.claim_agent_job('w-q', array['content_draft'], 60)"))
  expect(claimed.rows[0].id).toBe(job)
  return { org, job }
}

const status = async (jobId: string) =>
  (await db.asPostgres((tx) => tx.query<{ status: string; error_code: string | null }>("select status, error_code from public.agent_jobs where id = $1", [jobId]))).rows[0]

describe("agent questions (approval_requests.kind = 'question')", () => {
  it("parks the job, only a human answers, and the answer re-queues the job", async () => {
    const { org, job } = await runningJob("q-1")
    const q = await db.asServiceRole((tx) =>
      tx.query<{ id: string; kind: string; status: string }>(
        `select (a).id, (a).kind, (a).status from (select public.ask_question($1, '{"title":"用哪个角度？","options":["A","B"],"recommended":"A"}'::jsonb) a) s`,
        [job]
      )
    )
    expect(q.rows[0]).toMatchObject({ kind: "question", status: "pending" })
    expect(await status(job)).toMatchObject({ status: "blocked_needs_human", error_code: "needs_answer" })

    const qid = q.rows[0].id
    // the node cannot answer its own question, a viewer cannot answer, approvals RPC refuses questions
    await expectDenied(db.asServiceRole((tx) => tx.query(`select public.answer_question($1, '{"text":"A"}'::jsonb)`, [qid])))
    await expectDenied(db.asUser(org.members.viewer, (tx) => tx.query(`select public.answer_question($1, '{"text":"A"}'::jsonb)`, [qid])), /权限/)
    await expectDenied(db.asUser(org.members.owner, (tx) => tx.query("select public.decide_approval_request($1, 'approved')", [qid])), /权限/)
    await expectDenied(db.asUser(org.members.owner, (tx) => tx.query(`select public.answer_question($1, '{"text":"  "}'::jsonb)`, [qid])), /不能为空/)

    const answered = await db.asUser(org.members.owner, (tx) =>
      tx.query<{ status: string; answer: { text: string } }>(`select (a).status, (a).answer from (select public.answer_question($1, '{"text":"A"}'::jsonb) a) s`, [qid])
    )
    expect(answered.rows[0]).toMatchObject({ status: "answered", answer: { text: "A" } })
    expect(await status(job)).toMatchObject({ status: "queued", error_code: null })
    await expectDenied(db.asUser(org.members.owner, (tx) => tx.query(`select public.answer_question($1, '{"text":"B"}'::jsonb)`, [qid])), /已处理/)
  })

  it("rejects malformed questions and asking from a job that is not running", async () => {
    const { job } = await runningJob("q-2")
    await expectDenied(db.asServiceRole((tx) => tx.query(`select public.ask_question($1, '{"options":["A"]}'::jsonb)`, [job])), /格式/)
    await db.asServiceRole((tx) => tx.query(`select public.ask_question($1, '{"title":"t"}'::jsonb)`, [job]))
    await expectDenied(db.asServiceRole((tx) => tx.query(`select public.ask_question($1, '{"title":"again"}'::jsonb)`, [job])), /运行中/)
  })

  it("enforces the kind shape at table level", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    await expectDenied(
      db.asPostgres((tx) =>
        tx.query("insert into public.approval_requests(organization_id, kind, action, target_type, target_id) values($1,'question','publish_site','x','1')", [org.organizationId])
      ),
      /approval_requests_kind_shape/
    )
    await expectDenied(
      db.asPostgres((tx) => tx.query("insert into public.approval_requests(organization_id, kind) values($1,'approval')", [org.organizationId])),
      /approval_requests_kind_shape/
    )
  })
})

describe("video asset references stay inside the organization", () => {
  it("refuses a shot or plan that points at another organization's asset, even as postgres", async () => {
    const a = await seedOrganization(db, { members: [{ role: "owner" }] })
    const b = await seedOrganization(db, { members: [{ role: "owner" }] })
    const ids = await db.asPostgres(async (tx) => {
      const asset = await tx.query<{ id: string }>(
        "insert into public.assets(organization_id,asset_type,category,name,media_type,created_by,updated_by) values($1,'video_studio','shot_clip','clip','video',$2,$2) returning id",
        [b.organizationId, b.members.owner]
      )
      const plan = await tx.query<{ id: string }>("insert into public.video_plans(organization_id,title,created_by) values($1,'P',$2) returning id", [
        a.organizationId,
        a.members.owner,
      ])
      return { asset: asset.rows[0].id, plan: plan.rows[0].id }
    })
    // Bypass the guard triggers: the composite foreign key alone must refuse the cross-tenant reference.
    await expectDenied(
      db.asPostgres(async (tx) => {
        // Disabling the guard triggers is rolled back together with the failing statement.
        await tx.query("alter table public.video_plans disable trigger user")
        await tx.query("update public.video_plans set composed_video_asset_id = $1 where id = $2", [ids.asset, ids.plan])
      }),
      /foreign key/
    )
  })
})
