// @vitest-environment node
// Rehearse the generated step-5 release (final batch: DB4 + DB5 + DB3 + V1 retirement) on a database shaped like
// live after step 4, with V1 rows that were captured after step 1 (so the final backfill has work to do).
// Afterwards the structure must equal the repo head: 21 public tables, 0 views.
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { createSupabaseTestDb, listMigrationFiles, REPO_ROOT, seedOrganization, type SupabaseTestDb } from "./pglite-harness"
import { buildRelease, pendingMigrations, RELEASES } from "./release"
import { diffSnapshots, snapshotQuery, type SchemaSnapshot } from "./schema-snapshot"

const STEP5 = { ...RELEASES.step5, label: "test" }
const STEP4_LAST = listMigrationFiles().filter((f) => f.slice(0, 14) <= RELEASES.step5.after).at(-1)!

async function afterStep4() {
  const db = await createSupabaseTestDb({ upTo: STEP4_LAST })
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

/** V1 rows as they exist live: a signal, its selection, a project, a project document with review history. */
async function seedV1(db: SupabaseTestDb) {
  const org = await seedOrganization(db, { members: [{ role: "owner" }] })
  const { owner } = org.members
  const o = org.organizationId
  const ids = await db.asUser(owner, async (tx) => {
    const one = async (sql: string, params: unknown[]) => (await tx.query<{ id: string }>(sql, params)).rows[0].id
    const cat = await one("insert into public.source_categories(organization_id, name, created_by, updated_by) values ($1, '科技', $2, $2) returning id", [o, owner])
    const signal = await one(
      "insert into public.signals(organization_id, category_id, name, summary, site_url, is_organized, created_by, updated_by) values ($1, $2, '线索', '摘要', 'https://example.com', true, $3, $3) returning id",
      [o, cat, owner]
    )
    const loose = await one(
      "insert into public.signals(organization_id, category_id, name, summary, site_url, is_organized, created_by, updated_by) values ($1, $2, '只收录', '摘要', 'https://example.com/2', false, $3, $3) returning id",
      [o, cat, owner]
    )
    const selection = await one(
      "insert into public.selections(organization_id, signal_id, name, core_thesis, created_by, updated_by) values ($1, $2, '选题', '论点', $3, $3) returning id",
      [o, signal, owner]
    )
    const project = await one(
      "insert into public.content_projects(organization_id, selection_id, title, brief, content_kind) values ($1, $2, '项目', 'Brief', 'story') returning id",
      [o, selection]
    )
    const doc = await one("insert into public.content_documents(organization_id, project_id, platform, title, body) values ($1, $2, 'x', '稿', '正文') returning id", [o, project])
    await tx.query("update public.content_documents set status = 'in_review' where id = $1", [doc])
    await tx.query("update public.content_documents set status = 'approved', review_note = 'ok' where id = $1", [doc])
    return { signal, loose, selection, project, doc }
  })
  return { org, owner, ...ids }
}

const snapshot = async (db: SupabaseTestDb) => (await db.asPostgres((tx) => tx.query<{ snapshot: SchemaSnapshot }>(snapshotQuery()))).rows[0].snapshot

describe("0.5 release step 5 (final batch)", () => {
  it("publishes on documents, trims video, adds chat, retires V1 after a reconciled backfill, and matches repo head", async () => {
    const db = await afterStep4()
    const v1 = await seedV1(db)

    await db.db.exec(buildRelease(STEP5))

    const q = <T>(sql: string, params: unknown[] = []) => db.asPostgres(async (tx) => (await tx.query<T>(sql, params)).rows)
    expect((await q<{ version: string }>("select version from supabase_migrations.schema_migrations order by version")).map((h) => h.version))
      .toEqual(listMigrationFiles().map((f) => f.slice(0, 14)))

    // 21 tables, no views (docs/database.md §3).
    const rels = await q<{ relname: string; relkind: string }>(
      "select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v','m') order by 1"
    )
    expect(rels.filter((r) => r.relkind !== "r")).toEqual([])
    expect(rels.map((r) => r.relname)).toEqual([
      "agent_job_steps", "agent_jobs", "approval_requests", "assets", "audit_events", "chat_messages", "chat_sessions", "content_documents",
      "intake_connections", "intake_events", "organization_members", "organization_roles", "organizations", "profiles", "prompt_examples",
      "runner_nodes", "source_categories", "storage_provider_configs", "video_plans", "video_shots", "work_items",
    ])

    // Every V1 row is accounted for through its legacy pointer.
    const events = await q<{ signal: string }>("select payload->'legacy'->>'signal_id' as signal from public.intake_events where organization_id = $1 order by 1", [v1.org.organizationId])
    expect(events.map((e) => e.signal).sort()).toEqual([v1.signal, v1.loose].map(String).sort())
    const card = await q<{ id: string; selection: string; project: string }>(
      "select id, brief->'legacy'->>'selection_id' as selection, brief->'legacy'->>'content_project_id' as project from public.work_items where organization_id = $1",
      [v1.org.organizationId]
    )
    expect(card).toEqual([{ id: card[0].id, selection: String(v1.selection), project: String(v1.project) }])
    expect(await q("select work_item_id from public.content_documents where id = $1", [v1.doc])).toEqual([{ work_item_id: card[0].id }])
    const reviews = await q<{ action: string }>(
      "select action from public.audit_events where target_id = $1 and metadata ? 'legacy' order by created_at, id", [v1.doc]
    )
    expect(reviews.map((r) => r.action)).toEqual(["content.draft", "content.in_review", "content.approved"])

    // After the release: new review history goes to audit_events, and the document can be published.
    await db.asUser(v1.owner, async (tx) => {
      const ap = await tx.query<{ id: string }>("select (public.create_approval_request($1,'publish_site','content_document',$2,1,'t')).id as id", [v1.org.organizationId, v1.doc])
      await tx.query("select public.decide_approval_request($1,'approved')", [ap.rows[0].id])
      await tx.query("select public.publish_document($1,1,$2::jsonb)", [v1.doc, JSON.stringify({ slug: "v1-doc", summary: "摘要" })])
    })
    expect(await db.asAnon(async (tx) => (await tx.query("select slug, published_title from public.content_documents")).rows)).toEqual([{ slug: "v1-doc", published_title: "稿" }])

    const fresh = await createSupabaseTestDb()
    const diff = diffSnapshots(await snapshot(db), await snapshot(fresh))
    await fresh.close()
    for (const [category, d] of Object.entries(diff)) expect({ category, ...d }).toEqual({ category, onlyRemote: [], onlyRepo: [], changed: [] })
    await db.close()
  })

  it("refuses to run twice, while a worker holds a lease, or when V1 data would be lost — and leaves the database untouched", async () => {
    const db = await afterStep4()
    await db.db.exec(buildRelease(STEP5))
    await expect(db.db.exec(buildRelease(STEP5))).rejects.toThrow(/expected last applied migration/)
    await db.db.exec("rollback")
    await db.close()

    const busy = await afterStep4()
    const v1 = await seedV1(busy)
    await busy.asUser(v1.owner, (tx) =>
      tx.query("select public.enqueue_agent_job($1,'content_draft','k1','{\"instruction\":\"x\"}'::jsonb,'content_document',$2,1)", [v1.org.organizationId, v1.doc])
    )
    await busy.asServiceRole((tx) => tx.query("select public.claim_agent_job(array['content_draft'], 120)"))
    await expect(busy.db.exec(buildRelease(STEP5))).rejects.toThrow(/live lease/)
    await busy.db.exec("rollback")
    expect((await busy.asPostgres((tx) => tx.query<{ r: string | null }>("select to_regclass('public.signals') r"))).rows[0].r).not.toBeNull()
    await busy.close()

    const assets = await afterStep4()
    const a = await seedV1(assets)
    // As the owner, bypassing asset RLS (the role has no asset permission in this fixture).
    await assets.asPostgres(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub: a.owner, role: "authenticated" }), a.owner])
      const asset = await tx.query<{ id: number }>(
        "insert into public.assets(organization_id, asset_type, category, media_type, name, created_by) values ($1,'scene','x','image','a',$2) returning id",
        [a.org.organizationId, a.owner]
      )
      await tx.query("insert into public.content_project_assets(organization_id, project_id, asset_id, created_by) values ($1,$2,$3,$4)", [a.org.organizationId, a.project, asset.rows[0].id, a.owner])
    })
    await expect(assets.db.exec(buildRelease(STEP5))).rejects.toThrow(/content_project_assets has 1 rows/)
    await assets.db.exec("rollback")
    expect((await assets.asPostgres((tx) => tx.query<{ r: string | null }>("select to_regclass('public.content_projects') r"))).rows[0].r).not.toBeNull()
    await assets.close()
  })

  it("contains the four final migrations, no secrets, and is the committed script", () => {
    const sql = buildRelease(STEP5)
    expect(pendingMigrations(RELEASES.step5.after)).toEqual([
      "20261126100000_publish_on_documents.sql",
      "20261126100100_video_mvp.sql",
      "20261126100200_chat.sql",
      "20261126100300_retire_v1.sql",
    ])
    expect(sql).not.toMatch(/service_role_key|sb_secret|password\s*=|supabase\.co|stn_[a-f0-9]{64}/i)
    expect(sql).toBe(readFileSync(path.join(REPO_ROOT, "supabase/release", RELEASES.step5.file), "utf8").replace(RELEASES.step5.label, "test"))
  })
})
