// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createSupabaseTestDb, runSqlAcceptanceScript, seedOrganization, type SupabaseTestDb } from "../../../testing/db/pglite-harness"
import { createPlanWithShots, planRevision, seedVideoWorkspace, type VideoWorkspace } from "../../../testing/db/video-studio-seed"

let db: SupabaseTestDb
let ws: VideoWorkspace

beforeAll(async () => {
  db = await createSupabaseTestDb()
  ws = await seedVideoWorkspace(db)
}, 60_000)
afterAll(async () => {
  await db?.close()
})

const cancelQueued = () => db.asPostgres((tx) => tx.query("update public.agent_jobs set status='cancelled' where status='queued'"))

const enqueue = (userId: string, planId: string, jobType: string, shotId: string | null, approvalId: string | null = null, key: string | null = null) =>
  db.asUser(userId, async (tx) =>
    (await tx.query<{ id: string; status: string; payload: { server_estimate: { cost_cents: number; requires_approval: boolean } } }>(
      "select * from public.enqueue_video_job($1,$2,$3,$4,$5)", [planId, jobType, shotId, approvalId, key]
    )).rows[0]
  )

const requestApproval = (userId: string, planId: string, rerender: string[] = []) =>
  db.asUser(userId, async (tx) =>
    (await tx.query<{ id: string; status: string; estimated_cost_cents: number; target_revision: number }>(
      "select id, status, target_revision, (payload->>'estimated_cost_cents')::int as estimated_cost_cents from public.request_video_render_approval($1,$2)", [planId, rerender]
    )).rows[0]
  )

const decide = (userId: string, id: string, decision = "approved") =>
  db.asUser(userId, async (tx) => (await tx.query<{ status: string }>("select * from public.decide_approval_request($1,$2,$3)", [id, decision, decision === "rejected" ? "no" : ""])).rows[0])

describe("video studio schema (PGlite)", () => {
  it("isolates plans per organization via RLS and limits viewers to read", async () => {
    const { planId } = await createPlanWithShots(db, ws, [{}])
    const other = await seedOrganization(db, { members: [{ role: "owner" }] })
    const seenByOther = await db.asUser(other.members.owner, (tx) => tx.query("select id from public.video_plans where id=$1", [planId]))
    expect(seenByOther.rows).toHaveLength(0)
    const shotsByOther = await db.asUser(other.members.owner, (tx) => tx.query("select id from public.video_shots where plan_id=$1", [planId]))
    expect(shotsByOther.rows).toHaveLength(0)
    const seenByViewer = await db.asUser(ws.viewerId, (tx) => tx.query("select id from public.video_plans where id=$1", [planId]))
    expect(seenByViewer.rows).toHaveLength(1)
    await expect(db.asUser(ws.viewerId, (tx) => tx.query("update public.video_shots set narration='x' where plan_id=$1", [planId]))).resolves.toMatchObject({ affectedRows: 0 })
    await expect(db.asAnon((tx) => tx.query("select * from public.video_plans"))).rejects.toThrow()
    // Browser cannot write render state or the revision.
    await expect(db.asUser(ws.ownerId, (tx) => tx.query("update public.video_shots set render_status='rendered' where plan_id=$1", [planId]))).rejects.toThrow(/permission denied/)
    await expect(db.asUser(ws.ownerId, (tx) => tx.query("update public.video_plans set revision=99 where id=$1", [planId]))).rejects.toThrow(/permission denied/)
    // Worker cannot write content.
    await expect(db.asServiceRole((tx) => tx.query("update public.video_shots set narration='hack' where plan_id=$1", [planId]))).rejects.toThrow(/permission denied/)
  })

  it("bumps plan revision once per content statement, not for render state", async () => {
    const { planId, shotIds } = await createPlanWithShots(db, ws, [{}, {}, {}])
    expect(await planRevision(db, planId)).toBe(1)
    await db.asUser(ws.ownerId, (tx) => tx.query("update public.video_shots set narration='新台词' where id=$1", [shotIds[0]]))
    expect(await planRevision(db, planId)).toBe(2)
    const rev = await db.asUser(ws.ownerId, async (tx) => (await tx.query<{ r: number }>("select public.reorder_video_shots($1,$2) as r", [planId, [shotIds[2], shotIds[0], shotIds[1]]])).rows[0].r)
    expect(rev).toBe(3)
    await db.asUser(ws.ownerId, (tx) => tx.query("update public.video_plans set title='新标题' where id=$1", [planId]))
    expect(await planRevision(db, planId)).toBe(4)
    await db.asUser(ws.ownerId, (tx) => tx.query("delete from public.video_shots where id=$1", [shotIds[1]]))
    expect(await planRevision(db, planId)).toBe(5)
    await db.asServiceRole((tx) => tx.query("update public.video_shots set actual_duration_ms=3100 where id=$1", [shotIds[0]]))
    expect(await planRevision(db, planId)).toBe(5)
    // Illegal render state jumps are rejected even for the worker.
    await expect(db.asServiceRole((tx) => tx.query("update public.video_shots set render_status='rendered' where id=$1", [shotIds[0]]))).rejects.toThrow(/非法镜头渲染状态迁移/)
  })

  it("free local preview runs without approval; paid cloud render is rejected until a human approves", async () => {
    const { planId, shotIds } = await createPlanWithShots(db, ws, [{ motion_mode: "local_ken_burns" }, { motion_mode: "cloud_video_model", target_duration_ms: 4000 }])
    const free = await enqueue(ws.ownerId, planId, "video_shot_render", shotIds[0])
    expect(free.status).toBe("queued")
    expect(free.payload.server_estimate).toMatchObject({ cost_cents: 0, requires_approval: false })
    const tts = await enqueue(ws.ownerId, planId, "video_tts_preview", shotIds[1])
    expect(tts.status).toBe("queued")

    await expect(enqueue(ws.ownerId, planId, "video_shot_render", shotIds[1])).rejects.toThrow(/Mandate/)
    await expect(enqueue(ws.ownerId, planId, "video_compose", null)).rejects.toThrow(/Mandate/)
    // Direct enqueue_agent_job cannot lie about the payload either: the estimate is server side.
    await expect(db.asUser(ws.ownerId, (tx) => tx.query(
      "select public.enqueue_agent_job($1,'video_shot_render','direct-1',$2,'video_plan',$3,1,0,1,null)",
      [ws.organizationId, { shot_id: shotIds[1], server_estimate: { cost_cents: 0, requires_approval: false } }, planId]
    ))).rejects.toThrow(/Mandate/)

    const approval = await requestApproval(ws.ownerId, planId)
    expect(approval).toMatchObject({ status: "pending", estimated_cost_cents: 35, target_revision: 1 })
    await expect(enqueue(ws.ownerId, planId, "video_shot_render", shotIds[1], approval.id)).rejects.toThrow(/Mandate/)
    // member lacks agent.approve; service_role cannot decide at all.
    await expect(decide(ws.memberId, approval.id)).rejects.toThrow(/没有权限/)
    await expect(db.asServiceRole((tx) => tx.query("select public.decide_approval_request($1,'approved','')", [approval.id]))).rejects.toThrow()
    expect((await decide(ws.ownerId, approval.id)).status).toBe("approved")

    const paid = await enqueue(ws.ownerId, planId, "video_shot_render", shotIds[1], approval.id)
    expect(paid.status).toBe("queued")
    expect(paid.payload.server_estimate).toMatchObject({ cost_cents: 35, requires_approval: true })
    // Cap: a second paid job on the same approval would exceed the approved amount.
    await expect(enqueue(ws.ownerId, planId, "video_shot_render", shotIds[1], approval.id, "reroll-2")).rejects.toThrow(/超出已批准金额/)
    const shot = await db.asPostgres(async (tx) => (await tx.query<{ render_status: string }>("select render_status from public.video_shots where id=$1", [shotIds[1]])).rows[0])
    expect(shot.render_status).toBe("queued")
  })

  it("a revision change expires the approval; queued jobs are failed or parked at claim", async () => {
    await cancelQueued()
    const { planId, shotIds } = await createPlanWithShots(db, ws, [{ motion_mode: "cloud_video_model" }, { motion_mode: "local_ken_burns" }])
    const approval = await requestApproval(ws.ownerId, planId)
    await decide(ws.ownerId, approval.id)
    const paid = await enqueue(ws.ownerId, planId, "video_shot_render", shotIds[0], approval.id)
    const free = await enqueue(ws.ownerId, planId, "video_shot_render", shotIds[1])
    await db.asUser(ws.ownerId, (tx) => tx.query("update public.video_shots set narration='改了台词' where id=$1", [shotIds[1]]))
    const status = await db.asPostgres(async (tx) => (await tx.query<{ status: string }>("select status from public.approval_requests where id=$1", [approval.id])).rows[0].status)
    expect(status).toBe("expired")
    await expect(enqueue(ws.ownerId, planId, "video_shot_render", shotIds[0], approval.id, "after-edit")).rejects.toThrow()

    const claimed = await db.asServiceRole(async (tx) => (await tx.query("select * from public.claim_agent_job($1,$2)", [["video_shot_render"], 60])).rows)
    expect(claimed).toHaveLength(0)
    const jobs = await db.asPostgres(async (tx) => (await tx.query<{ id: string; status: string; error_code: string }>("select id, status, error_code from public.agent_jobs where id = any($1)", [[paid.id, free.id]])).rows)
    expect(jobs.find((j) => j.id === paid.id)).toMatchObject({ status: "failed", error_code: "stale_target" })
    expect(jobs.find((j) => j.id === free.id)).toMatchObject({ status: "failed", error_code: "stale_target" })
    const shots = await db.asPostgres(async (tx) => (await tx.query<{ render_status: string }>("select render_status from public.video_shots where plan_id=$1 order by position", [planId])).rows)
    expect(shots.map((s) => s.render_status)).toEqual(["failed", "pending"])
  })

  it("locks shot edits while rendering; the approved estimate lives in the approval payload", async () => {
    await cancelQueued()
    const { planId, shotIds } = await createPlanWithShots(db, ws, [{ motion_mode: "cloud_video_model" }, {}])
    const approval = await requestApproval(ws.ownerId, planId)
    expect(approval.estimated_cost_cents).toBe(35)
    await decide(ws.ownerId, approval.id)
    const job = await enqueue(ws.ownerId, planId, "video_shot_render", shotIds[0], approval.id)
    const claimed = await db.asServiceRole(async (tx) => (await tx.query<{ id: string; lease_epoch: number }>("select * from public.claim_agent_job($1,$2)", [["video_shot_render"], 60])).rows)
    expect(claimed[0].id).toBe(job.id)
    await db.asServiceRole((tx) => tx.query("update public.video_shots set render_status='rendering' where id=$1", [shotIds[0]]))
    await expect(db.asUser(ws.ownerId, (tx) => tx.query("update public.video_shots set narration='锁定中' where id=$1", [shotIds[1]]))).rejects.toThrow(/锁定/)
    await db.asServiceRole(async (tx) => {
      await tx.query("update public.video_shots set render_status='rendered' where id=$1", [shotIds[0]])
      await tx.query(`select public.complete_agent_job($1,$2,'succeeded','{"cost_cents":35}'::jsonb,null,null)`, [job.id, claimed[0].lease_epoch])
    })
    // No ledger: the actual cost is in the job result; the shot carries only render state.
    const view = await db.asUser(ws.viewerId, async (tx) => ({
      job: (await tx.query<{ cost: string }>("select result->>'cost_cents' as cost from public.agent_jobs where id=$1", [job.id])).rows[0],
      shot: (await tx.query<Record<string, unknown>>("select * from public.video_shots where id=$1", [shotIds[0]])).rows[0],
    }))
    expect(Number(view.job.cost)).toBe(35)
    expect(view.shot.render_status).toBe("rendered")
    expect(view.shot).not.toHaveProperty("actual_cost_cents")
    // Unlocked again.
    await db.asUser(ws.ownerId, (tx) => tx.query("update public.video_shots set narration='解锁' where id=$1", [shotIds[1]]))
  })

  it("the storyboard job writes a draft plan directly, once, on its own card", async () => {
    const card = await db.asUser(ws.memberId, async (tx) => (await tx.query<{ id: string }>("insert into public.work_items(organization_id,kind,title) values ($1,'video','月球面包店') returning id", [ws.organizationId])).rows[0].id)
    const job = await db.asUser(ws.memberId, async (tx) => (await tx.query<{ id: string; kind: string; work_item_id: string }>(
      "select * from public.enqueue_video_storyboard_job($1,$2,$3,$4)", [ws.organizationId, "一只猫在月球上开面包店的 30 秒故事。", { target_seconds: 20 }, card]
    )).rows[0])
    expect(job).toMatchObject({ kind: "video_storyboard", work_item_id: card })
    const draft = { schema_version: 1, title: "月球面包店", aspect_ratio: "9:16", target_seconds: 20, shots: [{ narration: "月球上飘来面包香！", target_duration_ms: 3000 }, { narration: "猫店长开张了。", motion_mode: "cloud_video_model" }] }
    // Service role still cannot insert plans directly; it can only go through write_video_draft for a running job.
    await expect(db.asServiceRole((tx) => tx.query("insert into public.video_plans(organization_id,title,created_by) values ($1,'x',$2)", [ws.organizationId, ws.ownerId]))).rejects.toThrow(/permission denied/)
    await expect(db.asServiceRole((tx) => tx.query("select public.write_video_draft($1,1,$2)", [job.id, draft]))).rejects.toThrow(/未在运行/)
    const epoch = await db.asServiceRole(async (tx) => (await tx.query<{ lease_epoch: number }>("select * from public.claim_agent_job(array['video_storyboard'], 60)")).rows[0].lease_epoch)
    await expect(db.asServiceRole((tx) => tx.query("select public.write_video_draft($1,$2,$3)", [job.id, Number(epoch) + 1, draft]))).rejects.toThrow(/租约/)
    const planId = await db.asServiceRole(async (tx) => (await tx.query<{ id: string }>("select public.write_video_draft($1,$2,$3) as id", [job.id, epoch, draft])).rows[0].id)
    const again = await db.asServiceRole(async (tx) => {
      const epoch = (await tx.query<{ lease_epoch: number }>("select lease_epoch from public.agent_jobs where id=$1", [job.id])).rows[0].lease_epoch
      return (await tx.query<{ id: string }>("select public.write_video_draft($1,$2,$3) as id", [job.id, epoch, draft])).rows[0].id
    })
    expect(again).toBe(planId) // idempotent per job
    const state = await db.asUser(ws.viewerId, async (tx) => ({
      plan: (await tx.query<{ revision: number; title: string; status: string; work_item_id: string; created_by: string }>("select revision, title, status, work_item_id, created_by from public.video_plans where id=$1", [planId])).rows[0],
      shots: (await tx.query<{ position: number; motion_mode: string }>("select position, motion_mode from public.video_shots where plan_id=$1 order by position", [planId])).rows,
      job: (await tx.query<{ plan_id: string }>("select result->>'plan_id' as plan_id from public.agent_jobs where id=$1", [job.id])).rows[0],
    }))
    expect(state.plan).toEqual({ revision: 1, title: "月球面包店", status: "draft", work_item_id: card, created_by: ws.memberId })
    expect(state.shots.map((s) => s.motion_mode)).toEqual(["local_ken_burns", "cloud_video_model"])
    expect(state.job.plan_id).toBe(planId)
  })

  it("SQL acceptance script passes", async () => {
    const rows = await runSqlAcceptanceScript(db, "video_studio.sql")
    expect(rows.at(-1)).toMatchObject({ result: "video_studio ok" })
  })
})
