// @vitest-environment node
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
  const site = (await db.asPostgres((tx) =>
    tx.query<{ id: string }>("insert into public.site_settings(organization_id,slug,name,status) values($1,$2,'S','online') returning id", [org.organizationId, `s-${org.organizationId}`])
  )).rows[0].id
  const doc = await db.asUser(owner, async (tx) => {
    const p = await tx.query<{ id: string }>("insert into public.content_projects(organization_id,title) values($1,'P') returning id", [org.organizationId])
    const d = await tx.query<{ id: string }>("insert into public.content_documents(organization_id,project_id,platform,title,body) values($1,$2,'x','T','Body one') returning id", [org.organizationId, p.rows[0].id])
    await tx.query("update public.content_documents set status='in_review' where id=$1", [d.rows[0].id])
    await tx.query("update public.content_documents set status='approved', review_note='ok' where id=$1", [d.rows[0].id])
    return d.rows[0].id
  })
  return { org, other, owner, editor, site, doc }
}

const meta = JSON.stringify({ slug: "post-one", summary: "摘要" })
const publish = (user: string, site: string, doc: string, rev: number) =>
  db.asUser(user, (tx) => tx.query<{ r: { unchanged: boolean; action: string } }>("select public.publish_site_entry($1,$2,$3,$4::jsonb) as r", [site, doc, rev, meta]))
const request = (user: string, orgId: string, site: string, doc: string, rev: number) =>
  db.asUser(user, (tx) =>
    tx.query<{ id: string }>("select (public.create_approval_request($1,'publish_site','content_document',$2,$3,'t',$4::jsonb)).id as id", [orgId, doc, rev, JSON.stringify({ site_id: site })])
  ).then((r) => r.rows[0].id)
const decide = (user: string, id: string) => db.asUser(user, (tx) => tx.query("select public.decide_approval_request($1,'approved')", [id]))
const reapprove = (user: string, doc: string, body: string) =>
  db.asUser(user, async (tx) => {
    await tx.query("update public.content_documents set body=$2 where id=$1", [doc, body])
    await tx.query("update public.content_documents set status='in_review' where id=$1", [doc])
    await tx.query("update public.content_documents set status='approved', review_note='ok' where id=$1", [doc])
  })

describe("publish_site Mandate", () => {
  it("refuses to publish an approved revision without an approval request (MD001)", async () => {
    const s = await setup()
    await expectCode(publish(s.owner, s.site, s.doc, 1), "MD001")
    await request(s.owner, s.org.organizationId, s.site, s.doc, 1) // pending is not enough
    await expectCode(publish(s.owner, s.site, s.doc, 1), "MD001")
  })

  it("publishes after approval, and an idempotent retry still succeeds", async () => {
    const s = await setup()
    await decide(s.owner, await request(s.owner, s.org.organizationId, s.site, s.doc, 1))
    expect((await publish(s.owner, s.site, s.doc, 1)).rows[0].r.action).toBe("publish")
    expect((await publish(s.owner, s.site, s.doc, 1)).rows[0].r.unchanged).toBe(true)
    // even if the approval later expires, an unchanged retry does not need a new one
    await db.asPostgres((tx) => tx.query("update public.approval_requests set expires_at = now() - interval '1 hour' where target_id=$1", [s.doc]))
    expect((await publish(s.owner, s.site, s.doc, 1)).rows[0].r.unchanged).toBe(true)
  })

  it("reports an expired approval distinctly (MD002)", async () => {
    const s = await setup()
    await decide(s.owner, await request(s.owner, s.org.organizationId, s.site, s.doc, 1))
    await db.asPostgres((tx) => tx.query("update public.approval_requests set expires_at = now() - interval '1 hour' where target_id=$1", [s.doc]))
    await expectCode(publish(s.owner, s.site, s.doc, 1), "MD002")
  })

  it("an approval is bound to the site", async () => {
    const s = await setup()
    const otherSite = (await db.asPostgres((tx) =>
      tx.query<{ id: string }>("insert into public.site_settings(organization_id,slug,name,status) values($1,$2,'S2','online') returning id", [s.org.organizationId, `t-${s.org.organizationId}`])
    )).rows[0].id
    await decide(s.owner, await request(s.owner, s.org.organizationId, otherSite, s.doc, 1))
    await expectCode(publish(s.owner, s.site, s.doc, 1), "MD001")
  })

  it("a new revision voids the old approval and the old revision cannot be published", async () => {
    const s = await setup()
    const id = await request(s.owner, s.org.organizationId, s.site, s.doc, 1)
    await decide(s.owner, id)
    await reapprove(s.owner, s.doc, "Body two")
    const row = await db.asPostgres((tx) => tx.query<{ status: string }>("select status from public.approval_requests where id=$1", [id]))
    expect(row.rows[0].status).toBe("expired")
    await expectCode(publish(s.owner, s.site, s.doc, 1), "P0001") // not the current revision
    await expectCode(publish(s.owner, s.site, s.doc, 2), "MD001") // review passed, but no approval for rev 2
    await decide(s.owner, await request(s.owner, s.org.organizationId, s.site, s.doc, 2))
    expect((await publish(s.owner, s.site, s.doc, 2)).rows[0].r.action).toBe("publish")
  })

  it("members without content.publish may request but cannot approve", async () => {
    const s = await setup()
    const id = await request(s.editor, s.org.organizationId, s.site, s.doc, 1)
    await expectCode(decide(s.editor, id), "42501")
    await expectCode(publish(s.editor, s.site, s.doc, 1), "42501")
  })

  it("is isolated across organizations", async () => {
    const s = await setup()
    await expectCode(request(s.other.members.owner, s.org.organizationId, s.site, s.doc, 1), "42501")
    const id = await request(s.owner, s.org.organizationId, s.site, s.doc, 1)
    await expectCode(decide(s.other.members.owner, id), "42501")
    await expectCode(publish(s.other.members.owner, s.site, s.doc, 1), "42501")
    const seen = await db.asUser(s.other.members.owner, (tx) => tx.query("select id from public.approval_requests where id=$1", [id]))
    expect(seen.rows).toHaveLength(0)
  })
})

describe("planned publications and revision changes", () => {
  it("invalidates plans pinned to an older revision and keeps them visible", async () => {
    const s = await setup()
    const ch = await db.asUser(s.owner, (tx) => tx.query<{ id: string }>("insert into public.publishing_channels(organization_id,platform,name) values($1,'x','acct') returning id", [s.org.organizationId]))
    const plan = await db.asUser(s.owner, (tx) =>
      tx.query<{ id: string }>("insert into public.content_publications(organization_id,document_id,revision,channel_id,scheduled_at) values($1,$2,1,$3,now()+interval '1 day') returning id", [s.org.organizationId, s.doc, ch.rows[0].id])
    )
    await reapprove(s.owner, s.doc, "Body two")
    const after = await db.asUser(s.owner, (tx) => tx.query<{ status: string; invalidated_at: string | null }>("select status, invalidated_at from public.content_publications where id=$1", [plan.rows[0].id]))
    expect(after.rows[0].status).toBe("cancelled")
    expect(after.rows[0].invalidated_at).not.toBeNull()
    // a plan for the new revision is unaffected by that history
    const fresh = await db.asUser(s.owner, (tx) =>
      tx.query<{ status: string }>("insert into public.content_publications(organization_id,document_id,revision,channel_id,scheduled_at) values($1,$2,2,$3,now()+interval '2 day') returning status", [s.org.organizationId, s.doc, ch.rows[0].id])
    )
    expect(fresh.rows[0].status).toBe("planned")
  })
})
