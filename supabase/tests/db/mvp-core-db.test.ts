// @vitest-environment node
// DB2a (docs/database.md §4.1–4.3): intake_events, work_items, content_documents.work_item_id,
// and the V1 → 0.5 backfill that the retire migration will run before dropping the V1 tables.
import { createHash } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createSupabaseTestDb, seedOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"

let db: SupabaseTestDb

beforeAll(async () => {
  db = await createSupabaseTestDb()
})
afterAll(async () => {
  await db?.close()
})

async function expectDenied(promise: Promise<unknown>, pattern?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as Error
  )
  expect(error, "expected the database to refuse").not.toBeNull()
  if (pattern) expect(error?.message).toMatch(pattern)
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex")
const record = `select (e).* from (select public.record_intake_event($1, $2, $3, $4, $5, $6::jsonb, $7) e) s`

async function connection(orgId: string, ownerId: string, opts: { revoked?: boolean } = {}) {
  return db.asPostgres(async (tx) =>
    (
      await tx.query<{ id: string }>(
        `insert into public.intake_connections(organization_id, created_by, name, adapter, token_hash, revoked_at)
         values ($1, $2, 'bot', 'feishu', $3, $4) returning id`,
        [orgId, ownerId, hash(crypto.randomUUID()), opts.revoked ? new Date().toISOString() : null]
      )
    ).rows[0].id
  )
}

describe("record_intake_event", () => {
  it("records a web input once, keyed by the client idempotency key", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "viewer" }] })
    const { owner, viewer } = org.members
    const args = [org.organizationId, "web", "key-1", "一条速记", "https://example.com/a", '{"intent":"capture_only"}', null]
    const a = await db.asUser(owner, (tx) => tx.query<{ id: string; created_by: string; work_item_id: null }>(record, args))
    const b = await db.asUser(owner, (tx) => tx.query<{ id: string }>(record, args))
    expect(b.rows[0].id).toBe(a.rows[0].id)
    expect(a.rows[0]).toMatchObject({ created_by: owner, work_item_id: null })

    await expectDenied(db.asUser(viewer, (tx) => tx.query(record, [org.organizationId, "web", "key-2", "x", null, "{}", null])), /权限/)
    // Browsers cannot pretend to be an IM bot or use a connection.
    await expectDenied(db.asUser(owner, (tx) => tx.query(record, [org.organizationId, "im", "key-3", "x", null, "{}", null])), /web \/ chat/)
  })

  it("lets the service role record through a live connection only", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    const live = await connection(org.organizationId, org.members.owner)
    const revoked = await connection(org.organizationId, org.members.owner, { revoked: true })
    const r = await db.asServiceRole((tx) =>
      tx.query<{ source: string; connection_id: string; created_by: string | null }>(record, [org.organizationId, "im", "msg-1", "飞书消息", null, '{"reply_to":{"chat_id":"c1"}}', live])
    )
    expect(r.rows[0]).toMatchObject({ source: "im", connection_id: live, created_by: null })
    // Same external id through another source or connection is a different input.
    const other = await db.asServiceRole((tx) => tx.query<{ id: string }>(record, [org.organizationId, "api", "msg-1", "x", null, "{}", null]))
    expect(other.rows[0].id).not.toBe(r.rows[0])
    await expectDenied(db.asServiceRole((tx) => tx.query(record, [org.organizationId, "im", "msg-2", "x", null, "{}", revoked])), /吊销/)
  })

  it("keeps the original input immutable; only triage columns change", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    const { owner } = org.members
    const ev = await db.asUser(owner, (tx) => tx.query<{ id: string }>(record, [org.organizationId, "web", "k", "原文", null, "{}", null]))
    const id = ev.rows[0].id
    const item = await db.asUser(owner, (tx) =>
      tx.query<{ id: string; created_by: string; status: string }>("insert into public.work_items(organization_id, title, created_by) values ($1, '选题', gen_random_uuid()) returning id, created_by, status", [org.organizationId])
    )
    expect(item.rows[0]).toMatchObject({ created_by: owner, status: "todo" })
    await db.asUser(owner, (tx) => tx.query("update public.intake_events set work_item_id = $1 where id = $2", [item.rows[0].id, id]))
    await db.asUser(owner, (tx) => tx.query("update public.intake_events set ignored_at = now() where id = $1", [id]))
    await expectDenied(db.asUser(owner, (tx) => tx.query("update public.intake_events set text = 'changed' where id = $1", [id])), /permission denied/)
    await expectDenied(db.asPostgres((tx) => tx.query("update public.intake_events set payload = '{\"x\":1}' where id = $1", [id])), /不可修改/)
  })
})

describe("work_items", () => {
  it("is readable by viewers, writable by content managers, and pinned to its organization", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "viewer" }] })
    const other = await seedOrganization(db, { members: [{ role: "owner" }] })
    const { owner, viewer } = org.members
    const w = await db.asUser(owner, (tx) =>
      tx.query<{ id: string }>(`insert into public.work_items(organization_id, kind, title, brief) values ($1, 'video', 'V', '{"aspect_ratio":"9:16"}') returning id`, [org.organizationId])
    )
    const id = w.rows[0].id
    expect((await db.asUser(viewer, (tx) => tx.query("select id from public.work_items where id = $1", [id]))).rows).toHaveLength(1)
    await expectDenied(db.asUser(viewer, (tx) => tx.query("insert into public.work_items(organization_id, title) values ($1, 'x')", [org.organizationId])))
    await db.asUser(owner, (tx) => tx.query("update public.work_items set status = 'doing' where id = $1", [id]))
    await expectDenied(db.asUser(owner, (tx) => tx.query("update public.work_items set organization_id = $1 where id = $2", [other.organizationId, id])))
    await expectDenied(db.asUser(owner, (tx) => tx.query("update public.work_items set status = 'stuck' where id = $1", [id])), /check/)
    expect((await db.asUser(other.members.owner, (tx) => tx.query("select id from public.work_items where id = $1", [id]))).rows).toHaveLength(0)
  })
})

describe("private.backfill_v1", () => {
  it("moves every V1 row to its 0.5 home, keeps a legacy pointer, and is idempotent", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    const { owner } = org.members
    const o = org.organizationId
    const conn = await connection(o, owner)

    const ids = await db.asUser(owner, async (tx) => {
      const one = async <T = { id: string }>(sql: string, params: unknown[]) => (await tx.query<T>(sql, params)).rows[0]
      const cat = await one("insert into public.source_categories(organization_id, name, created_by, updated_by) values ($1, '科技', $2, $2) returning id", [o, owner])
      const sig = (name: string, organized: boolean) =>
        one(
          "insert into public.signals(organization_id, category_id, name, summary, site_url, is_organized, created_by, updated_by) values ($1, $2, $3, '摘要', 'https://example.com', $4, $5, $5) returning id",
          [o, cat.id, name, organized, owner]
        )
      const sReceipt = await sig("外部收录", true)
      const sPlain = await sig("只收录", false)
      const sOrganized = await sig("已整理无选题", true)
      const sel = (signalId: string, name: string) =>
        one("insert into public.selections(organization_id, signal_id, name, core_thesis, created_by, updated_by) values ($1, $2, $3, '论点', $4, $4) returning id", [o, signalId, name, owner])
      const selA = await sel(sReceipt.id, "选题 A")
      const selB = await sel(sReceipt.id, "选题 B")
      const proj = (selectionId: string | null, title: string) =>
        one("insert into public.content_projects(organization_id, selection_id, title, brief, content_kind) values ($1, $2, $3, 'Brief 原文', 'story') returning id", [o, selectionId, title])
      const pA1 = await proj(selA.id, "项目 A1")
      const pA2 = await proj(selA.id, "项目 A2")
      const pLone = await proj(null, "独立项目")
      const doc = await one("insert into public.content_documents(organization_id, project_id, title, body) values ($1, $2, '稿', '正文') returning id", [o, pA1.id])
      await tx.query("update public.content_documents set status = 'in_review' where id = $1", [doc.id])
      return { cat, sReceipt, sPlain, sOrganized, selA, selB, pA1, pA2, pLone, doc }
    })
    await db.asPostgres((tx) =>
      tx.query("insert into public.intake_receipts(organization_id, connection_id, external_id, payload, signal_id, selection_id) values ($1, $2, 'ext-1', '{\"a\":1}', $3, $4)", [
        o,
        conn,
        ids.sReceipt.id,
        ids.selA.id,
      ])
    )

    const first = await db.asPostgres((tx) => tx.query<{ r: Record<string, number> }>("select private.backfill_v1() r"))
    // Other tests' V1 rows live in the same database, so check this organization's rows rather than global counts.
    expect(first.rows[0].r.receipts).toBeGreaterThanOrEqual(1)

    const q = <T>(sql: string, params: unknown[] = [o]) => db.asPostgres(async (tx) => (await tx.query<T>(sql, params)).rows)
    const events = await q<{ source: string; external_id: string; connection_id: string | null; work_item_id: string | null; sig: string }>(
      "select source, external_id, connection_id, work_item_id, payload->'legacy'->>'signal_id' sig from public.intake_events where organization_id = $1 order by sig"
    )
    expect(events).toHaveLength(3) // one per signal
    const bySig = Object.fromEntries(events.map((e) => [e.sig, e]))
    expect(bySig[ids.sReceipt.id]).toMatchObject({ source: "api", external_id: "ext-1", connection_id: conn })
    expect(bySig[ids.sPlain.id]).toMatchObject({ source: "web", work_item_id: null })
    expect(bySig[ids.sOrganized.id].work_item_id).not.toBeNull()

    const items = await q<{ id: string; title: string; legacy: Record<string, unknown>; brief: Record<string, unknown>; category_id: string | null }>(
      "select id, title, brief->'legacy' legacy, brief, category_id from public.work_items where organization_id = $1"
    )
    // selA (+ project A1 merged), selB, organized signal, project A2, lone project
    expect(items).toHaveLength(5)
    const selAItem = items.find((w) => w.legacy.selection_id === Number(ids.selA.id))!
    // A1 and A2 share a created_at (same transaction), so either may be the one merged into the selection's card.
    expect([ids.pA1.id, ids.pA2.id]).toContain(selAItem.legacy.content_project_id)
    expect(selAItem.brief).toMatchObject({ text: "Brief 原文", content_kind: "story", core_thesis: "论点" })
    expect(String(selAItem.category_id)).toBe(String(ids.cat.id))
    const projectCards = items.filter((w) => w.legacy.content_project_id)
    expect(projectCards.map((w) => w.legacy.content_project_id).sort()).toEqual([ids.pA1.id, ids.pA2.id, ids.pLone.id].sort())
    // The receipt's input points at its first selection's card.
    expect(bySig[ids.sReceipt.id].work_item_id).toBe(selAItem.id)

    const docs = await q<{ work_item_id: string }>("select work_item_id from public.content_documents where id = $1", [ids.doc.id])
    expect(docs[0].work_item_id).toBe(projectCards.find((w) => w.legacy.content_project_id === ids.pA1.id)!.id)
    const audits = await q<{ action: string }>("select action from public.audit_events where target_id = $1 order by created_at, id", [ids.doc.id])
    expect(audits.map((a) => a.action)).toEqual(["content.draft", "content.in_review"])

    const again = await db.asPostgres((tx) => tx.query<{ r: Record<string, number> }>("select private.backfill_v1() r"))
    expect(Object.values(again.rows[0].r).every((n) => n === 0)).toBe(true)
  })

  it("is not callable from the API", async () => {
    const org = await seedOrganization(db, { members: [{ role: "owner" }] })
    await expectDenied(db.asUser(org.members.owner, (tx) => tx.query("select private.backfill_v1()")))
    await expectDenied(db.asServiceRole((tx) => tx.query("select private.backfill_v1()")))
  })
})
