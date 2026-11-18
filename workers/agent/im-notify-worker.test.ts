// @vitest-environment node
// The polling notifier against the real schema: list_pending_notices → send → mark_notice_sent (notified_at).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createSupabaseTestDb, type SupabaseTestDb } from "../../testing/db/pglite-harness"
import { SqlBackend } from "./backends/sql-backend"
import { demoEvaluatorAlwaysFail, demoEvaluatorAlwaysPass, demoGenerator, enqueueDemoJob, seedDemoWorkspace, type DemoWorkspace } from "./demo/demo-scenario"
import { pollNotices, processNextJob, type WorkerLogger } from "./runner"

const silent: WorkerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }
const env = { FEISHU_APP_ID: "id", FEISHU_APP_SECRET: "secret", CONSOLE_BASE_URL: "https://story.test" }
let db: SupabaseTestDb
let ws: DemoWorkspace
let backend: SqlBackend

beforeEach(async () => {
  db = await createSupabaseTestDb()
  ws = await seedDemoWorkspace(db)
  backend = new SqlBackend((fn) => db.asServiceRole(fn))
  // The card also received an input from a Feishu chat: notices for its jobs go back there.
  await db.asPostgres(async (tx) => {
    const conn = await tx.query<{ id: string }>(
      "insert into public.intake_connections(organization_id,created_by,name,adapter,token_hash) values($1,$2,'feishu bot','feishu',$3) returning id",
      [ws.organizationId, ws.ownerId, "f".repeat(64)]
    )
    const item = await tx.query<{ work_item_id: string }>("select work_item_id from public.content_documents where id=$1", [ws.documentId])
    await tx.query(
      "insert into public.intake_events(organization_id,source,connection_id,external_id,text,payload,work_item_id) values($1,'im',$2,'om_1','补充一句',$3,$4)",
      [ws.organizationId, conn.rows[0].id, { reply_to: { channel: "feishu", target: "oc_chat" } }, item.rows[0].work_item_id]
    )
  })
})
afterEach(async () => {
  await db.close()
})

const okFetch = () =>
  vi.fn(async (u: string, _i: { method: string; headers: Record<string, string>; body: string }) => {
    void _i
    return { ok: true, status: 200, json: async () => (u.includes("tenant_access") ? { code: 0, tenant_access_token: "t", expire: 7200 } : { code: 0 }) }
  })
const notifiedAt = async (jobId: string) =>
  (await db.asPostgres((tx) => tx.query<{ notified_at: string | null }>("select notified_at from public.agent_jobs where id=$1", [jobId]))).rows[0].notified_at

describe("polling notifier (notified_at, no outbox)", () => {
  it("does not notify inline; the poll sends once, marks, and a failed send is retried on the next poll", async () => {
    const job = await enqueueDemoJob(db, ws)
    const rpc = vi.spyOn(backend, "rpc")
    const r = await processNextJob({ backend, workerId: "w", generator: demoGenerator(), evaluator: demoEvaluatorAlwaysPass(), logger: silent })
    expect(r.outcome?.status).toBe("pending_review")
    expect(rpc).not.toHaveBeenCalled()

    const failing = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const failed = await pollNotices({ backend, logger: silent, notifyEnv: env, notifyFetch: failing })
    expect(failed).toEqual([{ id: job.id, kind: "job", result: "failed", reason: "delivery_failed" }])
    expect(await notifiedAt(job.id)).toBeNull()

    const f = okFetch()
    const sent = await pollNotices({ backend, logger: silent, notifyEnv: env, notifyFetch: f })
    expect(sent).toEqual([{ id: job.id, kind: "job", result: "sent", reason: undefined }])
    const card = JSON.stringify(JSON.parse(JSON.parse(f.mock.calls[1][1].body).content))
    expect(JSON.parse(f.mock.calls[1][1].body).receive_id).toBe("oc_chat")
    expect(card).toContain("https://story.test/work-items/")
    expect(card).toContain("评估轮数：1/3")
    expect(await notifiedAt(job.id)).not.toBeNull()
    expect(await pollNotices({ backend, logger: silent, notifyEnv: env, notifyFetch: okFetch() })).toEqual([])
  })

  it("a new state needs a new notice: resume clears notified_at, the next block is announced again", async () => {
    const job = await enqueueDemoJob(db, ws, "block-1")
    await processNextJob({ backend, workerId: "w", generator: demoGenerator(), evaluator: demoEvaluatorAlwaysFail(), logger: silent })
    expect((await pollNotices({ backend, logger: silent, notifyEnv: env, notifyFetch: okFetch() })).map((n) => n.result)).toEqual(["sent"])
    await db.asUser(ws.ownerId, (tx) => tx.query("select public.resume_agent_job($1,1,0)", [job.id]))
    expect(await notifiedAt(job.id)).toBeNull()
    expect(await pollNotices({ backend, logger: silent, notifyEnv: env, notifyFetch: okFetch() })).toEqual([]) // queued: nothing to say
    await processNextJob({ backend, workerId: "w", generator: demoGenerator(), evaluator: demoEvaluatorAlwaysFail(), logger: silent })
    expect((await pollNotices({ backend, logger: silent, notifyEnv: env, notifyFetch: okFetch() })).map((n) => [n.id, n.result])).toEqual([[job.id, "sent"]])
  })

  it("announces pending approvals and agent questions; notices without an IM target are marked without sending", async () => {
    const job = await enqueueDemoJob(db, ws, "q-1")
    const claimed = await backend.claim(["content_draft"], 60)
    const approval = await db.asUser(ws.ownerId, async (tx) =>
      (await tx.query<{ id: string }>("select (a).id from (select public.create_approval_request($1,'publish_site','content_document',$2,1,'发布到读者站') a) s", [ws.organizationId, ws.documentId])).rows[0].id
    )
    const question = await db.asServiceRole(async (tx) =>
      (await tx.query<{ id: string }>(`select (a).id from (select public.ask_question($1,'{"title":"用哪个角度？"}'::jsonb,$2) a) s`, [job.id, claimed!.lease_epoch])).rows[0].id
    )
    const f = okFetch()
    const out = await pollNotices({ backend, logger: silent, notifyEnv: env, notifyFetch: f })
    // the parked job is not announced twice: its question carries the notice
    expect(out.map((n) => [n.kind, n.id, n.result]).sort()).toEqual([["approval", approval, "sent"], ["question", question, "sent"]].sort())
    expect(await pollNotices({ backend, logger: silent, notifyEnv: {}, notifyFetch: f })).toEqual([])
    // no IM connection configured on this node: the notice is marked, nothing is sent
    const other = await enqueueDemoJob(db, ws, "fail-1")
    await db.asPostgres(async (tx) => {
      await tx.query("update public.agent_jobs set status='running' where id=$1", [other.id])
      await tx.query("update public.agent_jobs set status='failed', error='x' where id=$1", [other.id])
    })
    const calls = f.mock.calls.length
    expect(await pollNotices({ backend, logger: silent, notifyEnv: {}, notifyFetch: f })).toEqual([{ id: other.id, kind: "job", result: "skipped", reason: "feishu_unavailable" }])
    expect(f.mock.calls.length).toBe(calls)
    expect(await notifiedAt(other.id)).not.toBeNull()
  })
})
