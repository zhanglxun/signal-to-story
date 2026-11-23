// @vitest-environment node
// Rehearse the generated step-3 release (DB2c-2) on a database shaped like live after step 2, with an old-style
// service_role worker holding a job mid-run. The release is additive: that job finishes on the old RPCs, and the
// next one is claimed by a node token. Afterwards the structure must equal a fresh build of the repo head.
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { enqueueDemoJob, seedDemoWorkspace } from "../../workers/agent/demo/demo-scenario"
import { createSupabaseTestDb, listMigrationFiles, REPO_ROOT } from "./pglite-harness"
import { buildRelease, pendingMigrations, RELEASES } from "./release"
import { diffSnapshots, snapshotQuery, type SchemaSnapshot } from "./schema-snapshot"

const STEP3 = { ...RELEASES.step3, label: "test" }
const STEP2_LAST = listMigrationFiles().filter((f) => f.slice(0, 14) <= RELEASES.step3.after).at(-1)!
const STEP3_LAST = listMigrationFiles().filter((f) => f.slice(0, 14) <= RELEASES.step3.upTo).at(-1)!

async function afterStep2() {
  const db = await createSupabaseTestDb({ upTo: STEP2_LAST })
  await db.asPostgres(async (tx) => {
    await tx.query("create schema if not exists supabase_migrations")
    await tx.query("create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)")
    await tx.query("insert into supabase_migrations.schema_migrations (version, name) select left(f, 14), substr(f, 16) from unnest($1::text[]) f",
      [db.appliedMigrations.map((f) => f.replace(/\.sql$/, ""))])
  })
  return db
}

describe("0.5 release step 3 (DB2c-2)", () => {
  it("applies while an old worker holds a job, lets it finish, then a node token takes the next job; matches the repo head", async () => {
    const db = await afterStep2()
    const ws = await seedDemoWorkspace(db)
    const running = await enqueueDemoJob(db, ws, "old-worker-job")
    await db.asServiceRole((tx) => tx.query("select * from public.claim_agent_job(array['content_draft'], 600)"))

    await db.db.exec(buildRelease(STEP3))

    const q = <T>(sql: string, params: unknown[] = []) => db.asPostgres(async (tx) => (await tx.query<T>(sql, params)).rows)
    expect((await q<{ version: string }>("select version from supabase_migrations.schema_migrations order by version")).map((h) => h.version))
      .toEqual(listMigrationFiles().filter((f) => f <= STEP3_LAST).map((f) => f.slice(0, 14)))

    // The old worker finishes its job on the unchanged service_role RPC.
    await db.asServiceRole((tx) => tx.query("select public.complete_agent_job($1, 1, 'failed', '{}'::jsonb, 'x', 'test')", [running.id]))
    expect(await q("select status from public.agent_jobs where id=$1", [running.id])).toEqual([{ status: "failed" }])

    // A node created in the console claims the next job with the publishable key.
    const node = await db.asUser(ws.ownerId, async (tx) => (await tx.query<{ r: { id: string; token: string } }>("select public.create_runner_node($1,'mac') as r", [ws.organizationId])).rows[0].r)
    const next = await enqueueDemoJob(db, ws, "node-job", "另一条要求")
    const claimed = await db.asAnon(async (tx) => (await tx.query<{ r: { id: string; node_id: string } }>("select public.node_claim($1, array['content_draft'], 120) as r", [node.token])).rows[0].r)
    expect(claimed).toMatchObject({ id: next.id, node_id: node.id })

    const after = (await db.asPostgres((tx) => tx.query<{ snapshot: SchemaSnapshot }>(snapshotQuery()))).rows[0].snapshot
    const fresh = await createSupabaseTestDb({ upTo: STEP3_LAST })
    const head = (await fresh.asPostgres((tx) => tx.query<{ snapshot: SchemaSnapshot }>(snapshotQuery()))).rows[0].snapshot
    await fresh.close()
    const diff = diffSnapshots(after, head)
    for (const [category, d] of Object.entries(diff)) expect({ category, ...d }).toEqual({ category, onlyRemote: [], onlyRepo: [], changed: [] })
    await db.close()
  })

  it("refuses to run twice or on an unexpected history", async () => {
    const db = await afterStep2()
    await db.db.exec(buildRelease(STEP3))
    await expect(db.db.exec(buildRelease(STEP3))).rejects.toThrow(/expected last applied migration/)
    await db.db.exec("rollback")
    await db.close()

    const early = await createSupabaseTestDb({ upTo: listMigrationFiles().filter((f) => f.slice(0, 14) <= RELEASES.step2.after).at(-1)! })
    await early.asPostgres(async (tx) => {
      await tx.query("create schema if not exists supabase_migrations")
      await tx.query("create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)")
      await tx.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, 'x')", [RELEASES.step2.after])
    })
    await expect(early.db.exec(buildRelease(STEP3))).rejects.toThrow(/expected last applied migration 20261123100000/)
    await early.db.exec("rollback")
    expect((await early.asPostgres((tx) => tx.query("select to_regclass('public.runner_nodes') r"))).rows[0]).toEqual({ r: null })
    await early.close()
  })

  it("contains only the step-3 migration and no secrets", () => {
    const sql = buildRelease(STEP3)
    expect(pendingMigrations(RELEASES.step3.after, RELEASES.step3.upTo)).toEqual(["20261124100000_runner_nodes.sql"])
    expect(sql).not.toMatch(/drop table if exists public\.site_|backfill_v1/)
    expect(sql).not.toMatch(/service_role_key|sb_secret|password\s*=|supabase\.co|stn_[a-f0-9]{64}/i)
    expect(sql).toBe(readFileSync(path.join(REPO_ROOT, "supabase/release", RELEASES.step3.file), "utf8").replace(RELEASES.step3.label, "test"))
  })
})
