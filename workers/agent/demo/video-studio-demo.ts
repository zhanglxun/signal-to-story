/**
 * Full Video Studio chain on PGlite (all migrations) + fake LLM + the real Python worker (dry-run engine):
 * outline → storyboard job → proposal → human adoption → paid render rejected → approval request → human approval
 * → enqueue → Python worker (stdio bridge, service_role) renders → assets / shot state / ledger → compose → costs.
 * The Python worker cannot reach PGlite over HTTP, so it runs with `--backend stdio` and this bridge executes each
 * of its operations as service_role SQL — the same grants, triggers and Mandate the REST backend hits in production.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { createSupabaseTestDb, type SupabaseTestDb } from "../../../testing/db/pglite-harness"
import { seedVideoWorkspace, type VideoWorkspace } from "../../../testing/db/video-studio-seed"
import { SqlBackend, type SqlExecutor } from "../backends/sql-backend"
import { processNextJob, type WorkerLogger } from "../runner"
import { demoStoryboardLlm, enqueueDemoStoryboard, seedTrustedVideoSop } from "./video-demo-scenario"
import { createVideoStoryboardHandler, SqlVideoStoryboardStore } from "../video-storyboard"

const here = path.dirname(fileURLToPath(import.meta.url))
export const VIDEO_WORKER_PY = path.resolve(here, "../../video/worker.py")

const silent: WorkerLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }
const IDENT = /^[a-z_]{1,64}$/

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? Number(v) : v)))
}

/** Answers the Python StdioBackend operations against PGlite as service_role. */
export function createBridgeHandler(db: SupabaseTestDb, objectRoot: string) {
  const asWorker = <T>(fn: (sql: SqlExecutor) => Promise<T>) => db.asServiceRole(fn)
  const setClause = (patch: Record<string, unknown>, offset: number) => {
    const keys = Object.keys(patch)
    if (!keys.every((k) => IDENT.test(k))) throw new Error("invalid column")
    return { sql: keys.map((k, i) => `${k} = $${i + offset}`).join(", "), values: keys.map((k) => patch[k]) }
  }
  return async (op: string, a: Record<string, unknown>): Promise<unknown> => {
    switch (op) {
      case "claim":
        return asWorker(async (s) => (await s.query("select * from public.claim_agent_job($1,$2,$3)", [a.worker_id, a.job_types, a.lease_seconds])).rows[0] ?? null)
      case "heartbeat":
        return asWorker(async (s) => (await s.query<{ b: unknown }>("select public.heartbeat_agent_job($1,$2,$3) as b", [a.job_id, a.worker_id, a.lease_seconds])).rows[0].b)
      case "complete":
        return asWorker((s) => s.query("select public.complete_agent_job($1,$2,$3,$4,$5,$6)", [a.job_id, a.worker_id, a.status, a.result, a.error, a.error_code])).then(() => null)
      case "fail":
        return asWorker((s) => s.query("select public.fail_agent_job($1,$2,$3,$4,$5,$6)", [a.job_id, a.worker_id, a.error, a.retryable, a.retry_delay_seconds, a.error_code])).then(() => null)
      case "get_plan":
        return asWorker(async (s) => (await s.query("select * from public.video_plans where id = $1", [a.plan_id])).rows[0] ?? null)
      case "list_shots":
        return asWorker(async (s) => (await s.query("select * from public.video_shots where plan_id = $1 order by position", [a.plan_id])).rows)
      case "get_asset":
        return asWorker(async (s) => (await s.query("select id, organization_id, cloud_url, media_type, metadata from public.assets where id = $1", [a.asset_id])).rows[0] ?? null)
      case "update_shot":
      case "update_plan": {
        const set = setClause(a.patch as Record<string, unknown>, 2)
        const table = op === "update_shot" ? "video_shots" : "video_plans"
        await asWorker((s) => s.query(`update public.${table} set ${set.sql} where id = $1`, [op === "update_shot" ? a.shot_id : a.plan_id, ...set.values]))
        return null
      }
      case "insert_asset":
      case "insert_cost_entry": {
        const row = a.row as Record<string, unknown>
        const keys = Object.keys(row)
        if (!keys.every((k) => IDENT.test(k))) throw new Error("invalid column")
        const table = op === "insert_asset" ? "assets" : "video_cost_entries"
        const r = await asWorker((s) => s.query<{ id: unknown }>(`insert into public.${table}(${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`, keys.map((k) => row[k])))
        return op === "insert_asset" ? Number(r.rows[0].id) : null
      }
      case "upload": {
        const dest = path.join(objectRoot, String(a.bucket), String(a.path))
        mkdirSync(path.dirname(dest), { recursive: true })
        copyFileSync(String(a.local_file), dest)
        await db.asPostgres((s) => s.query("insert into storage.objects(bucket_id, name) values ($1, $2)", [a.bucket, a.path]))
        return null
      }
      case "download": {
        mkdirSync(path.dirname(String(a.dest_file)), { recursive: true })
        copyFileSync(path.join(objectRoot, String(a.bucket), String(a.path)), String(a.dest_file))
        return null
      }
      default:
        throw new Error(`unknown op ${op}`)
    }
  }
}

/** Spawn `worker.py --backend stdio --dry-run --once` and serve its requests until it exits. */
export async function runPythonVideoWorker(db: SupabaseTestDb, objectRoot: string, options: { engine?: string; onLog?: (line: string) => void } = {}) {
  const handle = createBridgeHandler(db, objectRoot)
  const child: ChildProcess = spawn("python3", [VIDEO_WORKER_PY, "--backend", "stdio", "--engine", options.engine ?? "dry-run", "--once"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SENSE_VIDEO_WORKER_ID: "demo-video-worker", SENSE_VIDEO_LEASE_SECONDS: "120" },
  })
  const logs: string[] = []
  createInterface({ input: child.stderr! }).on("line", (line) => {
    logs.push(line)
    options.onLog?.(line)
  })
  const rl = createInterface({ input: child.stdout! })
  let chain = Promise.resolve()
  rl.on("line", (line) => {
    chain = chain.then(async () => {
      const msg = JSON.parse(line) as { id: number; op: string; args: Record<string, unknown> }
      let reply: Record<string, unknown>
      try {
        reply = { id: msg.id, ok: true, result: jsonSafe(await handle(msg.op, msg.args)) }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        reply = { id: msg.id, ok: false, error: text, status: /duplicate key|unique/.test(text) ? 409 : 400 }
      }
      child.stdin!.write(JSON.stringify(reply) + "\n")
    })
  })
  const code = await new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? 1)))
  await chain
  return { code, logs }
}

export interface VideoDemoReport {
  ok: boolean
  lines: string[]
  planId: string
  finalAssetId: number | null
  finalBytes: number
  costs: { estimatedCents: number; actualCents: number }
}

export async function runVideoStudioDemo(options: { print?: (line: string) => void; engine?: string } = {}): Promise<VideoDemoReport> {
  const lines: string[] = []
  const say = (line: string) => {
    lines.push(line)
    options.print?.(line)
  }
  const objectRoot = mkdtempSync(path.join(tmpdir(), "sense-video-objects-"))
  const db = await createSupabaseTestDb()
  try {
    say(`PGlite ready: ${db.appliedMigrations.length} migrations`)
    const ws: VideoWorkspace = await seedVideoWorkspace(db)
    await seedTrustedVideoSop(db, ws)

    // 1. Outline → storyboard job → proposal (fake LLM; first output fails the schema)
    const job = await enqueueDemoStoryboard(db, ws)
    const agent = await processNextJob({
      backend: new SqlBackend((fn) => db.asServiceRole(fn)), workerId: "demo-agent", generator: demoStoryboardLlm(), evaluator: null, logger: silent,
      jobHandlers: { video_storyboard: createVideoStoryboardHandler(new SqlVideoStoryboardStore((fn) => db.asServiceRole(fn))) },
    })
    say(`[1] video_storyboard ${job.id.slice(0, 8)} → ${agent.handlerOutcome?.status} after ${agent.handlerOutcome?.roundsExecuted} rounds (round 1 rejected by zod)`)
    const proposal = await db.asUser(ws.ownerId, async (tx) => (await tx.query<{ id: string; status: string }>("select id, status from public.video_storyboard_proposals where agent_job_id=$1", [job.id])).rows[0])
    const plansBefore = await db.asPostgres(async (tx) => (await tx.query("select id from public.video_plans")).rows.length)
    say(`[2] proposal ${proposal.id.slice(0, 8)} status=${proposal.status}; formal plans before adoption: ${plansBefore}`)

    // 2. Human adoption
    const planId = await db.asUser(ws.ownerId, async (tx) => (await tx.query<{ id: string }>("select public.accept_video_storyboard_proposal($1) as id", [proposal.id])).rows[0].id)
    const shots = await db.asUser(ws.ownerId, async (tx) => (await tx.query<{ id: string; position: number; motion_mode: string; estimated_cost_cents: string }>(
      "select id, position, motion_mode, estimated_cost_cents from public.video_shots where plan_id=$1 order by position", [planId])).rows)
    say(`[3] adopted → plan ${planId.slice(0, 8)} r1 with ${shots.length} shots: ${shots.map((s) => `${s.position}:${s.motion_mode}(${Number(s.estimated_cost_cents)}分)`).join(" ")}`)
    const cloud = shots.find((s) => s.motion_mode === "cloud_video_model")!
    const local = shots.find((s) => s.motion_mode === "local_ken_burns")!

    // 3. Paid render without approval is rejected by the database
    const enqueue = (jobType: string, shotId: string | null, approvalId: string | null = null) =>
      db.asUser(ws.ownerId, async (tx) => (await tx.query<{ id: string; status: string; payload: { server_estimate: { cost_cents: number; requires_approval: boolean } } }>(
        "select * from public.enqueue_video_job($1,$2,$3,$4)", [planId, jobType, shotId, approvalId])).rows[0])
    const rejected = await enqueue("video_shot_render", cloud.id).then(() => "queued (UNEXPECTED)", (e: Error) => `rejected: ${e.message}`)
    say(`[4] cloud shot render without approval → ${rejected}`)
    const preview = await enqueue("video_shot_render", local.id)
    say(`[5] local Ken Burns preview (free, no approval) → ${preview.status}, server estimate ${preview.payload.server_estimate.cost_cents}分`)

    // 4. Approval request → member cannot decide → owner approves
    const approval = await db.asUser(ws.ownerId, async (tx) => (await tx.query<{ id: string; estimated_cost_cents: number; summary: string }>("select * from public.request_video_render_approval($1)", [planId])).rows[0])
    say(`[6] approval requested: ${approval.summary}`)
    const memberTry = await db.asUser(ws.memberId, (tx) => tx.query("select public.decide_approval_request($1,'approved','')", [approval.id])).then(() => "approved (UNEXPECTED)", (e: Error) => `denied: ${e.message}`)
    say(`[7] member (no agent.approve) decides → ${memberTry}`)
    await db.asUser(ws.ownerId, (tx) => tx.query("select public.decide_approval_request($1,'approved','demo')", [approval.id]))
    const paid = await enqueue("video_shot_render", cloud.id, approval.id)
    say(`[8] owner approved → cloud shot render ${paid.status}, server estimate ${paid.payload.server_estimate.cost_cents}分 (capped by approval ${approval.estimated_cost_cents}分)`)

    // 5. Python worker renders (dry-run: no paid API)
    const run1 = await runPythonVideoWorker(db, objectRoot, { engine: options.engine })
    say(`[9] python worker (dry-run) exit=${run1.code}: ${run1.logs.filter((l) => l.includes("job processed")).length} jobs processed`)
    const compose = await enqueue("video_compose", null)
    say(`[10] compose → ${compose.status}, server estimate ${compose.payload.server_estimate.cost_cents}分 (cloud shot already rendered → no approval)`)
    const run2 = await runPythonVideoWorker(db, objectRoot, { engine: options.engine })
    say(`[11] python worker (dry-run) exit=${run2.code}: ${run2.logs.filter((l) => l.includes("job processed")).length} jobs processed`)

    // 6. Results as the viewer sees them
    const view = await db.asUser(ws.viewerId, async (tx) => ({
      jobs: (await tx.query<{ job_type: string; status: string; error_code: string | null }>("select job_type, status, error_code from public.agent_jobs where organization_id=$1 order by created_at", [ws.organizationId])).rows,
      shots: (await tx.query<{ position: number; render_status: string; actual_duration_ms: number; actual_cost_cents: string }>("select position, render_status, actual_duration_ms, actual_cost_cents from public.video_shots where plan_id=$1 order by position", [planId])).rows,
      plan: (await tx.query<{ status: string; composed_video_asset_id: number | null; final_duration_ms: number | null; revision: number }>("select status, composed_video_asset_id, final_duration_ms, revision from public.video_plans where id=$1", [planId])).rows[0],
      summary: (await tx.query<{ estimated_cents: string; actual_cents: string }>("select estimated_cents, actual_cents from public.video_plan_cost_summary where plan_id=$1", [planId])).rows[0],
      ledger: (await tx.query<{ kind: string; provider: string; n: number; actual: string }>("select kind, provider, count(*)::int as n, sum(actual_cents) as actual from public.video_cost_entries where plan_id=$1 group by kind, provider order by kind", [planId])).rows,
      assets: (await tx.query<{ category: string; n: number }>("select category, count(*)::int as n from public.assets where organization_id=$1 and asset_type='video_studio' group by category order by category", [ws.organizationId])).rows,
    }))
    for (const j of view.jobs) say(`    job ${j.job_type.padEnd(18)} ${j.status}${j.error_code ? ` (${j.error_code})` : ""}`)
    say(`[12] shots: ${view.shots.map((s) => `${s.position}:${s.render_status}/${s.actual_duration_ms}ms`).join(" ")}`)
    say(`     assets: ${view.assets.map((a) => `${a.category}×${a.n}`).join(" ")}`)
    say(`     ledger: ${view.ledger.map((l) => `${l.kind}/${l.provider}×${l.n}=${Number(l.actual)}分`).join(" ")}`)
    say(`     cost summary: estimated ${Number(view.summary.estimated_cents)}分, actual ${Number(view.summary.actual_cents)}分 (dry-run: providers not called)`)
    let finalBytes = 0
    const finalAssetId = view.plan.composed_video_asset_id == null ? null : Number(view.plan.composed_video_asset_id)
    if (finalAssetId) {
      const asset = await db.asUser(ws.viewerId, async (tx) => (await tx.query<{ cloud_url: string; metadata: { mime_type: string; placeholder: boolean } }>("select cloud_url, metadata from public.assets where id=$1", [finalAssetId])).rows[0])
      const file = path.join(objectRoot, asset.cloud_url.replace("supabase://", ""))
      finalBytes = statSync(file).size
      say(`[13] final video: plan ${view.plan.status}, ${view.plan.final_duration_ms}ms, ${asset.metadata.mime_type}, ${finalBytes} bytes${asset.metadata.placeholder ? " (dry-run placeholder)" : ""}`)
    }

    // 7. Editing after approval expires it
    await db.asUser(ws.ownerId, (tx) => tx.query("update public.video_shots set narration='改一句台词' where id=$1", [cloud.id]))
    const expired = await db.asPostgres(async (tx) => (await tx.query<{ status: string }>("select status from public.approval_requests where id=$1", [approval.id])).rows[0].status)
    say(`[14] edited a line → plan r${await db.asPostgres(async (tx) => (await tx.query<{ revision: number }>("select revision from public.video_plans where id=$1", [planId])).rows[0].revision)}, approval ${expired}`)

    const ok = rejected.startsWith("rejected") && memberTry.startsWith("denied") && paid.status === "queued" && run1.code === 0 && run2.code === 0
      && view.plan.status === "rendered" && view.shots.every((s) => s.render_status === "rendered") && expired === "expired"
      && view.jobs.filter((j) => j.job_type !== "video_storyboard").every((j) => j.status === "succeeded")
    say(ok ? "PASS: outline → proposal → adoption → approval → queue → dry-run render → assets → costs" : "FAIL")
    return { ok, lines, planId, finalAssetId, finalBytes, costs: { estimatedCents: Number(view.summary.estimated_cents), actualCents: Number(view.summary.actual_cents) } }
  } finally {
    await db.close()
    rmSync(objectRoot, { recursive: true, force: true })
  }
}
