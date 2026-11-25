// @vitest-environment node
// DB4 (docs/database.md §4.3, invariants 4 and 6): publish_document copies the approved revision into the
// document's published_* columns behind the publish_site Mandate; anon reads only those columns of published rows.
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createSupabaseTestDb, seedOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"

let db: SupabaseTestDb

beforeAll(async () => {
  db = await createSupabaseTestDb()
}, 60_000)
afterAll(async () => {
  await db?.close()
})

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = (await promise.then(() => null, (e: unknown) => e)) as { code?: string; message?: string } | null
  expect(error, `expected ${code}`).not.toBeNull()
  expect(error?.code).toBe(code)
}

async function setup() {
  const org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "member" }] })
  const other = await seedOrganization(db, { members: [{ role: "owner" }] })
  const owner = org.members.owner
  const editor = org.members.member
  const doc = await db.asUser(owner, async (tx) => {
    const w = await tx.query<{ id: string }>("insert into public.work_items(organization_id,title) values($1,'Card') returning id", [org.organizationId])
    const d = await tx.query<{ id: string }>(
      "insert into public.content_documents(organization_id,work_item_id,platform,title,body) values($1,$2,'x','T','Body one') returning id",
      [org.organizationId, w.rows[0].id]
    )
    await tx.query("update public.content_documents set status='in_review' where id=$1", [d.rows[0].id])
    await tx.query("update public.content_documents set status='approved', review_note='ok' where id=$1", [d.rows[0].id])
    return d.rows[0].id
  })
  return { org, other, owner, editor, doc }
}

const meta = (slug = "post-one") => JSON.stringify({ slug, summary: "摘要" })
const publish = (user: string, doc: string, rev: number, slug?: string) =>
  db.asUser(user, (tx) => tx.query<{ r: { unchanged: boolean; action: string } }>("select public.publish_document($1,$2,$3::jsonb) as r", [doc, rev, meta(slug)]))
const request = (user: string, orgId: string, doc: string, rev: number) =>
  db.asUser(user, (tx) => tx.query<{ id: string }>("select (public.create_approval_request($1,'publish_site','content_document',$2,$3,'t')).id as id", [orgId, doc, rev])).then((r) => r.rows[0].id)
const decide = (user: string, id: string) => db.asUser(user, (tx) => tx.query("select public.decide_approval_request($1,'approved')", [id]))
const reapprove = (user: string, doc: string, body: string) =>
  db.asUser(user, async (tx) => {
    await tx.query("update public.content_documents set body=$2 where id=$1", [doc, body])
    await tx.query("update public.content_documents set status='in_review' where id=$1", [doc])
    await tx.query("update public.content_documents set status='approved', review_note='ok' where id=$1", [doc])
  })
const anonRead = () =>
  db.asAnon(async (tx) => (await tx.query<{ id: string; published_title: string; published_body: string; published_revision: number }>(
    "select id, slug, published_title, published_body, published_revision from public.content_documents")).rows)

describe("publish_document Mandate", () => {
  it("refuses to publish an approved revision without an approved request (MD001)", async () => {
    const s = await setup()
    await expectCode(publish(s.owner, s.doc, 1), "MD001")
    await request(s.owner, s.org.organizationId, s.doc, 1) // pending is not enough
    await expectCode(publish(s.owner, s.doc, 1), "MD001")
  })

  it("publishes after approval, and an idempotent retry needs no fresh approval", async () => {
    const s = await setup()
    await decide(s.owner, await request(s.owner, s.org.organizationId, s.doc, 1))
    expect((await publish(s.owner, s.doc, 1)).rows[0].r.action).toBe("publish")
    expect((await publish(s.owner, s.doc, 1)).rows[0].r.unchanged).toBe(true)
    await db.asPostgres((tx) => tx.query("update public.approval_requests set expires_at = now() - interval '1 hour' where target_id=$1", [s.doc]))
    expect((await publish(s.owner, s.doc, 1)).rows[0].r.unchanged).toBe(true)
  })

  it("reports an expired approval distinctly (MD002)", async () => {
    const s = await setup()
    await decide(s.owner, await request(s.owner, s.org.organizationId, s.doc, 1))
    await db.asPostgres((tx) => tx.query("update public.approval_requests set expires_at = now() - interval '1 hour' where target_id=$1", [s.doc]))
    await expectCode(publish(s.owner, s.doc, 1), "MD002")
  })

  it("a new revision voids the old approval; editing never changes what is live", async () => {
    const s = await setup()
    await decide(s.owner, await request(s.owner, s.org.organizationId, s.doc, 1))
    await publish(s.owner, s.doc, 1)
    await db.asUser(s.owner, (tx) => tx.query("update public.content_documents set body='Edited after publishing' where id=$1", [s.doc]))
    expect((await anonRead()).find((r) => r.id === s.doc)).toMatchObject({ published_body: "Body one", published_revision: 1 })

    await reapprove(s.owner, s.doc, "Body two")
    await expectCode(publish(s.owner, s.doc, 3), "MD001") // the v1 approval does not carry over to v3
    await decide(s.owner, await request(s.owner, s.org.organizationId, s.doc, 3))
    expect((await publish(s.owner, s.doc, 3)).rows[0].r.action).toBe("replace")
    expect((await anonRead()).find((r) => r.id === s.doc)).toMatchObject({ published_body: "Body two", published_revision: 3 })
  })

  it("only an approved current revision can be published", async () => {
    const s = await setup()
    await decide(s.owner, await request(s.owner, s.org.organizationId, s.doc, 1))
    await expectCode(publish(s.owner, s.doc, 2), "P0001")
    await db.asUser(s.owner, (tx) => tx.query("update public.content_documents set body='draft again' where id=$1", [s.doc]))
    await expectCode(publish(s.owner, s.doc, 2), "P0001") // v2 exists but is a draft
  })

  it("members without content.publish may request but cannot approve or publish; other orgs cannot touch it", async () => {
    const s = await setup()
    const id = await request(s.editor, s.org.organizationId, s.doc, 1)
    await expectCode(decide(s.editor, id), "42501")
    await decide(s.owner, id)
    await expectCode(publish(s.editor, s.doc, 1), "42501")
    await expectCode(publish(s.other.members.owner, s.doc, 1), "42501")
  })
})

describe("published columns", () => {
  it("can only be written by the publishing RPCs, not by direct updates", async () => {
    const s = await setup()
    await expectCode(db.asUser(s.owner, (tx) => tx.query("update public.content_documents set published_at=now() where id=$1", [s.doc])), "42501")
    await expectCode(db.asServiceRole((tx) => tx.query("update public.content_documents set published_title='x' where id=$1", [s.doc])), "42501")
  })

  it("anon sees only published rows through column grants; unpublish hides the row again", async () => {
    const s = await setup()
    expect((await anonRead()).some((r) => r.id === s.doc)).toBe(false)
    await decide(s.owner, await request(s.owner, s.org.organizationId, s.doc, 1))
    await publish(s.owner, s.doc, 1, `post-${s.doc.slice(0, 8)}`)
    expect((await anonRead()).some((r) => r.id === s.doc)).toBe(true)
    await expectCode(db.asAnon((tx) => tx.query("select body from public.content_documents")), "42501")
    await expectCode(db.asAnon((tx) => tx.query("select * from public.content_documents")), "42501")

    const off = await db.asUser(s.owner, (tx) => tx.query<{ r: { unchanged: boolean } }>("select public.unpublish_document($1) as r", [s.doc]))
    expect(off.rows[0].r.unchanged).toBe(false)
    expect((await anonRead()).some((r) => r.id === s.doc)).toBe(false)
    const audit = await db.asPostgres((tx) => tx.query<{ action: string }>("select action from public.audit_events where target_id=$1 and action like 'content.%publish%' order by id", [s.doc]))
    expect(audit.rows.map((a) => a.action)).toEqual(["content.published", "content.unpublished"])
  })

  it("records a manual external link on an approved document, for content.publish only", async () => {
    const s = await setup()
    await expectCode(db.asUser(s.editor, (tx) => tx.query("select public.set_document_published_url($1,'https://x.com/p/1')", [s.doc])), "42501")
    await db.asUser(s.owner, (tx) => tx.query("select public.set_document_published_url($1,'https://x.com/p/1')", [s.doc]))
    const row = await db.asPostgres((tx) => tx.query<{ published_url: string }>("select published_url from public.content_documents where id=$1", [s.doc]))
    expect(row.rows[0].published_url).toBe("https://x.com/p/1")
    await expectCode(db.asUser(s.owner, (tx) => tx.query("select public.set_document_published_url($1,'javascript:alert(1)')", [s.doc])), "22023")
  })

  it("slugs are unique per organization", async () => {
    const s = await setup()
    const second = await db.asUser(s.owner, async (tx) => {
      const w = await tx.query<{ id: string }>("insert into public.work_items(organization_id,title) values($1,'Card 2') returning id", [s.org.organizationId])
      const d = await tx.query<{ id: string }>("insert into public.content_documents(organization_id,work_item_id,platform,title,body) values($1,$2,'x','T2','B2') returning id", [s.org.organizationId, w.rows[0].id])
      await tx.query("update public.content_documents set status='in_review' where id=$1", [d.rows[0].id])
      await tx.query("update public.content_documents set status='approved', review_note='ok' where id=$1", [d.rows[0].id])
      return d.rows[0].id
    })
    await decide(s.owner, await request(s.owner, s.org.organizationId, s.doc, 1))
    await decide(s.owner, await request(s.owner, s.org.organizationId, second, 1))
    await publish(s.owner, s.doc, 1, "same-slug")
    await expectCode(publish(s.owner, second, 1, "same-slug"), "23505")
  })
})
