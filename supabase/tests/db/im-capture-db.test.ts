// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { idempotencyKey, parseIntent } from "../../functions/_shared/im/shared"
import { createSupabaseTestDb, seedOrganization, type SeededOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"

let db: SupabaseTestDb
let org: SeededOrganization
let feishuConn: string
let wecomConn: string
const hash = (c: string) => c.repeat(64)

type Cap = { duplicate: boolean; event_id: string; work_item_id: string | null; documents: Array<{ platform: string; job_id: string }> }

const imCapture = (conn: string, target: string | null, text: string, messageId: string, channel: "feishu" | "wecom" = "feishu") => {
  const intent = parseIntent(text)
  if (intent.kind !== "capture" && intent.kind !== "auto_draft") throw new Error("not a capture intent")
  const input = { ...intent.input, external_id: idempotencyKey(channel, messageId) }
  return db.asServiceRole(async (tx) => (await tx.query<{ r: Cap }>("select public.im_quick_capture($1,$2,$3) as r", [conn, target, input])).rows[0].r)
}
const count = (table: string) =>
  db.asPostgres(async (tx) => Number((await tx.query<{ n: number }>(`select count(*)::int n from public.${table} where organization_id=$1`, [org.organizationId])).rows[0].n))

beforeAll(async () => {
  db = await createSupabaseTestDb()
  org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "viewer" }] })
  const ins = (adapter: string, h: string) =>
    db.asPostgres(async (tx) => (await tx.query<{ id: string }>("insert into public.intake_connections(organization_id,created_by,name,adapter,token_hash) values($1,$2,$3,$4,$5) returning id", [org.organizationId, org.members.owner, `${adapter} bot`, adapter, h])).rows[0].id)
  feishuConn = await ins("feishu", hash("a"))
  wecomConn = await ins("wecom", hash("b"))
})
afterAll(async () => {
  await db.close()
})

describe("im_quick_capture (IM webhook trusted path)", () => {
  it("same platform message id delivered twice yields exactly one capture", async () => {
    const first = await imCapture(feishuConn, "oc_chat_1", "https://example.com/im1 企业落地的角度", "om_dup_1")
    const again = await imCapture(feishuConn, "oc_chat_1", "https://example.com/im1 企业落地的角度", "om_dup_1")
    expect(first.duplicate).toBe(false)
    expect(again.duplicate).toBe(true)
    expect(again.event_id).toBe(first.event_id)
    expect(first.work_item_id).toBeNull()
    expect(await count("intake_events")).toBe(1)
    expect(await count("work_items")).toBe(0)
    const ev = await db.asPostgres((tx) => tx.query<{ source: string; payload: { reply_to: { channel: string; target: string } } }>("select source, payload from public.intake_events where id=$1", [first.event_id]))
    expect(ev.rows[0].source).toBe("im")
    expect(ev.rows[0].payload.reply_to).toEqual({ channel: "feishu", target: "oc_chat_1" })
    // the same id on another channel/connection is a different message
    await imCapture(wecomConn, "CHAT", "https://example.com/im1 企业落地的角度", "om_dup_1", "wecom")
    expect(await count("intake_events")).toBe(2)
  })

  it("auto_draft intent produces one queued content_draft job per document and records the reply target", async () => {
    const r = await imCapture(feishuConn, "oc_chat_2", "出稿 写成小红书 https://example.com/im2", "om_auto_1")
    expect(r.documents.map((d) => d.platform)).toEqual(["master", "xiaohongshu"])
    const jobs = await db.asPostgres((tx) => tx.query<{ status: string; job_type: string; created_by: string }>("select status, job_type, created_by from public.agent_jobs where id = any($1)", [r.documents.map((d) => d.job_id)]))
    expect(jobs.rows).toHaveLength(2)
    expect(jobs.rows.every((j) => j.status === "queued" && j.job_type === "content_draft" && j.created_by === org.members.owner)).toBe(true)
    expect(r.work_item_id).toBeTruthy()
    const ev = await db.asPostgres((tx) => tx.query<{ payload: { reply_to: { channel: string; target: string } } }>("select payload from public.intake_events where id=$1", [r.event_id]))
    expect(ev.rows[0].payload.reply_to).toEqual({ channel: "feishu", target: "oc_chat_2" })
    // duplicate delivery does not enqueue again
    await imCapture(feishuConn, "oc_chat_2", "出稿 写成小红书 https://example.com/im2", "om_auto_1")
    expect(await count("agent_jobs")).toBe(2)
  })

  it("im_notify_target resolves the originating conversation and is null for non-IM jobs", async () => {
    const r = await imCapture(feishuConn, "oc_chat_3", "出稿 https://example.com/im3", "om_auto_2")
    const t = await db.asServiceRole(async (tx) => (await tx.query<{ t: Record<string, unknown> | null }>("select public.im_notify_target($1) as t", [r.documents[0].job_id])).rows[0].t)
    expect(t).toMatchObject({ channel: "feishu", reply_target: "oc_chat_3", connection_id: feishuConn, job_id: r.documents[0].job_id, status: "queued", platform: "master", work_item_id: r.work_item_id })
    const web = await db.asUser(org.members.owner, async (tx) => (await tx.query<{ r: Cap }>("select public.quick_capture($1,null,'web idea','auto_draft','{}','web-im-0001') as r", [org.organizationId])).rows[0].r)
    const none = await db.asServiceRole(async (tx) => (await tx.query<{ t: unknown }>("select public.im_notify_target($1) as t", [web.documents[0].job_id])).rows[0].t)
    expect(none).toBeNull()
    // capture without a reply target has nowhere to notify
    const silent = await imCapture(feishuConn, null, "出稿 https://example.com/im4", "om_auto_3")
    expect(await db.asServiceRole(async (tx) => (await tx.query<{ t: unknown }>("select public.im_notify_target($1) as t", [silent.documents[0].job_id])).rows[0].t)).toBeNull()
  })

  it("rejects revoked, expired and non-IM connections, stops notifying for them; browser roles cannot call it", async () => {
    const revoked = await db.asPostgres(async (tx) => (await tx.query<{ id: string }>("insert into public.intake_connections(organization_id,created_by,name,adapter,token_hash,revoked_at) values($1,$2,'old','feishu',$3,now()) returning id", [org.organizationId, org.members.owner, hash("c")])).rows[0].id)
    await expect(imCapture(revoked, null, "https://example.com/r", "om_r1")).rejects.toThrow(/invalid_connection/)
    // a plain generic connection is not an IM bot
    const generic = await db.asPostgres(async (tx) => (await tx.query<{ id: string }>("insert into public.intake_connections(organization_id,created_by,name,adapter,token_hash) values($1,$2,'g','generic',$3) returning id", [org.organizationId, org.members.owner, hash("d")])).rows[0].id)
    await expect(imCapture(generic, null, "https://example.com/g", "om_g1")).rejects.toThrow(/invalid_connection/)
    // expired
    const pending = await imCapture(wecomConn, "CHAT2", "出稿 https://example.com/pending", "om_p1", "wecom")
    await db.asPostgres((tx) => tx.query("update public.intake_connections set expires_at = now() - interval '1 hour' where id=$1", [wecomConn]))
    expect(await db.asServiceRole(async (tx) => (await tx.query<{ t: unknown }>("select public.im_notify_target($1) as t", [pending.documents[0].job_id])).rows[0].t)).toBeNull()
    await expect(imCapture(wecomConn, null, "https://example.com/e", "om_e1", "wecom")).rejects.toThrow(/invalid_connection/)
    expect(await db.asServiceRole(async (tx) => (await tx.query<{ t: unknown }>("select public.im_notify_target(gen_random_uuid()) as t")).rows[0].t)).toBeNull()
    await expect(db.asUser(org.members.owner, (tx) => tx.query("select public.im_quick_capture($1,null,'{}'::jsonb)", [feishuConn]))).rejects.toThrow(/permission denied/)
    await expect(db.asUser(org.members.owner, (tx) => tx.query("select public.im_notify_target(gen_random_uuid())"))).rejects.toThrow(/permission denied/)
  })

  it("cross-org: another organization cannot see IM events", async () => {
    const other = await seedOrganization(db, { members: [{ role: "owner" }] })
    const seen = await db.asUser(other.members.owner, async (tx) => ({
      ev: (await tx.query("select 1 from public.intake_events")).rows.length,
      conn: (await tx.query("select 1 from public.intake_connections")).rows.length,
    }))
    expect(seen).toEqual({ ev: 0, conn: 0 })
  })
})
