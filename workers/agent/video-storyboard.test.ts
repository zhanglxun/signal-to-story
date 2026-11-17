// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { FakeLlmClient } from "../../sense-console/src/harness/llm"
import { createSupabaseTestDb, type SupabaseTestDb } from "../../testing/db/pglite-harness"
import { seedVideoWorkspace, type VideoWorkspace } from "../../testing/db/video-studio-seed"
import { SqlBackend } from "./backends/sql-backend"
import { processNextJob, type WorkerLogger } from "./runner"
import { DEMO_OUTLINE, demoStoryboardLlm, enqueueDemoStoryboard, seedTrustedVideoSop } from "./demo/video-demo-scenario"
import { createVideoStoryboardHandler, SqlVideoStoryboardStore, validateStoryboardOutput } from "./video-storyboard"

const silent: WorkerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

let db: SupabaseTestDb
let ws: VideoWorkspace
let backend: SqlBackend
let handler: ReturnType<typeof createVideoStoryboardHandler>

beforeEach(async () => {
  db = await createSupabaseTestDb()
  ws = await seedVideoWorkspace(db)
  await seedTrustedVideoSop(db, ws)
  backend = new SqlBackend((fn) => db.asServiceRole(fn))
  handler = createVideoStoryboardHandler(new SqlVideoStoryboardStore((fn) => db.asServiceRole(fn)))
})
afterEach(async () => {
  await db.close()
})

describe("video_storyboard worker (PGlite + fake LLM)", () => {
  it("invalid JSON schema → rewrite → proposal + pending_review; adoption by a human creates the plan", async () => {
    const job = await enqueueDemoStoryboard(db, ws)
    const llm = demoStoryboardLlm()
    const result = await processNextJob({ backend, workerId: "w", generator: llm, evaluator: null, logger: silent, jobHandlers: { video_storyboard: handler } })
    expect(result.handlerOutcome).toMatchObject({ status: "pending_review", roundsExecuted: 2 })

    // SOP in the trusted system zone; outline only inside the untrusted zone.
    const [system, user] = llm.calls[0].messages
    expect(system.content).toContain("黄金前 3 秒 Hook")
    expect(system.content).not.toContain(DEMO_OUTLINE)
    expect(user.content).toContain(`<untrusted_source_data>\n${DEMO_OUTLINE}`)
    expect(llm.calls[1].messages[1].content).toContain("motion_mode")

    const seen = await db.asUser(ws.viewerId, async (tx) => ({
      steps: (await tx.query<{ round: number; step_kind: string; status: string }>("select round, step_kind, status from public.agent_job_steps where job_id=$1 order by round, created_at", [job.id])).rows,
      proposals: (await tx.query<{ id: string; status: string; proposal: { shots: unknown[] } }>("select * from public.video_storyboard_proposals where agent_job_id=$1", [job.id])).rows,
      plans: (await tx.query("select id from public.video_plans where organization_id=$1", [ws.organizationId])).rows,
      job: (await tx.query<{ status: string; cost_cents: string }>("select status, cost_cents from public.agent_jobs where id=$1", [job.id])).rows[0],
    }))
    expect(seen.steps.map((s) => `${s.round}:${s.step_kind}:${s.status}`)).toEqual([
      "0:context:succeeded", "1:generate:succeeded", "1:precheck:failed", "2:generate:succeeded", "2:precheck:succeeded", "2:persist:succeeded",
    ])
    expect(seen.proposals).toHaveLength(1)
    expect(seen.proposals[0].proposal.shots).toHaveLength(4)
    expect(seen.plans).toHaveLength(0) // agent never writes formal tables
    expect(seen.job.status).toBe("pending_review")

    const planId = await db.asUser(ws.ownerId, async (tx) => (await tx.query<{ id: string }>("select public.accept_video_storyboard_proposal($1) as id", [seen.proposals[0].id])).rows[0].id)
    const plan = await db.asPostgres(async (tx) => ({
      shots: (await tx.query("select id from public.video_shots where plan_id=$1", [planId])).rows.length,
      ledger: (await tx.query<{ kind: string; actual_cents: string }>("select kind, actual_cents from public.video_cost_entries where plan_id=$1", [planId])).rows,
    }))
    expect(plan.shots).toBe(4)
    expect(plan.ledger).toEqual([{ kind: "storyboard_llm", actual_cents: "0.6000" }])
  })

  it("three invalid outputs → blocked_needs_human, no proposal", async () => {
    const job = await enqueueDemoStoryboard(db, ws, "bad")
    const llm = new FakeLlmClient(() => "这不是 JSON")
    const result = await processNextJob({ backend, workerId: "w", generator: llm, evaluator: null, logger: silent, jobHandlers: { video_storyboard: handler } })
    expect(result.handlerOutcome).toMatchObject({ status: "blocked_needs_human" })
    expect(llm.calls).toHaveLength(3)
    const proposals = await db.asPostgres((tx) => tx.query("select id from public.video_storyboard_proposals where agent_job_id=$1", [job.id]))
    expect(proposals.rows).toHaveLength(0)
  })

  it("validates output strictly", () => {
    expect(validateStoryboardOutput("{}").ok).toBe(false)
    expect(validateStoryboardOutput("not json").issues[0]).toContain("JSON")
  })
})
