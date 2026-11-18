// @vitest-environment node
// DB2c-1 (docs/database.md §4.4, §6): agent_jobs / agent_job_steps MVP shape — one running job per card,
// board status sync, payload.target / payload.limits checks, Mandate still in the database, and the
// migration carrying rows written in the old shape.
import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createSupabaseTestDb, listMigrationFiles, MIGRATIONS_DIR, seedOrganization, type SeededOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"

const MVP_MIGRATION = "20261123100000_agent_jobs_mvp.sql"
let db: SupabaseTestDb
afterEach(async () => {
  await db?.close()
})

async function expectDenied(promise: Promise<unknown>, pattern?: RegExp) {
  const error = await promise.then(() => null, (e: unknown) => e as Error)
  expect(error, "expected the database to refuse").not.toBeNull()
  if (pattern) expect(error?.message).toMatch(pattern)
}

async function setup() {
  db = await createSupabaseTestDb()
  const org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "member" }] })
  return { org, ...(await card(org)) }
}

/** A board card with a master and an x document. */
async function card(org: SeededOrganization) {
  return db.asUser(org.members.owner, async (tx) => {
    const item = (await tx.query<{ id: string }>("insert into public.work_items(organization_id,title) values($1,'卡') returning id", [org.organizationId])).rows[0].id
    const docs: string[] = []
    for (const platform of ["master", "x"]) {
      docs.push((await tx.query<{ id: string }>("insert into public.content_documents(organization_id,work_item_id,platform,title,body) values($1,$2,$3,'T','B') returning id", [org.organizationId, item, platform])).rows[0].id)
    }
    return { item, docs }
  })
}

const enqueue = (org: SeededOrganization, key: string, doc: string | null, kind = "content_draft", workItem: string | null = null) =>
  db.asUser(org.members.owner, async (tx) =>
    (await tx.query<{ id: string; work_item_id: string | null; status: string; payload: Record<string, unknown> }>(
      "select * from public.enqueue_agent_job($1,$2,$3,'{\"instruction\":\"x\"}'::jsonb,$4,$5,$6,null,null,null,$7)",
      [org.organizationId, kind, key, doc ? "content_document" : null, doc, doc ? 1 : null, workItem]
    )).rows[0]
  )
const claim = (kinds: string[] = ["content_draft"]) =>
  db.asServiceRole(async (tx) => (await tx.query<{ id: string; lease_epoch: number }>("select id, lease_epoch from public.claim_agent_job($1, 60)", [kinds])).rows[0] ?? null)
const complete = (id: string, epoch: number, status: string) =>
  db.asServiceRole((tx) => tx.query("select public.complete_agent_job($1,$2,$3)", [id, epoch, status]))
const itemStatus = async (id: string) => (await db.asPostgres((tx) => tx.query<{ status: string }>("select status from public.work_items where id=$1", [id]))).rows[0].status

describe("one running job per board card (§6.2, B6)", () => {
  it("allows several queued jobs, runs them one at a time, refuses a second running one, lets chat through", async () => {
    const { org, item, docs } = await setup()
    const a = await enqueue(org, "a", docs[0])
    const b = await enqueue(org, "b", docs[1])
    expect([a.work_item_id, b.work_item_id]).toEqual([item, item]) // derived from the documents
    const first = await claim()
    expect(first.id).toBe(a.id)
    expect(await claim()).toBeNull() // b is skipped while a runs on the same card
    await expectDenied(db.asPostgres((tx) => tx.query("update public.agent_jobs set status='running' where id=$1", [b.id])), /agent_jobs_one_running_per_item|duplicate/)
    // a chat turn on the same card is not serialized
    const chat = await enqueue(org, "chat-1", null, "chat_turn", item)
    expect((await claim(["chat_turn"]))?.id).toBe(chat.id)
    await complete(first.id, first.lease_epoch, "pending_review")
    expect((await claim())?.id).toBe(b.id)
  })

  it("rejects a work item that does not match the document's card or belongs to another organization", async () => {
    const { org, docs } = await setup()
    const other = await card(org)
    await expectDenied(enqueue(org, "mismatch", docs[0], "content_draft", other.item), /不一致/)
    const foreign = await seedOrganization(db, { members: [{ role: "owner" }] })
    const foreignCard = await card(foreign)
    await expectDenied(enqueue(org, "foreign", null, "chat_turn", foreignCard.item), /事项不存在/)
  })
})

describe("job state drives the board column", () => {
  it("queued/running → doing, pending_review → review, blocked/failed → waiting, succeeded/cancelled keep it", async () => {
    const { org, item, docs } = await setup()
    expect(await itemStatus(item)).toBe("todo")
    const a = await enqueue(org, "s1", docs[0])
    expect(await itemStatus(item)).toBe("doing")
    const ca = await claim()
    await complete(a.id, ca.lease_epoch, "pending_review")
    expect(await itemStatus(item)).toBe("review")
    const b = await enqueue(org, "s2", docs[1])
    expect(await itemStatus(item)).toBe("doing")
    const cb = await claim()
    await complete(b.id, cb.lease_epoch, "blocked_needs_human")
    expect(await itemStatus(item)).toBe("waiting")
    await db.asUser(org.members.owner, (tx) => tx.query("select public.cancel_agent_job($1)", [b.id]))
    expect(await itemStatus(item)).toBe("waiting") // cancelled leaves the card where it was
    const c = await enqueue(org, "s3", docs[1])
    const cc = await claim()
    await db.asServiceRole((tx) => tx.query("select public.fail_agent_job($1,$2,'boom',false)", [c.id, cc.lease_epoch]))
    expect(await itemStatus(item)).toBe("waiting")
    // a chat turn never moves the card
    await db.asUser(org.members.owner, (tx) => tx.query("update public.work_items set status='review' where id=$1", [item]))
    await enqueue(org, "chat-s", null, "chat_turn", item)
    expect(await itemStatus(item)).toBe("review")
  })

  it("never moves a card the human closed (done / dropped)", async () => {
    const { org, item, docs } = await setup()
    for (const closed of ["done", "dropped"]) {
      await db.asUser(org.members.owner, (tx) => tx.query("update public.work_items set status=$2 where id=$1", [item, closed]))
      const j = await enqueue(org, `closed-${closed}`, docs[0])
      expect(await itemStatus(item)).toBe(closed)
      const c = await claim()
      await complete(j.id, c.lease_epoch, "pending_review")
      expect(await itemStatus(item)).toBe(closed)
    }
  })
})

describe("payload.target / payload.limits / payload.approval_request_id", () => {
  const insert = (org: SeededOrganization, key: string, payload: unknown) =>
    db.asPostgres((tx) => tx.query("insert into public.agent_jobs(organization_id,kind,idempotency_key,payload) values($1,'content_draft',$2,$3)", [org.organizationId, key, payload]))

  it("fills default limits and validates the shapes, for every writer", async () => {
    const { org, docs } = await setup()
    await insert(org, "ok", { target: { type: "content_document", id: docs[0], revision: 1 } })
    const row = await db.asPostgres((tx) => tx.query<{ payload: Record<string, unknown> }>("select payload from public.agent_jobs where idempotency_key='ok'"))
    expect(row.rows[0].payload.limits).toEqual({ max_rounds: 3, max_hops: 8, budget_cents: 100 })
    const bad: Array<[string, unknown]> = [
      ["type", { target: { type: "Bad Type", id: "x" } }],
      ["id", { target: { type: "content_document", id: "x".repeat(129) } }],
      ["empty-id", { target: { type: "content_document", id: "" } }],
      ["rev0", { target: { type: "content_document", id: "x", revision: 0 } }],
      ["rev-text", { target: { type: "content_document", id: "x", revision: "1" } }],
      ["rounds", { limits: { max_rounds: 6 } }],
      ["hops", { limits: { max_hops: 1 } }],
      ["budget", { limits: { budget_cents: -1 } }],
      ["budget-high", { limits: { budget_cents: 1000001 } }],
      ["tokens", { limits: { token_budget: 0 } }],
      ["limits-type", { limits: "lots" }],
      ["approval", { approval_request_id: "not-a-uuid" }],
    ]
    for (const [key, payload] of bad) await expectDenied(insert(org, key, payload), /check constraint|violates/)
    await expectDenied(db.asUser(org.members.owner, (tx) => tx.query("select public.enqueue_agent_job($1,'content_draft','r9','{}'::jsonb,'content_document',$2,1,null,9)", [org.organizationId, docs[0]])), /limits/)
  })

  it("keeps input and target immutable; only resume raises the limits", async () => {
    const { org, docs } = await setup()
    const j = await enqueue(org, "imm", docs[0])
    await expectDenied(db.asPostgres((tx) => tx.query("update public.agent_jobs set payload = jsonb_set(payload,'{target,id}','\"other\"') where id=$1", [j.id])), /不可修改/)
    await expectDenied(db.asPostgres((tx) => tx.query("update public.agent_jobs set work_item_id = null where id=$1", [j.id])), /不可修改/)
    await expectDenied(db.asUser(org.members.owner, (tx) => tx.query("update public.agent_jobs set payload = '{}' where id=$1", [j.id])))
    const c = await claim()
    await complete(j.id, c.lease_epoch, "blocked_needs_human")
    const resumed = await db.asUser(org.members.owner, (tx) => tx.query<{ l: Record<string, number> }>("select (public.resume_agent_job($1,2,500)).payload->'limits' l", [j.id]))
    expect(resumed.rows[0].l).toEqual({ max_rounds: 5, max_hops: 12, budget_cents: 600 })
  })
})

describe("Mandate stays in the database", () => {
  it("refuses a publish job whose approval is for an older revision of the target", async () => {
    const { org, docs } = await setup()
    const approval = await db.asUser(org.members.owner, async (tx) =>
      (await tx.query<{ id: string }>("select (a).id from (select public.create_approval_request($1,'publish_site','content_document',$2,1,'v1') a) s", [org.organizationId, docs[0]])).rows[0].id
    )
    await db.asUser(org.members.owner, (tx) => tx.query("select public.decide_approval_request($1,'approved','ok')", [approval]))
    await db.asUser(org.members.owner, (tx) => tx.query("update public.content_documents set body='v2' where id=$1", [docs[0]]))
    await expectDenied(
      db.asUser(org.members.owner, (tx) => tx.query("select public.enqueue_agent_job($1,'publish_site','pub','{}'::jsonb,'content_document',$2,2,null,null,$3)", [org.organizationId, docs[0], approval])),
      /Mandate/
    )
    // a node can neither decide approvals nor answer questions
    await expectDenied(db.asServiceRole((tx) => tx.query("select public.decide_approval_request($1,'approved','')", [approval])), /permission denied/)
    await expectDenied(db.asServiceRole((tx) => tx.query(`select public.answer_question($1,'{"text":"A"}'::jsonb)`, [approval])), /permission denied/)
  })
})

describe("migration 20261123100000 carries rows written in the old shape", () => {
  it("moves target / approval / limits into payload, steps into seq + output + usage, keeps foreign keys", async () => {
    db = await createSupabaseTestDb({ upTo: listMigrationFiles().find((f) => f < MVP_MIGRATION && f.startsWith("20261122"))! })
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    const { item, docs } = await card(org)
    const owner = org.members.owner
    const draft = await db.asUser(owner, async (tx) =>
      (await tx.query<{ id: string }>("select (j).id from (select public.enqueue_agent_job($1,'content_draft','old-1','{\"instruction\":\"x\"}'::jsonb,'content_document',$2,1,50,4,null) j) s", [org.organizationId, docs[0]])).rows[0].id
    )
    const approval = await db.asUser(owner, async (tx) =>
      (await tx.query<{ id: string }>("select (a).id from (select public.create_approval_request($1,'publish_external','content_document',$2,1,'v1') a) s", [org.organizationId, docs[1]])).rows[0].id
    )
    await db.asUser(owner, (tx) => tx.query("select public.decide_approval_request($1,'approved','ok')", [approval]))
    await db.asServiceRole(async (tx) => {
      await tx.query("select * from public.claim_agent_job('old-worker', array['content_draft'], 60)")
      const step = `insert into public.agent_job_steps(organization_id,job_id,round,step_kind,status,driver,model,input_digest,input_summary,output,evaluation,usage,cost_cents,duration_ms)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`
      const s = (round: number, kind: string, extra: unknown[]) => tx.query(step, [org.organizationId, draft, round, kind, ...extra])
      await s(0, "context", ["succeeded", null, null, "abc", { sources: 1 }, { warnings: [] }, null, null, 0, 0])
      await s(1, "generate", ["succeeded", "cloud", "m1", "def", null, { draft: "稿" }, null, { inputTokens: 10, outputTokens: 5, costCents: 1.5 }, 1.5, 120])
      await s(1, "precheck", ["failed", null, null, null, null, null, { passedAll: false }, null, 0, 0])
      await s(1, "evaluate", ["failed", "cloud", "m2", null, null, { raw: "{}" }, { passedAll: false, score: 60 }, { inputTokens: 3, outputTokens: 1, costCents: 0.5 }, 0.5, 40])
      await tx.query("update public.agent_jobs set rounds=1, hops_used=2, cost_cents=2, tokens_used=19, driver='cloud', model='m1' where id=$1", [draft])
      await tx.query("select public.complete_agent_job($1,'old-worker','pending_review','{\"proposal_id\":null}'::jsonb)", [draft])
      await tx.query("insert into public.agent_jobs(organization_id,job_type,idempotency_key,target_type,target_id,target_revision,approval_request_id) values($1,'publish_external','old-pub','content_document',$2,1,$3)", [org.organizationId, docs[1], approval])
    })
    await db.asServiceRole((tx) => tx.query("select public.create_approval_request($1,'publish_site','content_document',$2,1,'by job','{}'::jsonb,null,$3)", [org.organizationId, docs[0], draft]))

    await db.db.exec(readFileSync(path.join(MIGRATIONS_DIR, MVP_MIGRATION), "utf8"))

    const jobs = await db.asPostgres(async (tx) => (await tx.query<Record<string, unknown>>("select * from public.agent_jobs order by created_at")).rows)
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatchObject({
      kind: "content_draft", status: "pending_review", work_item_id: item,
      payload: { instruction: "x", target: { type: "content_document", id: docs[0], revision: 1 }, limits: { max_rounds: 4, max_hops: 8, budget_cents: 50 } },
      result: { proposal_id: null, legacy_columns: { rounds: 1, hops_used: 2, tokens_used: 19, driver: "cloud", model: "m1" } },
    })
    expect(jobs[0].notified_at).not.toBeNull() // already decided before the notifier existed: no retroactive notice
    expect(jobs[1]).toMatchObject({ kind: "publish_external", status: "queued", work_item_id: item, notified_at: null,
      payload: { approval_request_id: approval, target: { type: "content_document", id: docs[1], revision: 1 } } })
    for (const col of ["job_type", "target_type", "rounds", "cost_cents", "approval_request_id", "locked_by", "started_at"]) expect(jobs[0]).not.toHaveProperty(col)

    const steps = await db.asPostgres(async (tx) => (await tx.query<Record<string, unknown>>("select * from public.agent_job_steps order by seq")).rows)
    expect(steps.map((s) => [s.seq, s.kind, (s.output as { stage?: string }).stage ?? null])).toEqual([[1, "context", null], [2, "generate", null], [3, "check", "precheck"], [4, "check", "evaluate"]])
    expect(steps[0].output).toEqual({ warnings: [], round: 0, input_digest: "abc", input_summary: { sources: 1 } })
    expect(steps[1]).toMatchObject({ output: { draft: "稿", round: 1, input_digest: "def" }, usage: { input_tokens: 10, output_tokens: 5, cost_cents: 1.5, model: "m1", driver: "cloud", duration_ms: 120 } })
    expect(steps[3]).toMatchObject({ status: "failed", output: { raw: "{}", round: 1, stage: "evaluate", evaluation: { score: 60 } }, usage: { cost_cents: 0.5, model: "m2" } })
    expect(Object.keys(steps[0]).sort()).toEqual(["created_at", "error", "id", "job_id", "kind", "organization_id", "output", "seq", "status", "usage"])

    // reverse links still resolve, approvals carry notified_at, and the carried rows keep working with the new RPCs
    const ap = await db.asPostgres(async (tx) => (await tx.query<{ requested_by_job: string; notified_at: string | null }>("select requested_by_job, notified_at from public.approval_requests where requested_by_job is not null")).rows[0])
    expect(ap.requested_by_job).toBe(jobs[0].id)
    expect(ap.notified_at).not.toBeNull()
    const claimed = await db.asServiceRole(async (tx) => (await tx.query<{ id: string; lease_epoch: number }>("select id, lease_epoch from public.claim_agent_job(array['publish_external'], 60)")).rows)
    expect(claimed).toEqual([{ id: jobs[1].id, lease_epoch: 1 }])
  })
})
