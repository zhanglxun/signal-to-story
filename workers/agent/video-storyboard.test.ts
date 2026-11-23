// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { FakeLlmClient } from "../../sense-console/src/harness/llm"
import { createSupabaseTestDb, type SupabaseTestDb } from "../../testing/db/pglite-harness"
import { seedVideoWorkspace, type VideoWorkspace } from "../../testing/db/video-studio-seed"
import { SqlBackend } from "./backends/sql-backend"
import { processNextJob, type WorkerLogger } from "./runner"
import { DEMO_OUTLINE, demoStoryboardLlm, enqueueDemoStoryboard } from "./demo/video-demo-scenario"
import { createVideoStoryboardHandler, SqlVideoStoryboardStore, validateStoryboardOutput } from "./video-storyboard"

const silent: WorkerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

let db: SupabaseTestDb
let ws: VideoWorkspace
let backend: SqlBackend
let handler: ReturnType<typeof createVideoStoryboardHandler>

beforeEach(async () => {
  db = await createSupabaseTestDb()
  ws = await seedVideoWorkspace(db)
  backend = new SqlBackend((fn) => db.asServiceRole(fn))
  handler = createVideoStoryboardHandler(new SqlVideoStoryboardStore((fn) => db.asServiceRole(fn)))
})
afterEach(async () => {
  await db.close()
})

describe("video_storyboard worker (PGlite + fake LLM)", () => {
  it("invalid JSON schema → rewrite → the agent writes a draft plan directly; the job succeeds", async () => {
    const job = await enqueueDemoStoryboard(db, ws)
    const llm = demoStoryboardLlm()
    const result = await processNextJob({ backend, workerId: "w", generator: llm, evaluator: null, logger: silent, jobHandlers: { video_storyboard: handler } })
    expect(result.handlerOutcome).toMatchObject({ status: "succeeded", roundsExecuted: 2 })

    // SOP (from knowledge-base/ files) in the trusted system zone; outline only inside the untrusted zone.
    const [system, user] = llm.calls[0].messages
    expect(system.content).toContain("黄金前 3 秒 Hook")
    expect(system.content).not.toContain(DEMO_OUTLINE)
    expect(user.content).toContain(`<untrusted_source_data>\n${DEMO_OUTLINE}`)
    expect(llm.calls[1].messages[1].content).toContain("motion_mode")

    const seen = await db.asUser(ws.viewerId, async (tx) => ({
      steps: (await tx.query<{ round: number; step_kind: string; status: string }>("select (output->>'round')::int as round, case when kind = 'check' then output->>'stage' else kind end as step_kind, status from public.agent_job_steps where job_id=$1 order by seq", [job.id])).rows,
      plans: (await tx.query<{ id: string; status: string; revision: number; created_by: string }>("select id, status, revision, created_by from public.video_plans where organization_id=$1", [ws.organizationId])).rows,
      job: (await tx.query<{ status: string; plan_id: string }>("select status, result->>'plan_id' as plan_id from public.agent_jobs where id=$1", [job.id])).rows[0],
    }))
    expect(seen.steps.map((s) => `${s.round}:${s.step_kind}:${s.status}`)).toEqual([
      "0:context:succeeded", "1:generate:succeeded", "1:precheck:failed", "2:generate:succeeded", "2:precheck:succeeded", "2:persist:succeeded",
    ])
    expect(seen.plans).toHaveLength(1)
    expect(seen.plans[0]).toMatchObject({ id: seen.job.plan_id, status: "draft", revision: 1, created_by: ws.ownerId })
    expect(seen.job.status).toBe("succeeded")
    const shots = await db.asPostgres(async (tx) => (await tx.query("select id from public.video_shots where plan_id=$1", [seen.job.plan_id])).rows.length)
    expect(shots).toBe(4)

  })

  it("three invalid outputs → blocked_needs_human, no plan", async () => {
    const job = await enqueueDemoStoryboard(db, ws, "bad")
    const llm = new FakeLlmClient(() => "这不是 JSON")
    const result = await processNextJob({ backend, workerId: "w", generator: llm, evaluator: null, logger: silent, jobHandlers: { video_storyboard: handler } })
    expect(result.handlerOutcome).toMatchObject({ status: "blocked_needs_human" })
    expect(llm.calls).toHaveLength(3)
    const plans = await db.asPostgres((tx) => tx.query("select id from public.video_plans where organization_id=$1", [ws.organizationId]))
    expect(plans.rows).toHaveLength(0)
    expect((await db.asPostgres((tx) => tx.query<{ status: string }>("select status from public.agent_jobs where id=$1", [job.id]))).rows[0].status).toBe("blocked_needs_human")
  })

  it("validates output strictly", () => {
    expect(validateStoryboardOutput("{}").ok).toBe(false)
    expect(validateStoryboardOutput("not json").issues[0]).toContain("JSON")
  })
})
