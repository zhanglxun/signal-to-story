/**
 * P3 acceptance demo (no network, no Supabase): `npm --prefix sense-console run demo:capture`
 * PGlite + every migration -> quick_capture(auto_draft, link + note, 1 platform)
 * -> worker drains the queue (fake fetcher + fake LLM) -> pending_review proposals with evaluation records.
 */
import { createSupabaseTestDb } from "../../../testing/db/pglite-harness"
import { drainQueue, fakeFetcher, quickCapture, seedCaptureWorkspace } from "./capture-scenario"
import { demoEvaluatorFailThenPass, demoGenerator } from "./demo-scenario"
import type { WorkerLogger } from "../runner"

const quiet: WorkerLogger = { info: () => undefined, warn: () => undefined, error: (m, d) => console.error("  !", m, d) }

async function main() {
  const db = await createSupabaseTestDb()
  console.log(`PGlite ready, ${db.appliedMigrations.length} migrations applied`)
  const ws = await seedCaptureWorkspace(db)
  const input = {
    organizationId: ws.organizationId,
    url: "https://example.com/optogenetics",
    note: "从因果研究工具的角度讲，别写成读心术",
    intent: "auto_draft" as const,
    platforms: ["wechat_official"],
    key: "demo-capture-0001",
  }
  const capture = await quickCapture(db, ws.ownerId, input)
  console.log(`\nquick_capture(auto_draft) -> signal=${capture.signal_id} selection=${capture.selection_id} project=${capture.project_id}`)
  for (const d of capture.documents) console.log(`  document ${d.platform.padEnd(16)} ${d.document_id}  job ${d.job_id}`)
  const dup = await quickCapture(db, ws.ownerId, input)
  console.log(`retry with same key -> duplicate=${dup.duplicate}, same project=${dup.project_id === capture.project_id}`)

  console.log("\nworker (fake fetcher + fake generator + fake evaluator):")
  const results = await drainQueue(db, {
    generator: demoGenerator(),
    evaluator: demoEvaluatorFailThenPass(),
    fetchSource: fakeFetcher,
    logger: quiet,
    onEvent: (job, event) => {
      if (event.type !== "step" || event.resumed) return
      const s = event.step
      const ev = s.evaluation as { score?: number; revisionInstruction?: string | null } | undefined
      const detail =
        s.stepKind === "fetch" ? `${(s.output as { title?: string })?.title ?? ""} ${s.error ?? ""}` :
        s.stepKind === "generate" ? `${s.driver} ${String((s.output as { draft?: string })?.draft ?? "").length} chars` :
        s.stepKind === "context" ? JSON.stringify(s.inputSummary) :
        s.stepKind === "persist" ? `proposal ${(s.output as { proposalId?: string })?.proposalId}` :
        `score=${ev?.score ?? "-"} ${ev?.revisionInstruction ? "→ " + ev.revisionInstruction.slice(0, 60) : ""}`
      console.log(`  ${job.id.slice(0, 8)} [round ${s.round}] ${s.stepKind.padEnd(8)} ${s.status.padEnd(9)} ${detail}`)
    },
  })

  const final = await db.asUser(ws.viewerId, async (tx) => {
    const jobs = await tx.query<{ id: string; status: string; rounds: number; hops_used: number; cost_cents: string }>(
      "select id, status, rounds, hops_used, cost_cents from public.agent_jobs where payload->>'quick_capture_id'=$1", [capture.capture_id])
    const proposals = await tx.query<{ id: string; agent_job_id: string }>("select id, agent_job_id from public.content_ai_proposals where agent_job_id = any($1)", [jobs.rows.map((j) => j.id)])
    return { jobs: jobs.rows, proposals: proposals.rows }
  })
  console.log("\nresult:")
  for (const j of final.jobs) {
    const p = final.proposals.find((x) => x.agent_job_id === j.id)
    console.log(`  job ${j.id.slice(0, 8)} status=${j.status} rounds=${j.rounds} hops=${j.hops_used} cost_cents=${j.cost_cents} proposal=${p?.id ?? "none"}`)
  }
  const ok = results.length === capture.documents.length && final.jobs.every((j) => j.status === "pending_review") && final.proposals.length === final.jobs.length && dup.duplicate
  console.log(`\n${ok ? "PASS" : "FAIL"}: ${final.proposals.length}/${final.jobs.length} pending_review proposals`)
  await db.close()
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
