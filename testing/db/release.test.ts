// @vitest-environment node
// Rehearse the generated release on a database shaped like the live one (DB0): repo migrations up to
// the live head, the CLI history table, the legacy live-only site_* objects, and some V1 rows.
import { describe, expect, it } from "vitest"

import { createSupabaseTestDb, listMigrationFiles, seedOrganization } from "./pglite-harness"
import { buildRelease, LIVE_HEAD, pendingMigrations } from "./release"
import { diffSnapshots, snapshotQuery, type SchemaSnapshot } from "./schema-snapshot"

const LIVE_HEAD_FILE = listMigrationFiles().find((f) => f.startsWith(LIVE_HEAD))!

const LIVE_ONLY_LEGACY = `
create schema if not exists supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name)
select left(f, 14), substr(f, 16) from unnest($1::text[]) f;
create table public.site_settings (id uuid primary key default gen_random_uuid(), site_id text);
create table public.site_entries (id uuid primary key, settings_id uuid references public.site_settings(id));
create function public.ensure_site_settings(p_organization_id uuid, p_site_id text, p_name text) returns void language sql as 'select';
create function public.ingest_harvested_signals(p_organization_id uuid, p_items jsonb) returns void language sql as 'select';
`

async function liveLikeDb() {
  const db = await createSupabaseTestDb({ upTo: LIVE_HEAD_FILE })
  const applied = db.appliedMigrations.map((f) => f.replace(/\.sql$/, ""))
  await db.asPostgres(async (tx) => {
    for (const stmt of LIVE_ONLY_LEGACY.split(";\n").map((s) => s.trim()).filter(Boolean)) {
      await tx.query(stmt, stmt.includes("$1") ? [applied] : [])
    }
  })
  return db
}

describe("0.5 release script", () => {
  it("applies every pending migration on a live-shaped database and matches the repo head exactly", async () => {
    const db = await liveLikeDb()
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    await db.asUser(org.members.owner, async (tx) => {
      const cat = await tx.query<{ id: string }>("insert into public.source_categories(organization_id,name,created_by,updated_by) values ($1,'c',$2,$2) returning id", [org.organizationId, org.members.owner])
      await tx.query("insert into public.signals(organization_id,category_id,name,is_organized,created_by,updated_by) values ($1,$2,'线上旧信源',true,$3,$3)", [org.organizationId, cat.rows[0].id, org.members.owner])
    })

    await db.db.exec(buildRelease({ label: "test" }))

    const q = <T>(sql: string) => db.asPostgres(async (tx) => (await tx.query<T>(sql)).rows)
    const history = await q<{ version: string }>("select version from supabase_migrations.schema_migrations order by version")
    expect(history.map((h) => h.version)).toEqual(listMigrationFiles().map((f) => f.slice(0, 14)))
    expect(await q("select 1 from pg_proc where proname in ('ensure_site_settings','ingest_harvested_signals')")).toEqual([])
    const events = await q<{ text: string; work_item_id: string | null }>("select text, work_item_id from public.intake_events")
    expect(events).toEqual([expect.objectContaining({ text: "线上旧信源" })])
    expect(events[0].work_item_id).not.toBeNull()

    // Same structure as building the repo from scratch (the CLI history schema is not part of the snapshot).
    const after = (await db.asPostgres((tx) => tx.query<{ snapshot: SchemaSnapshot }>(snapshotQuery()))).rows[0].snapshot
    const fresh = await createSupabaseTestDb()
    const head = (await fresh.asPostgres((tx) => tx.query<{ snapshot: SchemaSnapshot }>(snapshotQuery()))).rows[0].snapshot
    await fresh.close()
    const diff = diffSnapshots(after, head)
    for (const [category, d] of Object.entries(diff)) expect({ category, ...d }).toEqual({ category, onlyRemote: [], onlyRepo: [], changed: [] })
    await db.close()
  })

  it("refuses to run twice or on an unexpected history, leaving the database untouched", async () => {
    const db = await liveLikeDb()
    await db.db.exec(buildRelease({ label: "test" }))
    await expect(db.db.exec(buildRelease({ label: "test" }))).rejects.toThrow(/preflight/)
    await db.db.exec("rollback") // the failed script left its transaction open
    await db.close()

    const drifted = await liveLikeDb()
    await drifted.asPostgres((tx) => tx.query("insert into supabase_migrations.schema_migrations(version, name) values ('20261101000000', 'unknown')"))
    await expect(drifted.db.exec(buildRelease({ label: "test" }))).rejects.toThrow(/expected last applied migration/)
    await drifted.db.exec("rollback")
    expect((await drifted.asPostgres((tx) => tx.query("select to_regclass('public.work_items') r"))).rows[0]).toEqual({ r: null })
    await drifted.close()
  })

  it("refuses to drop a legacy table that holds data", async () => {
    const db = await liveLikeDb()
    await db.asPostgres((tx) => tx.query("insert into public.site_settings(site_id) values ('x')"))
    await expect(db.db.exec(buildRelease({ label: "test" }))).rejects.toThrow(/must be empty/)
    await db.db.exec("rollback")
    await db.close()
  })

  it("contains only the pending migrations and no secrets", () => {
    const sql = buildRelease({ label: "test" })
    expect(pendingMigrations().every((f) => f > LIVE_HEAD_FILE)).toBe(true)
    for (const f of pendingMigrations()) expect(sql).toContain(`-- >>> ${f}`)
    expect(sql).not.toMatch(/service_role_key|sb_secret|password\s*=|supabase\.co/i)
  })
})
