// @vitest-environment node
// Rehearse the generated step-2 release (DB2c-1) on a database shaped like live after step 1: repo migrations up to
// 20261122100000, the CLI history table, and a few agent jobs / steps written in the old shape (the human tested
// auto_draft live). After the script the structure must equal a fresh build of the repo head and the rows must
// be carried over.
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { createSupabaseTestDb, listMigrationFiles, REPO_ROOT, seedOrganization } from "./pglite-harness"
import { buildRelease, pendingMigrations, RELEASES } from "./release"
import { diffSnapshots, snapshotQuery, type SchemaSnapshot } from "./schema-snapshot"

const STEP2 = { ...RELEASES.step2, label: "test" }
const STEP1_LAST = listMigrationFiles().filter((f) => f.slice(0, 14) <= RELEASES.step2.after).at(-1)!

async function afterStep1() {
  const db = await createSupabaseTestDb({ upTo: STEP1_LAST })
  await db.asPostgres(async (tx) => {
    await tx.query("create schema if not exists supabase_migrations")
    await tx.query("create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)")
    await tx.query("insert into supabase_migrations.schema_migrations (version, name) select left(f, 14), substr(f, 16) from unnest($1::text[]) f",
      [db.appliedMigrations.map((f) => f.replace(/\.sql$/, ""))])
  })
  return db
}

/** What the live test left behind: an auto_draft capture whose jobs ran (one reached review, one is still queued). */
async function seedOldShapeJobs(db: Awaited<ReturnType<typeof afterStep1>>) {
  const org = await seedOrganization(db, { members: [{ role: "owner" }] })
  const capture = await db.asUser(org.members.owner, async (tx) =>
    (await tx.query<{ r: { work_item_id: string; documents: Array<{ job_id: string; document_id: string }> } }>(
      "select public.quick_capture($1,'https://example.com/a','线上试跑','auto_draft',array['x'],'live-test-0001') as r", [org.organizationId])).rows[0].r
  )
  await db.asServiceRole(async (tx) => {
    const claimed = (await tx.query<{ id: string }>("select id from public.claim_agent_job('live-worker', array['content_draft'], 60)")).rows[0].id
    const ins = "insert into public.agent_job_steps(organization_id,job_id,round,step_kind,status,model,driver,output,evaluation,usage,cost_cents,duration_ms) values($1,$2,$3,$4,'succeeded',$5,$6,$7,$8,$9,$10,$11)"
    await tx.query(ins, [org.organizationId, claimed, 0, "fetch", null, null, { title: "A" }, null, null, 0, 5])
    await tx.query(ins, [org.organizationId, claimed, 1, "generate", "m", "cloud", { draft: "稿" }, null, { inputTokens: 7, outputTokens: 3, costCents: 0.2 }, 0.2, 50])
    await tx.query(ins, [org.organizationId, claimed, 1, "evaluate", "m", "cloud", { raw: "{}" }, { passedAll: true }, { inputTokens: 2, outputTokens: 1, costCents: 0.1 }, 0.1, 20])
    await tx.query("update public.agent_jobs set rounds=1, hops_used=2, cost_cents=0.3, tokens_used=13, model='m', driver='cloud' where id=$1", [claimed])
    await tx.query("select public.complete_agent_job($1,'live-worker','pending_review','{}'::jsonb)", [claimed])
  })
  return { org, capture }
}

describe("0.5 release step 2 (DB2c-1)", () => {
  it("applies on a database at step 1 with old-shape jobs, carries the rows, and matches the repo head exactly", async () => {
    const db = await afterStep1()
    const { capture } = await seedOldShapeJobs(db)

    await db.db.exec(buildRelease(STEP2))

    const q = <T>(sql: string, params: unknown[] = []) => db.asPostgres(async (tx) => (await tx.query<T>(sql, params)).rows)
    const history = await q<{ version: string }>("select version from supabase_migrations.schema_migrations order by version")
    expect(history.map((h) => h.version)).toEqual(listMigrationFiles().map((f) => f.slice(0, 14)))
    const jobs = await q<{ kind: string; status: string; work_item_id: string; payload: Record<string, unknown>; notified_at: string | null }>(
      "select kind, status, work_item_id, payload, notified_at from public.agent_jobs order by status")
    expect(jobs.map((j) => [j.kind, j.status, j.work_item_id])).toEqual([
      ["content_draft", "pending_review", capture.work_item_id],
      ["content_draft", "queued", capture.work_item_id],
    ])
    expect(jobs.every((j) => (j.payload.target as { type: string }).type === "content_document" && (j.payload.limits as { max_rounds: number }).max_rounds === 3)).toBe(true)
    expect(jobs[0].notified_at).not.toBeNull()
    expect(jobs[1].notified_at).toBeNull()
    const steps = await q<{ seq: number; kind: string; usage: Record<string, unknown> }>("select seq, kind, usage from public.agent_job_steps order by seq")
    expect(steps.map((s) => [s.seq, s.kind])).toEqual([[1, "fetch"], [2, "generate"], [3, "check"]])
    expect(steps[1].usage).toMatchObject({ input_tokens: 7, output_tokens: 3, cost_cents: 0.2, model: "m", driver: "cloud" })

    // the queued job is picked up by the new RPCs
    const claimed = await db.asServiceRole(async (tx) => (await tx.query<{ lease_epoch: number }>("select lease_epoch from public.claim_agent_job(array['content_draft'], 60)")).rows)
    expect(claimed).toEqual([{ lease_epoch: 1 }])

    const after = (await db.asPostgres((tx) => tx.query<{ snapshot: SchemaSnapshot }>(snapshotQuery()))).rows[0].snapshot
    const fresh = await createSupabaseTestDb()
    const head = (await fresh.asPostgres((tx) => tx.query<{ snapshot: SchemaSnapshot }>(snapshotQuery()))).rows[0].snapshot
    await fresh.close()
    const diff = diffSnapshots(after, head)
    for (const [category, d] of Object.entries(diff)) expect({ category, ...d }).toEqual({ category, onlyRemote: [], onlyRepo: [], changed: [] })
    await db.close()
  })

  it("refuses to run twice, on an unexpected history, or while a worker holds a live lease", async () => {
    const db = await afterStep1()
    await db.db.exec(buildRelease(STEP2))
    await expect(db.db.exec(buildRelease(STEP2))).rejects.toThrow(/expected last applied migration/)
    await db.db.exec("rollback")
    await db.close()

    const busy = await afterStep1()
    await seedOldShapeJobs(busy)
    await busy.asServiceRole((tx) => tx.query("select * from public.claim_agent_job('live-worker', array['content_draft'], 60)"))
    await expect(busy.db.exec(buildRelease(STEP2))).rejects.toThrow(/live lease/)
    await busy.db.exec("rollback")
    const cols = await busy.asPostgres((tx) => tx.query("select 1 from information_schema.columns where table_name='agent_jobs' and column_name='lease_epoch'"))
    expect(cols.rows).toEqual([]) // untouched
    await busy.close()
  })

  it("contains only the step-2 migration, no legacy retirement, no backfill and no secrets", () => {
    const sql = buildRelease(STEP2)
    expect(pendingMigrations(RELEASES.step2.after)).toEqual(["20261123100000_agent_jobs_mvp.sql"])
    expect(sql).toContain("-- >>> 20261123100000_agent_jobs_mvp.sql")
    expect(sql).not.toMatch(/drop table if exists public\.site_|backfill_v1/)
    expect(sql).not.toMatch(/service_role_key|sb_secret|password\s*=|supabase\.co/i)
    expect(sql).toBe(readFileSync(path.join(REPO_ROOT, "supabase/release", RELEASES.step2.file), "utf8").replace(RELEASES.step2.label, "test"))
  })
})
