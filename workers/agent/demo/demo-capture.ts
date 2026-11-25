/**
 * P3 acceptance demo (no network, no Supabase): `npm run demo:capture`
 * PGlite + every migration -> quick_capture(auto_draft, link + note, 1 platform)
 * -> worker drains the queue (fake fetcher + fake LLM) -> documents updated directly to v2 + pending_review.
 */
import { createSupabaseTestDb } from "../../../testing/db/pglite-harness"
import { drainQueue, fakeFetcher, quickCapture, seedCaptureWorkspace } from "./capture-scenario"
import { demoEvaluatorFailThenPass, demoGenerator, readJobUsage } from "./demo-scenario"
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
  console.log(`\nquick_capture(auto_draft) -> input=${capture.event_id} work_item=${capture.work_item_id}`)
  for (const d of capture.documents) console.log(`  document ${d.platform.padEnd(16)} ${d.document_id}  job ${d.job_id}`)
  const dup = await quickCapture(db, ws.ownerId, input)
  console.log(`retry with same key -> duplicate=${dup.duplicate}, same work item=${dup.work_item_id === capture.work_item_id}`)

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
        s.stepKind === "persist" ? `document v${(s.output as { revision?: number })?.revision}` :
        `score=${ev?.score ?? "-"} ${ev?.revisionInstruction ? "→ " + ev.revisionInstruction.slice(0, 60) : ""}`
      console.log(`  ${job.id.slice(0, 8)} [round ${s.round}] ${s.stepKind.padEnd(8)} ${s.status.padEnd(9)} ${detail}`)
    },
  })

  const final = await db.asUser(ws.viewerId, async (tx) => {
    const jobs = await tx.query<{ id: string; status: string; target_id: string }>(
      "select id, status, payload->'target'->>'id' as target_id from public.agent_jobs where payload->>'intake_event_id'=$1", [capture.event_id])
    const usage = await readJobUsage(tx, jobs.rows.map((j) => j.id))
    const docs = await tx.query<{ id: string; platform: string; revision: number; body: string }>(
      "select id, platform, revision, body from public.content_documents where work_item_id=$1", [capture.work_item_id])
    return { jobs: jobs.rows, usage, docs: docs.rows }
  })
  console.log("\nresult:")
  for (const j of final.jobs) {
    const d = final.docs.find((x) => x.id === j.target_id)
    console.log(`  job ${j.id.slice(0, 8)} status=${j.status} rounds=${final.usage[j.id].rounds} hops=${final.usage[j.id].hops} cost_cents=${final.usage[j.id].costCents} doc=${d?.platform}@v${d?.revision ?? "?"} (${d?.body.length ?? 0} chars)`)
  }
  const ok = results.length === capture.documents.length && final.jobs.every((j) => j.status === "pending_review")
    && final.docs.length === final.jobs.length && final.docs.every((d) => d.revision === 2 && d.body.trim().length > 0) && dup.duplicate
  console.log(`\n${ok ? "PASS" : "FAIL"}: ${final.docs.filter((d) => d.revision === 2).length}/${final.jobs.length} direct draft writes (v2)`)
  await db.close()
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
