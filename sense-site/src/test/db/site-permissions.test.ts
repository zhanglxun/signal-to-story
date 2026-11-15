// @vitest-environment node
// Real permission isolation: every migration from sense-console is applied to an
// in-process PGlite database, then anon / reader / back-office identities query
// the same tables PostgREST would expose.
import { readFileSync } from "node:fs"
import path from "node:path"

import type { PGlite } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"

import {
  asIdentity,
  createMigratedDatabase,
  expectDenied,
  listMigrations,
  migrationsDir,
  type Identity,
} from "./pglite-harness"

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  otherOrg: "00000000-0000-4000-8000-000000000002",
  publisher: "00000000-0000-4000-8000-0000000000a1",
  editor: "00000000-0000-4000-8000-0000000000a2",
  otherPublisher: "00000000-0000-4000-8000-0000000000a3",
  readerA: "00000000-0000-4000-8000-0000000000b1",
  readerB: "00000000-0000-4000-8000-0000000000b2",
  unverified: "00000000-0000-4000-8000-0000000000b3",
  anonymousAuth: "00000000-0000-4000-8000-0000000000b4",
}
const anon: Identity = { role: "anon" }
const as = (userId: string, isAnonymous = false): Identity => ({
  role: "authenticated",
  userId,
  isAnonymous,
})

let db: PGlite
let siteId: string
let publicEntry: string
let registeredEntry: string
let draftDoc: string

async function count(identity: Identity, sql: string, params: unknown[] = []) {
  return asIdentity(db, identity, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      `select count(*)::int as n from (${sql}) q`,
      params
    )
    return rows[0].n
  })
}

beforeAll(async () => {
  db = await createMigratedDatabase()
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at, is_anonymous) values
      ('${ids.publisher}', 'pub@example.invalid', now(), false),
      ('${ids.editor}', 'edit@example.invalid', now(), false),
      ('${ids.otherPublisher}', 'other@example.invalid', now(), false),
      ('${ids.readerA}', 'a@example.invalid', now(), false),
      ('${ids.readerB}', 'b@example.invalid', now(), false),
      ('${ids.unverified}', 'c@example.invalid', null, false),
      ('${ids.anonymousAuth}', null, null, true);
    insert into public.profiles (user_id, email, display_name) values
      ('${ids.publisher}', 'pub@example.invalid', 'Publisher'),
      ('${ids.editor}', 'edit@example.invalid', 'Editor'),
      ('${ids.otherPublisher}', 'other@example.invalid', 'Other');
    insert into public.organizations (id, slug, name) values
      ('${ids.org}', 'site-org', 'Site org'), ('${ids.otherOrg}', 'other-org', 'Other org');
    insert into public.organization_roles (organization_id, role_key, name, description, permissions, assignment_permission) values
      ('${ids.org}', 'owner', 'Owner', 't', array['content.view','content.manage','content.review','content.publish'], 'owner.grant'),
      ('${ids.org}', 'member', 'Editor', 't', array['content.view','content.manage'], 'account.manage'),
      ('${ids.otherOrg}', 'owner', 'Owner', 't', array['content.view','content.manage','content.review','content.publish'], 'owner.grant');
    insert into public.organization_members (organization_id, user_id, role) values
      ('${ids.org}', '${ids.publisher}', 'owner'), ('${ids.org}', '${ids.editor}', 'member'),
      ('${ids.otherOrg}', '${ids.otherPublisher}', 'owner');
  `)
  const site = await db.query<{ id: string }>(
    `insert into public.site_settings (organization_id, slug, name, status)
     values ($1, 'test-site', 'Test site', 'online') returning id`,
    [ids.org]
  )
  siteId = site.rows[0].id

  await asIdentity(
    db,
    as(ids.publisher),
    async (tx) => {
      const project = await tx.query<{ id: string }>(
        "insert into public.content_projects (organization_id, title) values ($1, 'P') returning id",
        [ids.org]
      )
      const insertDoc = async (platform: string, title: string, body: string) =>
        (
          await tx.query<{ id: string }>(
            `insert into public.content_documents (organization_id, project_id, platform, title, body)
             values ($1, $2, $3, $4, $5) returning id`,
            [ids.org, project.rows[0].id, platform, title, body]
          )
        ).rows[0].id
      const publicDoc = await insertDoc("master", "Public", "# Public body")
      const registeredDoc = await insertDoc("x", "Registered", "Registered body")
      draftDoc = await insertDoc("youtube", "Draft", "Draft body")
      for (const id of [publicDoc, registeredDoc]) {
        await tx.query("update public.content_documents set status = 'in_review' where id = $1", [id])
        await tx.query(
          "update public.content_documents set status = 'approved', review_note = 'ok' where id = $1",
          [id]
        )
      }
      const publish = async (doc: string, meta: object) =>
        (
          await tx.query<{ r: { entry_id: string } }>(
            "select public.publish_site_entry($1, $2, 1, $3::jsonb) as r",
            [siteId, doc, JSON.stringify(meta)]
          )
        ).rows[0].r.entry_id
      publicEntry = await publish(publicDoc, { slug: "public-one", summary: "Public summary" })
      registeredEntry = await publish(registeredDoc, {
        slug: "registered-one",
        summary: "Registered summary",
        access_level: "registered",
      })
    },
    { commit: true }
  )
}, 60_000)

describe("migrations", () => {
  it("applies every sense-console migration, including the site layer", () => {
    const files = listMigrations()
    expect(files).toContain("20261116100000_create_site_publishing.sql")
    expect(files).toContain("20261116100100_site_publish_functions.sql")
  })

  it.each(["site_publishing.sql", "cloud_content_mvp.sql", "intake_gateway.sql"])(
    "passes SQL acceptance script %s (rolled back)",
    async (file) => {
      const fresh = await createMigratedDatabase()
      const script = readFileSync(
        path.resolve(migrationsDir, "../tests", file),
        "utf8"
      )
      await expect(fresh.exec(script)).resolves.toBeDefined()
      await fresh.close()
    },
    60_000
  )
})

describe("anonymous visitor", () => {
  it("reads online cards and only the public body", async () => {
    expect(await count(anon, "select id from public.site_entries")).toBe(2)
    expect(await count(anon, "select release_id from public.site_entry_bodies")).toBe(1)
    const body = await asIdentity(db, anon, async (tx) =>
      (await tx.query<{ entry_id: string }>("select entry_id from public.site_entry_bodies")).rows
    )
    expect(body[0].entry_id).toBe(publicEntry)
  })

  it("cannot reach back-office tables, hidden columns or the publish RPC", async () => {
    for (const sql of [
      "select * from public.content_documents",
      "select * from public.content_revisions",
      "select * from public.site_entry_releases",
      "select * from public.site_release_events",
      "select source_document_id from public.site_entries",
      "select * from public.site_bookmarks",
    ]) {
      expect(await expectDenied(db, anon, (tx) => tx.query(sql))).toMatch(/permission denied/)
    }
    expect(
      await expectDenied(db, anon, (tx) =>
        tx.query("select public.publish_site_entry($1, $2, 1, '{}'::jsonb)", [siteId, draftDoc])
      )
    ).toMatch(/permission denied/)
  })
})

describe("registered reader", () => {
  it("verified reader reads registered body but no organization data", async () => {
    const reader = as(ids.readerA)
    expect(await count(reader, "select release_id from public.site_entry_bodies")).toBe(2)
    expect(await count(reader, "select id from public.content_documents")).toBe(0)
    expect(await count(reader, "select id from public.organizations")).toBe(0)
    expect(await count(reader, "select user_id from public.organization_members")).toBe(0)
    expect(await count(reader, "select id from public.site_entry_releases")).toBe(0)
  })

  it("unverified email and anonymous Auth users only get the public body", async () => {
    expect(await count(as(ids.unverified), "select release_id from public.site_entry_bodies")).toBe(1)
    expect(
      await count(as(ids.anonymousAuth, true), "select release_id from public.site_entry_bodies")
    ).toBe(1)
  })

  it("bookmarks are private per reader and require verification", async () => {
    await asIdentity(
      db,
      as(ids.readerA),
      (tx) =>
        tx.query("insert into public.site_bookmarks (site_id, entry_id) values ($1, $2)", [
          siteId,
          registeredEntry,
        ]),
      { commit: true }
    )
    expect(await count(as(ids.readerA), "select entry_id from public.site_bookmarks")).toBe(1)
    expect(await count(as(ids.readerB), "select entry_id from public.site_bookmarks")).toBe(0)
    expect(
      await expectDenied(db, as(ids.readerB), (tx) =>
        tx.query(
          "insert into public.site_bookmarks (user_id, site_id, entry_id) values ($1, $2, $3)",
          [ids.readerA, siteId, publicEntry]
        )
      )
    ).toMatch(/row-level security/)
    expect(
      await expectDenied(db, as(ids.unverified), (tx) =>
        tx.query("insert into public.site_bookmarks (site_id, entry_id) values ($1, $2)", [
          siteId,
          publicEntry,
        ])
      )
    ).toMatch(/row-level security/)
  })

  it("cannot publish or write snapshot tables", async () => {
    expect(
      await expectDenied(db, as(ids.readerA), (tx) =>
        tx.query("select public.unpublish_site_entry($1, '')", [publicEntry])
      )
    ).toMatch(/权限/)
    expect(
      await expectDenied(db, as(ids.readerA), (tx) =>
        tx.query("update public.site_entries set access_level = 'public' where id = $1", [
          registeredEntry,
        ])
      )
    ).toMatch(/permission denied/)
  })
})

describe("back-office members", () => {
  it("editor without content.publish cannot publish", async () => {
    expect(
      await expectDenied(db, as(ids.editor), (tx) =>
        tx.query("select public.unpublish_site_entry($1, '')", [publicEntry])
      )
    ).toMatch(/权限/)
    expect(await count(as(ids.editor), "select id from public.site_entry_releases")).toBe(2)
  })

  it("other organization cannot publish into, or read releases of, this site", async () => {
    expect(
      await expectDenied(db, as(ids.otherPublisher), (tx) =>
        tx.query("select public.publish_site_entry($1, $2, 1, $3::jsonb)", [
          siteId,
          draftDoc,
          JSON.stringify({ slug: "x", summary: "x" }),
        ])
      )
    ).toMatch(/权限/)
    expect(await count(as(ids.otherPublisher), "select id from public.site_entry_releases")).toBe(0)
  })

  it("draft documents never publish, and unpublish hides the body immediately", async () => {
    expect(
      await expectDenied(db, as(ids.publisher), (tx) =>
        tx.query("select public.publish_site_entry($1, $2, 1, $3::jsonb)", [
          siteId,
          draftDoc,
          JSON.stringify({ slug: "draft", summary: "x" }),
        ])
      )
    ).toMatch(/已人工审核通过/)

    await asIdentity(db, as(ids.publisher), async (tx) => {
      await tx.query("select public.unpublish_site_entry($1, 'test')", [publicEntry])
      await tx.exec("reset role; set local role anon")
      await tx.query("select set_config('request.jwt.claim.sub', '', true)")
      await tx.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)")
      const { rows } = await tx.query<{ n: number }>(
        "select count(*)::int as n from public.site_entry_bodies"
      )
      expect(rows[0].n).toBe(0)
    })
    // Rolled back: still online for later tests.
    expect(await count(anon, "select id from public.site_entries")).toBe(2)
  })
})
