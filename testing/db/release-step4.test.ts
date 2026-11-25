// @vitest-environment node
// Rehearse the generated step-4 release (DB2c-3) on a database shaped like live after step 3,
// including an existing content_ai_proposals row. Afterwards the structure must match the repo head.
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { enqueueDemoJob, seedDemoWorkspace } from "../../workers/agent/demo/demo-scenario"
import { createSupabaseTestDb, listMigrationFiles, REPO_ROOT } from "./pglite-harness"
import { buildRelease, pendingMigrations, RELEASES } from "./release"
import { diffSnapshots, snapshotQuery, type SchemaSnapshot } from "./schema-snapshot"

const STEP4 = { ...RELEASES.step4, label: "test" }
const STEP3_LAST = listMigrationFiles().filter((f) => f.slice(0, 14) <= RELEASES.step4.after).at(-1)!
const STEP4_LAST = listMigrationFiles().filter((f) => f.slice(0, 14) <= RELEASES.step4.upTo).at(-1)!

async function afterStep3() {
  const db = await createSupabaseTestDb({ upTo: STEP3_LAST })
  await db.asPostgres(async (tx) => {
    await tx.query("create schema if not exists supabase_migrations")
    await tx.query("create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)")
    await tx.query(
      "insert into supabase_migrations.schema_migrations (version, name) select left(f, 14), substr(f, 16) from unnest($1::text[]) f",
      [db.appliedMigrations.map((f) => f.replace(/\.sql$/, ""))]
    )
  })
  return db
}

describe("0.5 release step 4 (DB2c-3)", () => {
  it("retires content_ai_proposals, enables node_write_document_draft + approval completion, and matches the repo at step 4", async () => {
    const db = await afterStep3()
    const ws = await seedDemoWorkspace(db)
    const oldJob = await enqueueDemoJob(db, ws, "old-proposal-job")
    await db.asServiceRole(async (tx) => {
      await tx.query(
        `insert into public.content_ai_proposals(organization_id, document_id, input_revision, model, instruction, input_brief, status, body, created_by, agent_job_id)
         values ($1, $2, 1, 'm1', 'inst', '{}', 'succeeded', '旧提案', $3, $4)`,
        [ws.organizationId, ws.documentId, ws.ownerId, oldJob.id]
      )
    })
    await db.asUser(ws.ownerId, (tx) => tx.query("select public.cancel_agent_job($1)", [oldJob.id]))

    await db.db.exec(buildRelease(STEP4))

    const q = <T>(sql: string, params: unknown[] = []) => db.asPostgres(async (tx) => (await tx.query<T>(sql, params)).rows)
    expect((await q<{ version: string }>("select version from supabase_migrations.schema_migrations order by version")).map((h) => h.version))
      .toEqual(listMigrationFiles().filter((f) => f <= STEP4_LAST).map((f) => f.slice(0, 14)))

    expect(await q("select to_regclass('public.content_ai_proposals') as tbl, to_regprocedure('public.node_save_proposal(text,uuid,bigint,jsonb)') as fn"))
      .toEqual([{ tbl: null, fn: null }])
    expect(await q<{ n: number }>("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'node\\_%'"))
      .toEqual([{ n: 12 }])

    // Complete a full direct-draft -> review -> approve -> job succeeded flow after upgrade.
    const node = await db.asUser(ws.ownerId, async (tx) =>
      (await tx.query<{ r: { id: string; token: string } }>("select public.create_runner_node($1, 'mac') as r", [ws.organizationId])).rows[0].r
    )
    const next = await enqueueDemoJob(db, ws, "direct-draft-job")
    const claimed = await db.asAnon(async (tx) =>
      (await tx.query<{ r: { id: string; lease_epoch: number } }>("select public.node_claim($1, array['content_draft'], 120) as r", [node.token])).rows[0].r
    )
    expect(claimed.id).toBe(next.id)
    const written = await db.asAnon(async (tx) =>
      (await tx.query<{ r: { document_id: string; revision: number; already_written: boolean } }>(
        "select public.node_write_document_draft($1, $2, $3, $4, 1, '新标题', 'AI 直接写入的正文') as r",
        [node.token, claimed.id, claimed.lease_epoch, ws.documentId]
      )).rows[0].r
    )
    expect(written).toEqual({ document_id: ws.documentId, revision: 2, already_written: false })

    await db.asAnon((tx) =>
      tx.query("select public.node_complete($1, $2, $3, 'pending_review', $4::jsonb)", [
        node.token,
        claimed.id,
        claimed.lease_epoch,
        JSON.stringify({ written_revision: 2 }),
      ])
    )
    await db.asUser(ws.ownerId, async (tx) => {
      await tx.query("update public.content_documents set status = 'in_review' where id = $1", [ws.documentId])
      await tx.query("update public.content_documents set status = 'approved', review_note = 'OK' where id = $1", [ws.documentId])
    })
    expect(await q("select status, result->>'approved_revision' as approved_rev from public.agent_jobs where id = $1", [next.id]))
      .toEqual([{ status: "succeeded", approved_rev: "2" }])

    const after = (await db.asPostgres((tx) => tx.query<{ snapshot: SchemaSnapshot }>(snapshotQuery()))).rows[0].snapshot
    const fresh = await createSupabaseTestDb({ upTo: STEP4_LAST })
    const head = (await fresh.asPostgres((tx) => tx.query<{ snapshot: SchemaSnapshot }>(snapshotQuery()))).rows[0].snapshot
    await fresh.close()
    const diff = diffSnapshots(after, head)
    for (const [category, d] of Object.entries(diff)) expect({ category, ...d }).toEqual({ category, onlyRemote: [], onlyRepo: [], changed: [] })
    await db.close()
  })

  it("refuses to run twice, on an unexpected history, or while a content_draft job holds a live lease", async () => {
    const db = await afterStep3()
    await db.db.exec(buildRelease(STEP4))
    await expect(db.db.exec(buildRelease(STEP4))).rejects.toThrow(/expected last applied migration/)
    await db.db.exec("rollback")
    await db.close()

    const early = await createSupabaseTestDb({ upTo: listMigrationFiles().filter((f) => f.slice(0, 14) <= RELEASES.step3.after).at(-1)! })
    await early.asPostgres(async (tx) => {
      await tx.query("create schema if not exists supabase_migrations")
      await tx.query("create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)")
      await tx.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, 'x')", [RELEASES.step3.after])
    })
    await expect(early.db.exec(buildRelease(STEP4))).rejects.toThrow(/expected last applied migration 20261124100000/)
    await early.db.exec("rollback")
    expect((await early.asPostgres((tx) => tx.query<{ r: string | null }>("select to_regclass('public.content_ai_proposals') r"))).rows[0].r).not.toBeNull()
    await early.close()

    const busy = await afterStep3()
    const ws = await seedDemoWorkspace(busy)
    await enqueueDemoJob(busy, ws, "live-draft-job")
    const node = await busy.asUser(ws.ownerId, async (tx) =>
      (await tx.query<{ r: { id: string; token: string } }>("select public.create_runner_node($1, 'mac') as r", [ws.organizationId])).rows[0].r
    )
    await busy.asAnon((tx) => tx.query("select public.node_claim($1, array['content_draft'], 120)", [node.token]))
    await expect(busy.db.exec(buildRelease(STEP4))).rejects.toThrow(/live lease/)
    await busy.db.exec("rollback")
    expect((await busy.asPostgres((tx) => tx.query<{ r: string | null }>("select to_regclass('public.content_ai_proposals') r"))).rows[0].r).not.toBeNull()
    await busy.close()
  })

  it("contains only the step-4 migration and no secrets", () => {
    const sql = buildRelease(STEP4)
    expect(pendingMigrations(RELEASES.step4.after, RELEASES.step4.upTo)).toEqual(["20261125100000_ai_direct_draft.sql"])
    expect(sql).not.toMatch(/drop table if exists public\.site_|backfill_v1/)
    expect(sql).not.toMatch(/service_role_key|sb_secret|password\s*=|supabase\.co|stn_[a-f0-9]{64}/i)
    expect(sql).toBe(readFileSync(path.join(REPO_ROOT, "supabase/release", RELEASES.step4.file), "utf8").replace(RELEASES.step4.label, "test"))
  })
})
