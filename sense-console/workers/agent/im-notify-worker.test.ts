// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createSupabaseTestDb, type SupabaseTestDb } from "../../src/test/db/pglite-harness"
import { SqlBackend } from "./backends/sql-backend"
import { demoEvaluatorAlwaysPass, demoGenerator, enqueueDemoJob, seedDemoWorkspace, type DemoWorkspace } from "./demo-scenario"
import { processNextJob, type WorkerLogger } from "./runner"

const silent: WorkerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }
let db: SupabaseTestDb
let ws: DemoWorkspace
let backend: SqlBackend

beforeEach(async () => {
  db = await createSupabaseTestDb()
  ws = await seedDemoWorkspace(db)
  backend = new SqlBackend((fn) => db.asServiceRole(fn))
})
afterEach(async () => {
  await db.close()
})

const configured = { FEISHU_APP_ID: "id", FEISHU_APP_SECRET: "secret" }

describe("worker IM notification hook", () => {
  it("calls im_notify_target once when the job reaches pending_review", async () => {
    const job = await enqueueDemoJob(db, ws)
    const rpc = vi.spyOn(backend, "rpc")
    const r = await processNextJob({ backend, workerId: "w", generator: demoGenerator(), evaluator: demoEvaluatorAlwaysPass(), logger: silent, notifyEnv: configured })
    expect(r.outcome?.status).toBe("pending_review")
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("im_notify_target", { p_job_id: job.id })
  })

  it("is a no-op without push credentials", async () => {
    await enqueueDemoJob(db, ws)
    const rpc = vi.spyOn(backend, "rpc")
    const r = await processNextJob({ backend, workerId: "w", generator: demoGenerator(), evaluator: demoEvaluatorAlwaysPass(), logger: silent, notifyEnv: {} })
    expect(r.outcome?.status).toBe("pending_review")
    expect(rpc).not.toHaveBeenCalled()
  })

  it("does not change the job result when notification throws", async () => {
    const job = await enqueueDemoJob(db, ws)
    vi.spyOn(backend, "rpc").mockRejectedValue(new Error("boom"))
    const r = await processNextJob({ backend, workerId: "w", generator: demoGenerator(), evaluator: demoEvaluatorAlwaysPass(), logger: silent, notifyEnv: configured })
    expect(r.error).toBeUndefined()
    expect(r.outcome?.status).toBe("pending_review")
    const row = await db.asPostgres(async (tx) => (await tx.query<{ status: string }>("select status from public.agent_jobs where id=$1", [job.id])).rows[0])
    expect(row.status).toBe("pending_review")
  })
})
