// @vitest-environment node
// Rehearse the generated step-6 release (DB3b: chat runtime catalog) on a database shaped like live after step 5:
// the CLI history table, the platform's supabase_realtime publication, and a chat session written with the DB3
// RPC signatures. Afterwards the structure must equal the repo built to step 6.
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { createSupabaseTestDb, listMigrationFiles, REPO_ROOT, seedOrganization, type SupabaseTestDb } from "./pglite-harness"
import { buildRelease, pendingMigrations, RELEASES } from "./release"
import { diffSnapshots, snapshotQuery, type SchemaSnapshot } from "./schema-snapshot"

const STEP6 = { ...RELEASES.step6, label: "test" }
const STEP5_LAST = listMigrationFiles().filter((f) => f.slice(0, 14) <= RELEASES.step6.after).at(-1)!
const STEP6_LAST = listMigrationFiles().filter((f) => f.slice(0, 14) <= RELEASES.step6.upTo).at(-1)!

async function afterStep5(publication = true) {
  const db = await createSupabaseTestDb({ upTo: STEP5_LAST })
  await db.asPostgres(async (tx) => {
    await tx.query("create schema if not exists supabase_migrations")
    await tx.query("create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)")
    await tx.query(
      "insert into supabase_migrations.schema_migrations (version, name) select left(f, 14), substr(f, 16) from unnest($1::text[]) f",
      [db.appliedMigrations.map((f) => f.replace(/\.sql$/, ""))]
    )
    if (publication) await tx.query("create publication supabase_realtime")
  })
  return db
}

/** A conversation written through the DB3 (step 5) signatures: one user message, optionally a queued turn. */
async function seedChat(db: SupabaseTestDb, runAgent = false) {
  const org = await seedOrganization(db, { members: [{ role: "owner" }] })
  const owner = org.members.owner
  const session = await db.asUser(owner, async (tx) => {
    const s = (await tx.query<{ id: string }>("insert into public.chat_sessions(organization_id, title) values ($1, '旧会话') returning id", [org.organizationId])).rows[0].id
    await tx.query("select public.send_chat_message($1, '旧消息', $2)", [s, runAgent])
    return s
  })
  return { org, owner, session }
}

const snapshot = async (db: SupabaseTestDb) => (await db.asPostgres((tx) => tx.query<{ snapshot: SchemaSnapshot }>(snapshotQuery()))).rows[0].snapshot

describe("0.5 release step 6 (DB3b)", () => {
  it("keeps existing chat rows, publishes chat_messages to Realtime, enables the new RPCs, and matches the repo at step 6", async () => {
    const db = await afterStep5()
    const { org, owner, session } = await seedChat(db)

    await db.db.exec(buildRelease(STEP6))

    const q = <T>(sql: string, params: unknown[] = []) => db.asPostgres(async (tx) => (await tx.query<T>(sql, params)).rows)
    expect((await q<{ version: string }>("select version from supabase_migrations.schema_migrations order by version")).map((h) => h.version))
      .toEqual(listMigrationFiles().filter((f) => f <= STEP6_LAST).map((f) => f.slice(0, 14)))
    expect(await q("select content, parts, status, reply_to_message_id from public.chat_messages where session_id = $1", [session]))
      .toEqual([{ content: "旧消息", parts: [], status: "completed", reply_to_message_id: null }])
    expect(await q("select runtime_config from public.chat_sessions where id = $1", [session])).toEqual([{ runtime_config: {} }])
    expect(await q("select tablename from pg_publication_tables where pubname = 'supabase_realtime'")).toEqual([{ tablename: "chat_messages" }])
    // Exactly one signature per changed RPC (no PostgREST overload).
    expect(await q("select proname, pronargs from pg_proc where proname in ('send_chat_message','node_append_chat_message') order by 1"))
      .toEqual([{ proname: "node_append_chat_message", pronargs: 9 }, { proname: "send_chat_message", pronargs: 6 }])

    // A full HTTP-path turn on the released database.
    const node = await db.asUser(owner, async (tx) => (await tx.query<{ r: { id: string; token: string } }>("select public.create_runner_node($1,'A') as r", [org.organizationId])).rows[0].r)
    const turn = await db.asUser(owner, async (tx) =>
      (await tx.query<{ r: { agent_job_id: string } }>("select public.send_chat_message($1,'新消息',true,'[]'::jsonb,'{\"runtime_id\":\"api:qwen:qwen3.8-flash\"}'::jsonb,$2) as r", [session, node.id])).rows[0].r)
    const claimed = await db.asAnon(async (tx) => (await tx.query<{ r: { lease_epoch: number } | null }>("select public.node_claim_job($1,$2,120) as r", [node.token, turn.agent_job_id])).rows[0].r)
    expect(claimed).not.toBeNull()
    const done = await db.asAnon(async (tx) => (await tx.query<{ r: { job_status: string } }>(
      "select public.node_append_chat_message($1,$2,$3,'回复',null,'[{\"type\":\"text\",\"text\":\"回复\"}]'::jsonb) as r", [node.token, turn.agent_job_id, claimed!.lease_epoch])).rows[0].r)
    expect(done.job_status).toBe("succeeded")

    const fresh = await createSupabaseTestDb({ upTo: STEP6_LAST })
    const diff = diffSnapshots(await snapshot(db), await snapshot(fresh))
    await fresh.close()
    for (const [category, d] of Object.entries(diff)) expect({ category, ...d }).toEqual({ category, onlyRemote: [], onlyRepo: [], changed: [] })
    await db.close()
  })

  it("applies without a supabase_realtime publication (the guard skips it)", async () => {
    const db = await afterStep5(false)
    await db.db.exec(buildRelease(STEP6))
    expect((await db.asPostgres((tx) => tx.query("select to_regprocedure('public.node_claim_job(text,uuid,integer)') is not null as ok"))).rows).toEqual([{ ok: true }])
    await db.close()
  })

  it("refuses to run twice, on an unexpected history, or while a chat turn is in flight — leaving the database untouched", async () => {
    const db = await afterStep5()
    await db.db.exec(buildRelease(STEP6))
    await expect(db.db.exec(buildRelease(STEP6))).rejects.toThrow(/expected last applied migration/)
    await db.db.exec("rollback")
    await db.close()

    const drifted = await afterStep5()
    await drifted.asPostgres((tx) => tx.query("insert into supabase_migrations.schema_migrations(version, name) values ('20261126200000', 'unknown')"))
    await expect(drifted.db.exec(buildRelease(STEP6))).rejects.toThrow(/expected last applied migration 20261126100300/)
    await drifted.db.exec("rollback")
    await drifted.close()

    const busy = await afterStep5()
    await seedChat(busy, true)
    await expect(busy.db.exec(buildRelease(STEP6))).rejects.toThrow(/chat_turn job\(s\) are queued or running/)
    await busy.db.exec("rollback")
    expect((await busy.asPostgres((tx) => tx.query("select to_regprocedure('public.node_claim_job(text,uuid,integer)') as r"))).rows).toEqual([{ r: null }])
    await busy.close()
  })

  it("contains only the DB3b migration, no secrets, and is the committed script; earlier batches are untouched", () => {
    const sql = buildRelease(STEP6)
    expect(pendingMigrations(RELEASES.step6.after, RELEASES.step6.upTo)).toEqual(["20261127100000_chat_runtime_catalog.sql"])
    expect(sql).not.toMatch(/service_role_key|sb_secret|password\s*=|supabase\.co|stn_[a-f0-9]{64}/i)
    expect(sql).toBe(readFileSync(path.join(REPO_ROOT, "supabase/release", RELEASES.step6.file), "utf8").replace(RELEASES.step6.label, "test"))
    for (const spec of [RELEASES.step1, RELEASES.step2, RELEASES.step3, RELEASES.step4, RELEASES.step5]) {
      expect(buildRelease(spec)).toBe(readFileSync(path.join(REPO_ROOT, "supabase/release", spec.file), "utf8"))
    }
  })
})
