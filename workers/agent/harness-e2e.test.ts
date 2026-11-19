// @vitest-environment node
import { EventEmitter } from "node:events"
import { writeFileSync } from "node:fs"
import type { spawn } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { FakeLlmClient, LlmCallError } from "../../sense-console/src/harness/llm"
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
    const row = (await tx.query<{ status: string; error_code: string | null; attempts: number }>("select * from public.agent_jobs where id=$1", [id])).rows[0]
    const usage = (await readJobUsage(tx, [id]))[id]
    return { ...row, rounds: usage.rounds, hops_used: usage.hops }
  })

describe("agent worker end to end (PGlite + fake LLM)", () => {
  it("enqueue -> claim -> generate -> evaluate fails -> rewrite -> pass -> proposal + pending_review", async () => {
    const job = await enqueueDemoJob(db, ws)
    const again = await enqueueDemoJob(db, ws)
    expect(again.id).toBe(job.id)

    const generator = demoGenerator()
    const result = await processNextJob({ backend, workerId: "w1", generator, evaluator: demoEvaluatorFailThenPass(), logger: silent })
    expect(result.outcome?.status).toBe("pending_review")

    const row = await jobRow(job.id)
    expect(row).toMatchObject({ status: "pending_review", rounds: 2, hops_used: 4 })

    // Steps and proposal are visible to the human through RLS.
    const seen = await db.asUser(ws.ownerId, async (tx) => {
      const steps = await tx.query<{ seq: number; round: number; step_kind: string; status: string }>(
        "select seq, (output->>'round')::int as round, case when kind = 'check' then output->>'stage' else kind end as step_kind, status from public.agent_job_steps where job_id=$1 order by seq", [job.id])
      const proposals = await tx.query<{ status: string; body: string; prompt_version: string; agent_job_id: string }>("select * from public.content_ai_proposals where document_id=$1", [ws.documentId])
      const doc = await tx.query<{ body: string; revision: number }>("select body, revision from public.content_documents where id=$1", [ws.documentId])
      return { steps: steps.rows, proposals: proposals.rows, doc: doc.rows[0] }
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
    expect(seen.proposals).toHaveLength(1)
    expect(seen.proposals[0]).toMatchObject({ status: "succeeded", prompt_version: "harness-v1", agent_job_id: job.id })
    // The agent never edits the formal document.
    expect(seen.doc).toEqual({ body: "初稿：待扩写。", revision: 1 })

    // Context Pack zoning as seen by the generator.
    const [system, user] = generator.calls[0].messages
    expect(system.content).toContain("克制、专业、讲真话") // trusted knowledge
    expect(system.content).toContain("不要使用震惊体标题") // wechat-scoped memory
    expect(system.content).not.toContain("X 平台只写短句") // x-scoped memory filtered
    expect(system.content).not.toContain("据说光遗传学可以读心") // unreviewed knowledge stays out of system
    expect(user.content).toContain("据说光遗传学可以读心")
    expect(user.content).toContain("[ESCAPED_TAG]")
    expect(generator.calls[1].messages[1].content).toContain("<evaluator_feedback>")
  })

  it("three failed rounds -> blocked_needs_human, no proposal", async () => {
    const job = await enqueueDemoJob(db, ws, "block-1")
    const result = await processNextJob({ backend, workerId: "w1", generator: demoGenerator(), evaluator: demoEvaluatorAlwaysFail(), logger: silent })
    expect(result.outcome?.status).toBe("blocked_needs_human")
    expect(await jobRow(job.id)).toMatchObject({ status: "blocked_needs_human", rounds: 3, error_code: "max_rounds" })
    const proposals = await db.asPostgres((tx) => tx.query("select 1 from public.content_ai_proposals where agent_job_id=$1", [job.id]))
    expect(proposals.rows).toHaveLength(0)
    // a human can grant one more round
    const resumed = await db.asUser(ws.ownerId, (tx) => tx.query<{ status: string; limits: Record<string, number> }>("select (r).status, (r).payload->'limits' as limits from (select public.resume_agent_job($1,1,0) r) s", [job.id]))
    expect(resumed.rows[0]).toEqual({ status: "queued", limits: { max_rounds: 4, max_hops: 10, budget_cents: 100 } })
    // the resumed run reads the raised limit from payload.limits and the totals from its steps: only round 4 runs
    const generator = demoGenerator()
    const again = await processNextJob({ backend, workerId: "w2", generator, evaluator: demoEvaluatorAlwaysPass(), logger: silent })
    expect(again.outcome?.status).toBe("pending_review")
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
