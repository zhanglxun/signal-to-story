// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createSupabaseTestDb, seedOrganization, type SupabaseTestDb } from "./pglite-harness"

let db: SupabaseTestDb
beforeAll(async () => {
  db = await createSupabaseTestDb()
}, 60_000)
afterAll(async () => {
  await db?.close()
})

async function setup() {
  const org = await seedOrganization(db, { members: [{ role: "owner" }] })
  const other = await seedOrganization(db, { members: [{ role: "owner" }] })
  const owner = org.members.owner
  const asset = async (organizationId: string) =>
    (await db.asPostgres((tx) => tx.query<{ id: number }>("insert into public.assets(organization_id,name,asset_type,created_by) values($1,'final','video_studio',$2) returning id", [organizationId, owner]))).rows[0].id
  const own = await db.asUser(owner, async (tx) => {
    const p = await tx.query<{ id: string }>("insert into public.content_projects(organization_id,title) values($1,'P') returning id", [org.organizationId])
    const d = await tx.query<{ id: string }>("insert into public.content_documents(organization_id,project_id,platform,title,body) values($1,$2,'douyin','T','Body') returning id", [org.organizationId, p.rows[0].id])
    await tx.query("update public.content_documents set status='in_review' where id=$1", [d.rows[0].id])
    await tx.query("update public.content_documents set status='approved', review_note='ok' where id=$1", [d.rows[0].id])
    const c = await tx.query<{ id: string }>("insert into public.publishing_channels(organization_id,platform,name) values($1,'douyin','号') returning id", [org.organizationId])
    return { doc: d.rows[0].id, channel: c.rows[0].id }
  })
  return { org, owner, own, ownAsset: await asset(org.organizationId), foreignAsset: await asset(other.organizationId) }
}

const plan = (s: Awaited<ReturnType<typeof setup>>, assetId: number | null) =>
  db.asUser(s.owner, (tx) =>
    tx.query("insert into public.content_publications(organization_id,document_id,revision,channel_id,scheduled_at,video_asset_id) values($1,$2,1,$3,now()+interval '1 day',$4)", [s.org.organizationId, s.own.doc, s.own.channel, assetId])
  )

describe("content_publications.video_asset_id", () => {
  it("accepts a planned publication carrying the org's video asset, and a null one", async () => {
    const s = await setup()
    await plan(s, s.ownAsset)
    const row = (await db.asPostgres((tx) => tx.query<{ video_asset_id: number; status: string }>("select video_asset_id, status from public.content_publications where document_id=$1", [s.own.doc]))).rows[0]
    expect(row).toMatchObject({ video_asset_id: s.ownAsset, status: "planned" })
  })

  it("keeps text publications working with no asset", async () => {
    const s = await setup()
    await plan(s, null)
  })

  it("rejects an asset from another organization (composite FK)", async () => {
    const s = await setup()
    await expect(plan(s, s.foreignAsset)).rejects.toMatchObject({ code: "23503" })
  })
})
