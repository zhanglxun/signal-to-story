// @vitest-environment node
// Real permission isolation: every migration in supabase/migrations is applied to an in-process PGlite database,
// then anon / back-office identities query content_documents the way PostgREST would. The reader site reads only
// the published_* columns of published rows (20261126100000_publish_on_documents.sql).
import type { PGlite } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"

import { asIdentity, createMigratedDatabase, expectDenied, listMigrations, type Identity } from "./pglite-harness"

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  publisher: "00000000-0000-4000-8000-0000000000a1",
  editor: "00000000-0000-4000-8000-0000000000a2",
}
const anon: Identity = { role: "anon" }
const as = (userId: string): Identity => ({ role: "authenticated", userId, isAnonymous: false })
const READER_COLUMNS = "id, slug, published_revision, published_title, published_body, published_meta, published_at"

let db: PGlite
let publishedDoc: string
let draftDoc: string

async function count(identity: Identity, sql: string, params: unknown[] = []) {
  return asIdentity(db, identity, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)
    return rows[0].n
  })
}

beforeAll(async () => {
  db = await createMigratedDatabase()
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at, is_anonymous) values
      ('${ids.publisher}', 'pub@example.invalid', now(), false),
      ('${ids.editor}', 'edit@example.invalid', now(), false);
    insert into public.profiles (user_id, email, display_name) values
      ('${ids.publisher}', 'pub@example.invalid', 'Publisher'),
      ('${ids.editor}', 'edit@example.invalid', 'Editor');
    insert into public.organizations (id, slug, name) values ('${ids.org}', 'site-org', 'Site org');
    insert into public.organization_roles (organization_id, role_key, name, description, permissions, assignment_permission) values
      ('${ids.org}', 'owner', 'Owner', 't', array['content.view','content.manage','content.review','content.publish'], 'owner.grant'),
      ('${ids.org}', 'member', 'Editor', 't', array['content.view','content.manage'], 'account.manage');
    insert into public.organization_members (organization_id, user_id, role) values
      ('${ids.org}', '${ids.publisher}', 'owner'), ('${ids.org}', '${ids.editor}', 'member');
  `)

  await asIdentity(
    db,
    as(ids.publisher),
    async (tx) => {
      const item = await tx.query<{ id: string }>(
        "insert into public.work_items (organization_id, kind, title) values ($1, 'article', 'Card') returning id",
        [ids.org]
      )
      const insertDoc = async (platform: string, title: string, body: string) =>
        (
          await tx.query<{ id: string }>(
            `insert into public.content_documents (organization_id, work_item_id, platform, title, body)
             values ($1, $2, $3, $4, $5) returning id`,
            [ids.org, item.rows[0].id, platform, title, body]
          )
        ).rows[0].id
      publishedDoc = await insertDoc("master", "Public", "# Public body")
      draftDoc = await insertDoc("x", "Draft", "Draft body")
      await tx.query("update public.content_documents set status = 'in_review' where id = $1", [publishedDoc])
      await tx.query("update public.content_documents set status = 'approved', review_note = 'ok' where id = $1", [publishedDoc])
      const request = await tx.query<{ id: string }>(
        "select (public.create_approval_request($1, 'publish_site', 'content_document', $2, 1, 'test')).id as id",
        [ids.org, publishedDoc]
      )
      await tx.query("select public.decide_approval_request($1, 'approved')", [request.rows[0].id])
      await tx.query("select public.publish_document($1, 1, $2::jsonb)", [
        publishedDoc,
        JSON.stringify({ slug: "public-one", summary: "Public summary" }),
      ])
    },
    { commit: true }
  )
}, 60_000)

describe("migrations", () => {
  it("applies every migration, including the publish-on-documents layer", () => {
    expect(listMigrations()).toContain("20261126100000_publish_on_documents.sql")
  })
})

describe("anon reader", () => {
  it("sees only published rows, through the published columns", async () => {
    expect(await count(anon, `select ${READER_COLUMNS} from public.content_documents`)).toBe(1)
    const row = await asIdentity(db, anon, async (tx) =>
      (await tx.query<{ slug: string; published_title: string; published_body: string }>(
        `select ${READER_COLUMNS} from public.content_documents where slug = 'public-one'`
      )).rows[0]
    )
    expect(row).toMatchObject({ slug: "public-one", published_title: "Public", published_body: "# Public body" })
  })

  it("cannot read draft columns, select *, or write anything", async () => {
    expect(await expectDenied(db, anon, (tx) => tx.query("select * from public.content_documents"))).not.toBeNull()
    expect(await expectDenied(db, anon, (tx) => tx.query("select body from public.content_documents"))).not.toBeNull()
    expect(await expectDenied(db, anon, (tx) => tx.query("select review_note from public.content_documents"))).not.toBeNull()
    expect(await expectDenied(db, anon, (tx) => tx.query("update public.content_documents set published_title = 'x'"))).not.toBeNull()
    expect(await expectDenied(db, anon, (tx) => tx.query("select * from public.work_items"))).not.toBeNull()
  })

  it("keeps the published snapshot when the document is edited, and loses it when unpublished", async () => {
    await asIdentity(
      db,
      as(ids.publisher),
      (tx) => tx.query("update public.content_documents set body = 'Changed after publishing' where id = $1", [publishedDoc]),
      { commit: true }
    )
    const body = await asIdentity(db, anon, async (tx) =>
      (await tx.query<{ published_body: string }>("select published_body from public.content_documents where id = $1", [publishedDoc])).rows[0]
        .published_body
    )
    expect(body).toBe("# Public body")

    await asIdentity(db, as(ids.publisher), (tx) => tx.query("select public.unpublish_document($1)", [publishedDoc]), { commit: true })
    expect(await count(anon, `select ${READER_COLUMNS} from public.content_documents`)).toBe(0)
  })
})

describe("back office", () => {
  it("cannot write published columns directly, even with content.publish", async () => {
    expect(await expectDenied(
      db, as(ids.publisher), (tx) =>
        tx.query("update public.content_documents set published_at = now(), published_title = 'x' where id = $1", [draftDoc])
      )
    ).not.toBeNull()
  })

  it("an editor without content.publish cannot publish", async () => {
    expect(await expectDenied(
      db, as(ids.editor), (tx) =>
        tx.query("select public.publish_document($1, 1, $2::jsonb)", [draftDoc, JSON.stringify({ slug: "draft", summary: "s" })])
      )
    ).not.toBeNull()
  })
})
