// @vitest-environment node
// DB2c-2: the worker runs on a node token + publishable key (anon role) only. Same loop, node_* RPCs underneath.
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createSupabaseTestDb, type SupabaseTestDb } from "../../testing/db/pglite-harness"
import { NodeBackend, sqlRpc } from "./backends/node-backend"
import { demoEvaluatorFailThenPass, demoGenerator, enqueueDemoJob, seedDemoWorkspace, type DemoWorkspace } from "./demo/demo-scenario"
import { runNotifierOnce } from "./notify/im-notify"
import { processNextJob, type WorkerLogger } from "./runner"

const silent: WorkerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

let db: SupabaseTestDb
let ws: DemoWorkspace

async function createNode(name = "测试节点") {
  return db.asUser(ws.ownerId, async (tx) =>
    (await tx.query<{ r: { id: string; token: string } }>("select public.create_runner_node($1, $2) as r", [ws.organizationId, name])).rows[0].r)
}
const anonRpc = () => sqlRpc((fn) => db.asAnon(fn))

beforeEach(async () => {
  db = await createSupabaseTestDb()
  ws = await seedDemoWorkspace(db)
})
afterEach(async () => {
  await db.close()
})

describe("agent worker on a node token (DB2c-2)", () => {
  it("runs a content_draft job end to end through node_* RPCs as anon", async () => {
    const node = await createNode()
    const backend = new NodeBackend(anonRpc(), node.token)
    const job = await enqueueDemoJob(db, ws)

    const generator = demoGenerator()
    const result = await processNextJob({ backend, workerId: "node-1", generator, evaluator: demoEvaluatorFailThenPass(), logger: silent })
    expect(result.outcome?.status).toBe("pending_review")

    const seen = await db.asPostgres(async (tx) => ({
      job: (await tx.query<{ status: string; lease_epoch: string }>("select status, lease_epoch::text from public.agent_jobs where id=$1", [job.id])).rows[0],
      steps: (await tx.query<{ kind: string }>("select kind from public.agent_job_steps where job_id=$1 order by seq", [job.id])).rows.map((r) => r.kind),
      proposals: (await tx.query<{ agent_job_id: string; prompt_version: string }>("select agent_job_id, prompt_version from public.content_ai_proposals where document_id=$1", [ws.documentId])).rows,
      node: (await tx.query<{ last_seen_at: string | null }>("select last_seen_at from public.runner_nodes where id=$1", [node.id])).rows[0],
    }))
    expect(seen.job).toEqual({ status: "pending_review", lease_epoch: "1" })
    expect(seen.steps).toEqual(["context", "generate", "check", "check", "generate", "check", "check", "persist"])
    expect(seen.proposals).toEqual([{ agent_job_id: job.id, prompt_version: "harness-v1" }])
    expect(seen.node.last_seen_at).not.toBeNull()
    // The Context Pack came through node_draft_context: trusted knowledge and the card's source are in.
    expect(generator.calls[0].messages[0].content).toContain("克制、专业、讲真话")
  })

  it("a revoked node cannot claim; the job waits for another node", async () => {
    const node = await createNode()
    await db.asUser(ws.ownerId, (tx) => tx.query("select public.revoke_runner_node($1)", [node.id]))
    await enqueueDemoJob(db, ws)
    const backend = new NodeBackend(anonRpc(), node.token)
    await expect(backend.claim(["content_draft"], 120)).rejects.toThrow(/令牌无效或已吊销/)
  })

  it("the notifier only sees and marks its own organization's notices", async () => {
    const node = await createNode()
    const backend = new NodeBackend(anonRpc(), node.token)
    await enqueueDemoJob(db, ws)
    await processNextJob({ backend, workerId: "node-1", generator: demoGenerator(), evaluator: demoEvaluatorFailThenPass(), logger: silent })

    const outcomes = await runNotifierOnce({ rpc: (fn, args) => backend.rpc(fn, args), env: {}, log: () => undefined })
    expect(outcomes.map((o) => o.result)).toEqual(["skipped"]) // web job: no IM target, marked without sending
    const again = await runNotifierOnce({ rpc: (fn, args) => backend.rpc(fn, args), env: {}, log: () => undefined })
    expect(again).toEqual([])
    // Anything else through the passthrough is refused.
    expect((await backend.rpc("claim_agent_job", {})).error?.message).toMatch(/节点不能调用/)
  })
})
