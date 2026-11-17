/**
 * Local end-to-end demo (no network, no Supabase): `npm --prefix sense-console run demo:harness`
 * PGlite + every migration -> enqueue -> claim -> generate -> evaluate (fail) -> rewrite -> pass
 * -> proposal + pending_review; then a second job that fails 3 rounds -> blocked_needs_human.
 * Set SENSE_LLM_* (and optionally SENSE_EVAL_LLM_*) to use a real model for scenario 1 instead of fakes.
 */
import type { LlmClient } from "../../../sense-console/src/harness/llm"
import { createSupabaseTestDb } from "../../../testing/db/pglite-harness"
import { SqlBackend } from "../backends/sql-backend"
import { buildLlmClientFromEnv } from "../config"
import { demoEvaluatorAlwaysFail, demoEvaluatorFailThenPass, demoGenerator, enqueueDemoJob, seedDemoWorkspace } from "./demo-scenario"
import { processNextJob, type WorkerLogger } from "../runner"

const quiet: WorkerLogger = { info: () => undefined, warn: () => undefined, error: (m, d) => console.error("  !", m, d) }

function printStep(kind: string, round: number, status: string, extra: string) {
  console.log(`  [round ${round}] ${kind.padEnd(8)} ${status.padEnd(9)} ${extra}`)
}

async function scenario(title: string, generator: LlmClient, evaluator: LlmClient, key: string) {
  console.log(`\n=== ${title} ===`)
  const db = await createSupabaseTestDb()
  console.log(`PGlite ready, ${db.appliedMigrations.length} migrations applied`)
  const ws = await seedDemoWorkspace(db)
  const job = await enqueueDemoJob(db, ws, key)
  console.log(`enqueued job ${job.id} status=${job.status}`)
  const backend = new SqlBackend((fn) => db.asServiceRole(fn))
  const result = await processNextJob({
    backend,
    workerId: "demo-worker",
    generator,
    evaluator,
    logger: quiet,
    onEvent: (_job, event) => {
      if (event.type !== "step") return
      const s = event.step
      const ev = s.evaluation as { score?: number; revisionInstruction?: string | null } | undefined
      const detail =
        s.stepKind === "generate" ? `${s.driver} ${String((s.output as { draft?: string })?.draft ?? "").length} chars` :
        s.stepKind === "context" ? JSON.stringify(s.inputSummary) :
        s.stepKind === "persist" ? `proposal ${(s.output as { proposalId?: string })?.proposalId}` :
        `score=${ev?.score ?? "-"} ${ev?.revisionInstruction ? "→ " + ev.revisionInstruction.slice(0, 80) : ""}`
      printStep(s.stepKind, s.round, s.status, detail)
    },
  })
  const final = await db.asPostgres(async (tx) => {
    const j = await tx.query<{ status: string; rounds: number; hops_used: number; error: string | null }>("select status, rounds, hops_used, error from public.agent_jobs where id=$1", [result.jobId])
    const steps = await tx.query<{ n: number }>("select count(*)::int as n from public.agent_job_steps where job_id=$1", [result.jobId])
    const p = await tx.query<{ id: string; status: string }>("select id, status from public.content_ai_proposals where agent_job_id=$1", [result.jobId])
    const doc = await tx.query<{ body: string; revision: number }>("select body, revision from public.content_documents where id=$1", [ws.documentId])
    return { job: j.rows[0], steps: steps.rows[0].n, proposal: p.rows[0] ?? null, doc: doc.rows[0] }
  })
  console.log(`result: job.status=${final.job.status} rounds=${final.job.rounds} hops=${final.job.hops_used} steps=${final.steps}`)
  console.log(`        proposal=${final.proposal ? `${final.proposal.id} (${final.proposal.status})` : "none"}; document untouched: revision=${final.doc.revision} body="${final.doc.body}"`)
  if (final.job.error) console.log(`        reason: ${final.job.error}`)
  await db.close()
  return final.job.status
}

async function main() {
  const realGenerator = buildLlmClientFromEnv("SENSE_LLM")
  const realEvaluator = buildLlmClientFromEnv("SENSE_EVAL_LLM") ?? realGenerator
  const s1 = await scenario(
    realGenerator ? `Scenario 1 (REAL model: ${realGenerator.driver}/${realGenerator.model})` : "Scenario 1: evaluator fails once, rewrite passes (fake LLM)",
    realGenerator ?? demoGenerator(),
    realEvaluator ?? demoEvaluatorFailThenPass(),
    "demo-pass"
  )
  const s2 = await scenario("Scenario 2: evaluator never passes -> blocked_needs_human (fake LLM)", demoGenerator(), demoEvaluatorAlwaysFail(), "demo-block")
  const ok = (realGenerator ? true : s1 === "pending_review") && s2 === "blocked_needs_human"
  console.log(`\n${ok ? "PASS" : "FAIL"}: scenario1=${s1} scenario2=${s2}`)
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
