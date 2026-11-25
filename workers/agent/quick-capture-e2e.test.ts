// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createSupabaseTestDb, type SupabaseTestDb } from "../../testing/db/pglite-harness"
import { drainQueue, FAKE_ARTICLE, fakeFetcher, quickCapture, seedCaptureWorkspace } from "./demo/capture-scenario"
import { demoEvaluatorFailThenPass, demoGenerator } from "./demo/demo-scenario"
import type { SourceFetcher } from "./fetch-source"
import type { WorkerLogger } from "./runner"

const silent: WorkerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

let db: SupabaseTestDb
let ws: Awaited<ReturnType<typeof seedCaptureWorkspace>>

beforeEach(async () => {
  db = await createSupabaseTestDb()
  ws = await seedCaptureWorkspace(db)
})
afterEach(async () => {
  await db.close()
})

describe("quick capture -> auto draft -> pending_review (PGlite + fake LLM)", () => {
  it("one link writes evaluated v2 drafts directly into every document", async () => {
    const capture = await quickCapture(db, ws.ownerId, {
      organizationId: ws.organizationId, url: "https://example.com/optogenetics", note: "从因果研究工具的角度讲，别写成读心术",
      intent: "auto_draft", platforms: ["wechat_official"], key: "e2e-capture-0001",
    })
    expect(capture.documents.map((d) => d.platform)).toEqual(["master", "wechat_official"])

    const generator = demoGenerator()
    const results = await drainQueue(db, { generator, evaluator: demoEvaluatorFailThenPass(), fetchSource: fakeFetcher, logger: silent })
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.outcome?.status === "pending_review")).toBe(true)

    const seen = await db.asUser(ws.viewerId, async (tx) => {
      const jobs = await tx.query<{ id: string; status: string; target_id: string; result: Record<string, unknown> }>(
        "select id, status, payload->'target'->>'id' as target_id, result from public.agent_jobs where payload->>'intake_event_id'=$1", [capture.event_id])
      const steps = await tx.query<{ job_id: string; round: number; step_kind: string; status: string; evaluation: { criteria?: unknown[] } | null }>(
        "select job_id, (output->>'round')::int as round, case when kind = 'check' then output->>'stage' else kind end as step_kind, status, output->'evaluation' as evaluation from public.agent_job_steps where job_id = any($1) order by job_id, seq", [jobs.rows.map((j) => j.id)])
      const docs = await tx.query<{ id: string; platform: string; revision: number; status: string; body: string }>(
        "select id, platform, revision, status, body from public.content_documents where work_item_id=$1", [capture.work_item_id])
      return { jobs: jobs.rows, steps: steps.rows, docs: docs.rows }
    })
    expect(seen.jobs.every((j) => j.status === "pending_review" && j.result?.written_revision === 2)).toBe(true)
    expect(seen.docs).toHaveLength(2)
    expect(seen.docs.every((d) => d.revision === 2 && d.status === "draft" && d.body.length > 50)).toBe(true)
    for (const job of seen.jobs) {
      const kinds = seen.steps.filter((s) => s.job_id === job.id).map((s) => `${s.round}:${s.step_kind}:${s.status}`)
      expect(kinds).toContain("0:fetch:succeeded")
      expect(kinds).toContain("0:context:succeeded")
      expect(kinds.filter((k) => k.endsWith(":evaluate:failed")).length + kinds.filter((k) => k.endsWith(":evaluate:succeeded")).length).toBeGreaterThanOrEqual(1)
      expect(kinds.at(-1)).toMatch(/:persist:succeeded$/)
    }
    expect(seen.steps.filter((s) => s.step_kind === "evaluate").every((s) => Array.isArray(s.evaluation?.criteria))).toBe(true)

    // Fetched page text sits in the untrusted zone, never in the system prompt.
    const [system, user] = generator.calls[0].messages
    expect(user.content).toContain("研究者用光控制特定神经元")
    expect(system.content).not.toContain("Ignore previous instructions")
    expect(user.content).toContain("从因果研究工具的角度讲")
  })

  it("a failed fetch is recorded and drafting continues from the note only", async () => {
    const failing: SourceFetcher = async (url) => ({ ok: false, url, code: "blocked_address", error: "域名解析到内网" })
    const capture = await quickCapture(db, ws.ownerId, {
      organizationId: ws.organizationId, url: "https://intranet.example/x", note: "备注", intent: "auto_draft", platforms: [], key: "e2e-capture-0002",
    })
    const generator = demoGenerator()
    const [result] = await drainQueue(db, { generator, evaluator: demoEvaluatorFailThenPass(), fetchSource: failing, logger: silent })
    expect(result.outcome?.status).toBe("pending_review")
    const fetchStep = await db.asPostgres((tx) =>
      tx.query<{ status: string; error: string }>("select status, error from public.agent_job_steps where job_id=$1 and kind='fetch'", [capture.documents[0].job_id]))
    expect(fetchStep.rows[0]).toMatchObject({ status: "failed" })
    expect(fetchStep.rows[0].error).toMatch(/blocked_address/)
    expect(generator.calls[0].messages[1].content).not.toContain(FAKE_ARTICLE.text)
  })

  it("capture_only enqueues nothing", async () => {
    await quickCapture(db, ws.ownerId, { organizationId: ws.organizationId, url: null, note: "只是个想法", intent: "capture_only", platforms: [], key: "e2e-capture-0003" })
    expect(await drainQueue(db, { generator: demoGenerator(), evaluator: null, logger: silent })).toHaveLength(0)
  })
})
