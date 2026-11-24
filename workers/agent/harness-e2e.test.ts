// @vitest-environment node
import { EventEmitter } from "node:events"
import { writeFileSync } from "node:fs"
import type { spawn } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { FakeLlmClient, LlmCallError } from "./loop/llm"
import { createSupabaseTestDb, type SupabaseTestDb } from "../../testing/db/pglite-harness"
import { SqlBackend } from "./backends/sql-backend"
import { buildChildEnv, CliLlmClient } from "./drivers/cli-driver"
import { CloudLlmClient } from "./drivers/cloud-llm"
import { demoEvaluatorAlwaysFail, demoEvaluatorAlwaysPass, demoEvaluatorFailThenPass, demoGenerator, enqueueDemoJob, readJobUsage, seedDemoWorkspace, type DemoWorkspace } from "./demo/demo-scenario"
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

/** Job row plus the progress derived from its steps (the job row no longer stores rounds / hops). */
const jobRow = (id: string) =>
  db.asPostgres(async (tx) => {
    const row = (await tx.query<{ status: string; error_code: string | null; attempts: number; result: Record<string, unknown> | null }>("select * from public.agent_jobs where id=$1", [id])).rows[0]
    const usage = (await readJobUsage(tx, [id]))[id]
    return { ...row, rounds: usage.rounds, hops_used: usage.hops }
  })

describe("agent worker end to end (PGlite + fake LLM)", () => {
  it("enqueue -> claim -> generate -> evaluate fails -> rewrite -> pass -> direct draft v2 + pending_review", async () => {
    const job = await enqueueDemoJob(db, ws)
    const again = await enqueueDemoJob(db, ws)
    expect(again.id).toBe(job.id)

    const generator = demoGenerator()
    const result = await processNextJob({ backend, workerId: "w1", generator, evaluator: demoEvaluatorFailThenPass(), logger: silent })
    expect(result.outcome?.status).toBe("pending_review")
    expect(result.outcome?.writtenRevision).toBe(2)

    const row = await jobRow(job.id)
    expect(row).toMatchObject({ status: "pending_review", rounds: 2, hops_used: 4, result: { written_revision: 2, written_document_id: ws.documentId } })

    // Steps and updated draft v2 are visible to the human through RLS.
    const seen = await db.asUser(ws.ownerId, async (tx) => {
      const steps = await tx.query<{ seq: number; round: number; step_kind: string; status: string }>(
        "select seq, (output->>'round')::int as round, case when kind = 'check' then output->>'stage' else kind end as step_kind, status from public.agent_job_steps where job_id=$1 order by seq", [job.id])
      const doc = await tx.query<{ body: string; revision: number; status: string }>("select body, revision, status from public.content_documents where id=$1", [ws.documentId])
      return { steps: steps.rows, doc: doc.rows[0] }
    })
    expect(seen.steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(seen.steps.map((s) => `${s.round}:${s.step_kind}:${s.status}`)).toEqual([
      "0:context:succeeded",
      "1:generate:succeeded",
      "1:precheck:succeeded",
      "1:evaluate:failed",
      "2:generate:succeeded",
      "2:precheck:succeeded",
      "2:evaluate:succeeded",
      "2:persist:succeeded",
    ])
    expect(seen.doc.revision).toBe(2)
    expect(seen.doc.status).toBe("draft")
    expect(seen.doc.body).toContain("光遗传学是一种用光控制特定神经元活动的研究工具")

    // Context Pack zoning as seen by the generator.
    const [system, user] = generator.calls[0].messages
    // Trusted knowledge comes from the repository's knowledge-base/ files (no knowledge table, database.md §3).
    expect(system.content).toContain("默认品牌语调与审稿红线")
    // The captured input (with its injection attempt) stays in the untrusted user zone, tags escaped.
    expect(system.content).not.toContain("Ignore all previous instructions")
    expect(user.content).toContain("Ignore all previous instructions")
    expect(user.content).toContain("[ESCAPED_TAG]")
    expect(generator.calls[1].messages[1].content).toContain("<evaluator_feedback>")
  })

  it("three failed rounds -> blocked_needs_human, document untouched until resumed round passes", async () => {
    const job = await enqueueDemoJob(db, ws, "block-1")
    const result = await processNextJob({ backend, workerId: "w1", generator: demoGenerator(), evaluator: demoEvaluatorAlwaysFail(), logger: silent })
    expect(result.outcome?.status).toBe("blocked_needs_human")
    expect(await jobRow(job.id)).toMatchObject({ status: "blocked_needs_human", rounds: 3, error_code: "max_rounds" })
    const docBefore = await db.asPostgres((tx) => tx.query<{ revision: number; body: string }>("select revision, body from public.content_documents where id=$1", [ws.documentId]))
    expect(docBefore.rows[0]).toEqual({ revision: 1, body: "初稿：待扩写。" })
    // a human can grant one more round
    const resumed = await db.asUser(ws.ownerId, (tx) => tx.query<{ status: string; limits: Record<string, number> }>("select (r).status, (r).payload->'limits' as limits from (select public.resume_agent_job($1,1,0) r) s", [job.id]))
    expect(resumed.rows[0]).toEqual({ status: "queued", limits: { max_rounds: 4, max_hops: 10, budget_cents: 100 } })
    // the resumed run reads the raised limit from payload.limits and the totals from its steps: only round 4 runs
    const generator = demoGenerator()
    const again = await processNextJob({ backend, workerId: "w2", generator, evaluator: demoEvaluatorAlwaysPass(), logger: silent })
    expect(again.outcome?.status).toBe("pending_review")
    expect(again.outcome?.writtenRevision).toBe(2)
    expect(generator.calls).toHaveLength(1)
    expect(await jobRow(job.id)).toMatchObject({ status: "pending_review", rounds: 4, hops_used: 8 })
  })

  it("resumes from persisted steps after a non-LLM failure without re-billing", async () => {
    const job = await enqueueDemoJob(db, ws, "resume-1")
    const generator = demoGenerator()
    const evaluator = new FakeLlmClient(async (req, i) => {
      if (i === 1) throw new Error("database connection reset")
      return (await demoEvaluatorAlwaysFail().complete(req)).text
    })
    const first = await processNextJob({ backend, workerId: "w1", generator, evaluator, logger: silent, retryDelaySeconds: 0 })
    expect(first.error).toMatch(/connection reset/)
    expect(await jobRow(job.id)).toMatchObject({ status: "queued", attempts: 1 })
    const passing = demoEvaluatorAlwaysPass()
    const second = await processNextJob({ backend, workerId: "w2", generator, evaluator: passing, logger: silent })
    expect(second.outcome?.status).toBe("pending_review")
    expect(generator.calls).toHaveLength(2) // round 1 + round 2 generated exactly once
    expect(passing.calls).toHaveLength(1) // only the interrupted round-2 evaluation was re-run
  })

  it("billable model failures are not retried automatically", async () => {
    const job = await enqueueDemoJob(db, ws, "billable-1")
    const generator = new FakeLlmClient(() => {
      throw new LlmCallError("模型请求超时", { code: "timeout", retryable: true, billable: true })
    })
    await processNextJob({ backend, workerId: "w1", generator, evaluator: null, logger: silent, retryDelaySeconds: 0 })
    expect(await jobRow(job.id)).toMatchObject({ status: "failed", error_code: "timeout" })
  })

  it("fails a job whose document changed after it was queued", async () => {
    const job = await enqueueDemoJob(db, ws, "stale-1")
    await db.asUser(ws.ownerId, (tx) => tx.query("update public.content_documents set body='人工改过' where id=$1", [ws.documentId]))
    await processNextJob({ backend, workerId: "w1", generator: demoGenerator(), evaluator: demoEvaluatorFailThenPass(), logger: silent })
    expect(await jobRow(job.id)).toMatchObject({ status: "failed", error_code: "stale_target" })
  })

  it("refuses to overwrite when a human edits mid-run (between generate and writeDraft)", async () => {
    const job = await enqueueDemoJob(db, ws, "midrun-stale-1")
    const baseGen = demoGenerator()
    const racingGenerator = new FakeLlmClient(async (req, i) => {
      if (i === 0) {
        await db.asUser(ws.ownerId, (tx) => tx.query("update public.content_documents set body='人工中途编辑的正文' where id=$1", [ws.documentId]))
      }
      return (await baseGen.complete(req)).text
    })
    await processNextJob({ backend, workerId: "w1", generator: racingGenerator, evaluator: demoEvaluatorAlwaysPass(), logger: silent })
    expect(await jobRow(job.id)).toMatchObject({ status: "failed", error_code: "stale_target" })
    const doc = await db.asPostgres((tx) => tx.query<{ body: string; revision: number }>("select body, revision from public.content_documents where id=$1", [ws.documentId]))
    expect(doc.rows[0]).toEqual({ body: "人工中途编辑的正文", revision: 2 })
  })

  it("resumes cleanly if worker crashes after writeDraft before persist/complete without re-billing or bumping v3", async () => {
    const job = await enqueueDemoJob(db, ws, "crash-after-write-1")
    const flakyBackend = Object.create(backend) as SqlBackend
    flakyBackend.insertStep = async (step, epoch) => {
      if (step.stepKind === "persist") throw new Error("connection reset before persist")
      return backend.insertStep(step, epoch)
    }
    const first = await processNextJob({ backend: flakyBackend, workerId: "w1", generator: demoGenerator(), evaluator: demoEvaluatorAlwaysPass(), logger: silent, retryDelaySeconds: 0 })
    expect(first.error).toMatch(/connection reset/)
    expect(await jobRow(job.id)).toMatchObject({ status: "queued", result: { written_revision: 2 } })

    const noCalls = new FakeLlmClient(() => {
      throw new Error("should not re-call LLM after writeDraft")
    })
    const second = await processNextJob({ backend, workerId: "w2", generator: noCalls, evaluator: noCalls, logger: silent })
    expect(second.outcome).toMatchObject({ status: "pending_review", writtenRevision: 2 })
    expect(noCalls.calls).toHaveLength(0)
    const doc = await db.asPostgres((tx) => tx.query<{ revision: number }>("select revision from public.content_documents where id=$1", [ws.documentId]))
    expect(doc.rows[0].revision).toBe(2)
  })

  it("retries a failed content_draft job via enqueue_agent_job and succeeds on retry", async () => {
    const failedJob = await enqueueDemoJob(db, ws, "fail-then-retry-1")
    const failingGenerator = new FakeLlmClient(() => {
      throw new LlmCallError("模型服务错误", { code: "provider_error", retryable: false, billable: true })
    })
    await processNextJob({ backend, workerId: "w1", generator: failingGenerator, evaluator: null, logger: silent, retryDelaySeconds: 0 })
    expect(await jobRow(failedJob.id)).toMatchObject({ status: "failed", error_code: "provider_error" })
    const docMeta = await db.asPostgres((tx) => tx.query<{ work_item_id: string }>("select work_item_id from public.content_documents where id=$1", [ws.documentId]))
    const workItemId = docMeta.rows[0].work_item_id
    const itemAfterFail = await db.asPostgres((tx) => tx.query<{ status: string }>("select status from public.work_items where id=$1", [workItemId]))
    expect(itemAfterFail.rows[0].status).toBe("waiting")

    const retried = await db.asUser(ws.ownerId, async (tx) => {
      const doc = (await tx.query<{ revision: number }>("select revision from public.content_documents where id=$1", [ws.documentId])).rows[0]
      return (
        await tx.query<{ id: string; status: string }>(
          "select (j).id, (j).status from (select public.enqueue_agent_job($1,'content_draft',$2,$3::jsonb,'content_document',$4,$5) as j) s",
          [
            ws.organizationId,
            `retry:${failedJob.id}:abcd1234`,
            JSON.stringify({ document_id: ws.documentId, instruction: "根据参考信息写出结构化稿件", platform: "wechat_official", retry_of: failedJob.id }),
            ws.documentId,
            doc.revision,
          ]
        )
      ).rows[0]
    })
    expect(retried.id).not.toBe(failedJob.id)
    expect(retried.status).toBe("queued")
    const itemAfterRetry = await db.asPostgres((tx) => tx.query<{ status: string }>("select status from public.work_items where id=$1", [workItemId]))
    expect(itemAfterRetry.rows[0].status).toBe("doing")

    const result = await processNextJob({ backend, workerId: "w2", generator: demoGenerator(), evaluator: demoEvaluatorAlwaysPass(), logger: silent })
    expect(result.jobId).toBe(retried.id)
    expect(result.outcome).toMatchObject({ status: "pending_review", writtenRevision: 2 })
    expect(await jobRow(failedJob.id)).toMatchObject({ status: "failed" })
    expect(await jobRow(retried.id)).toMatchObject({ status: "pending_review", result: { written_revision: 2 } })
  })
})

describe("drivers", () => {
  it("CLI driver passes the prompt on stdin, never argv, with an env allowlist", async () => {
    const seen: { binary?: string; args?: string[]; env?: Record<string, string>; stdin?: string } = {}
    const fakeSpawn = ((binary: string, args: string[], options: { env: Record<string, string> }) => {
      seen.binary = binary
      seen.args = args
      seen.env = options.env
      const child = new EventEmitter() as EventEmitter & { stdin: { end: (s: string) => void }; stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => undefined
      child.stdin = {
        end: (s: string) => {
          seen.stdin = s
          const out = args[args.indexOf("-o") + 1]
          writeFileSync(out, "CLI FINAL ANSWER")
          setTimeout(() => child.emit("close", 0), 0)
        },
      }
      return child
    }) as unknown as typeof spawn
    process.env.SUPABASE_SERVICE_ROLE_KEY = "must-not-leak"
    process.env.SENSE_NODE_TOKEN = "stn_must-not-leak"
    try {
      const cli = new CliLlmClient({ cliKey: "codex-cli", spawnImpl: fakeSpawn })
      const res = await cli.complete({ messages: [{ role: "system", content: "SECRET_PROMPT_TEXT" }] })
      expect(res.text).toBe("CLI FINAL ANSWER")
      expect(seen.binary).toBe("codex")
      expect(seen.args?.slice(0, 1)).toEqual(["exec"])
      expect(seen.args).toContain("read-only")
      expect(seen.args?.join(" ")).not.toContain("SECRET_PROMPT_TEXT")
      expect(seen.stdin).toContain("SECRET_PROMPT_TEXT")
      expect(seen.env).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY")
      expect(seen.env).not.toHaveProperty("SENSE_NODE_TOKEN")
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
      delete process.env.SENSE_NODE_TOKEN
    }
    expect(Object.keys(buildChildEnv({ PATH: "/bin", SENSE_LLM_API_KEY: "x", HOME: "/h" }))).toEqual(["PATH", "HOME"])
    expect(() => new CliLlmClient({ cliKey: "pi-cli" })).toThrow(/尚未验证/)
  })

  it("cloud driver classifies retryable vs billable failures and reports usage", async () => {
    const make = (impl: typeof fetch) => new CloudLlmClient({ provider: "deepseek", baseUrl: "https://llm.invalid/v1", apiKey: "k", model: "m", fetchImpl: impl, inputCentsPer1k: 1, outputCentsPer1k: 2 })
    const req = { messages: [{ role: "user" as const, content: "hi" }] }
    const rate = await make(async () => new Response("{}", { status: 429 })).complete(req).catch((e) => e as LlmCallError)
    expect(rate).toMatchObject({ code: "rate_limited", retryable: true, billable: false })
    const timeout = await make(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }) }).complete(req).catch((e) => e as LlmCallError)
    expect(timeout).toMatchObject({ code: "timeout", retryable: false, billable: true })
    const refused = await make(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }) }).complete(req).catch((e) => e as LlmCallError)
    expect(refused).toMatchObject({ retryable: true, billable: false })
    const ok = await make(async () => Response.json({ model: "m", choices: [{ message: { content: "draft" } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } })).complete(req)
    expect(ok).toMatchObject({ text: "draft", usage: { inputTokens: 1000, outputTokens: 500, costCents: 2 } })
  })
})
