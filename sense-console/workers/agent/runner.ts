import type { HarnessJob, JobStore } from "../../src/harness/job-store"
import { LlmCallError, type LlmClient } from "../../src/harness/llm"
import { type HarnessEvent, type HarnessRunOutcome, LeaseLostError, runHarnessJob } from "../../src/harness/loop-controller"
import { type AgentQueueBackend, toHarnessJob } from "./backend"
import { assembleDraftContext, type FetchedSource, StaleTargetError } from "./context"
import { defaultSourceFetcher, type SourceFetcher } from "./fetch-source"
import type { JobHandler, JobHandlerOutcome } from "./job-handlers"
import { type ImNotifyEnv, notifyJobNeedsHuman } from "./notify/im-notify"

export const SUPPORTED_JOB_TYPES = ["content_draft"] as const

export interface WorkerLogger {
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

export const consoleLogger: WorkerLogger = {
  info: (m, d) => console.log(JSON.stringify({ level: "info", msg: m, ...d })),
  warn: (m, d) => console.warn(JSON.stringify({ level: "warn", msg: m, ...d })),
  error: (m, d) => console.error(JSON.stringify({ level: "error", msg: m, ...d })),
}

export interface WorkerOptions {
  backend: AgentQueueBackend
  workerId: string
  generator: LlmClient
  evaluator: LlmClient | null
  jobTypes?: string[]
  leaseSeconds?: number
  pollIntervalMs?: number
  retryDelaySeconds?: number
  logger?: WorkerLogger
  onEvent?: (job: HarnessJob, event: HarnessEvent) => void
  /** Controlled link fetcher for jobs with payload.fetch_source (quick capture). Defaults to the SSRF-safe fetcher. */
  fetchSource?: SourceFetcher
  /** Extra job types (e.g. video_storyboard) handled outside the content_draft harness loop. */
  jobHandlers?: Record<string, JobHandler>
  /** Aborted on shutdown: stop claiming, abort in-flight calls, leave the lease to expire. */
  signal?: AbortSignal
  /** Env for IM push credentials (tests). Defaults to process.env. */
  notifyEnv?: ImNotifyEnv
}

/** IM push for jobs that need a human. Isolated: a failure here never changes the job result. */
async function notifyHuman(options: WorkerOptions, jobId: string, status: string): Promise<void> {
  const log = options.logger ?? consoleLogger
  try {
    await notifyJobNeedsHuman({ rpc: (fn, args) => options.backend.rpc(fn, args), env: options.notifyEnv, log: (e, f) => log.warn(e, f) }, { id: jobId, status })
  } catch (error) {
    log.warn("im_notify_failed", { job_id: jobId, error: String(error) })
  }
}

export function createJobStore(backend: AgentQueueBackend, workerId: string, leaseSeconds: number): JobStore {
  return {
    listSteps: (jobId) => backend.listSteps(jobId),
    recordStep: (step) => backend.insertStep(step),
    updateProgress: (jobId, progress) => backend.updateProgress(jobId, progress),
    heartbeat: (jobId) => backend.heartbeat(jobId, workerId, leaseSeconds),
    saveProposal: (input) => backend.saveProposal(input),
    finish: (jobId, outcome) => backend.complete(jobId, workerId, outcome.status, outcome.result, outcome.error ?? null, outcome.errorCode ?? null),
  }
}

export interface ProcessResult {
  processed: boolean
  jobId?: string
  outcome?: HarnessRunOutcome
  handlerOutcome?: JobHandlerOutcome
  error?: string
}

/** Claim and fully process at most one job. */
export async function processNextJob(options: WorkerOptions): Promise<ProcessResult> {
  const log = options.logger ?? consoleLogger
  const lease = options.leaseSeconds ?? 120
  const { backend, workerId } = options
  const claimed = await backend.claim(workerId, options.jobTypes ?? [...SUPPORTED_JOB_TYPES, ...Object.keys(options.jobHandlers ?? {})], lease)
  if (!claimed) return { processed: false }
  const job = toHarnessJob(claimed)
  log.info("job claimed", { job_id: job.id, job_type: job.jobType, attempt: claimed.attempts })

  // Background heartbeat keeps the lease alive during long model calls.
  const beat = setInterval(() => {
    backend.heartbeat(job.id, workerId, lease).catch((error) => log.warn("heartbeat failed", { job_id: job.id, error: String(error) }))
  }, Math.max(5, Math.floor(lease / 3)) * 1000)
  beat.unref?.()

  try {
    const handler = options.jobHandlers?.[job.jobType]
    if (handler) {
      const handlerOutcome = await handler({ job, claimed, backend, workerId, leaseSeconds: lease, generator: options.generator, signal: options.signal })
      log.info("job finished", { job_id: job.id, status: handlerOutcome.status, rounds: handlerOutcome.roundsExecuted, proposal_id: handlerOutcome.proposalId })
      await notifyHuman(options, job.id, handlerOutcome.status)
      return { processed: true, jobId: job.id, handlerOutcome }
    }
    if (job.jobType !== "content_draft") {
      await backend.fail(job.id, workerId, `worker 不支持任务类型 ${job.jobType}`, false, 0, "unsupported_job_type")
      return { processed: true, jobId: job.id, error: "unsupported_job_type" }
    }
    const rows = await backend.loadDraftContext(job)
    const fetched = await loadFetchedSource(options, job, rows.signal?.site_url ?? null)
    const context = assembleDraftContext(job, rows, fetched)
    const outcome = await runHarnessJob({
      job,
      store: createJobStore(backend, workerId, lease),
      context,
      generator: options.generator,
      evaluator: options.evaluator,
      signal: options.signal,
      onEvent: (event) => options.onEvent?.(job, event),
    })
    log.info("job finished", { job_id: job.id, status: outcome.status, rounds: outcome.roundsExecuted, proposal_id: outcome.proposalId })
    await notifyHuman(options, job.id, outcome.status)
    return { processed: true, jobId: job.id, outcome }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof LeaseLostError) {
      log.warn("lease lost; stopping without writes", { job_id: job.id })
    } else if (options.signal?.aborted) {
      log.warn("shutdown during job; lease will expire and the job resumes from its last step", { job_id: job.id })
    } else if (error instanceof StaleTargetError) {
      await backend.complete(job.id, workerId, "failed", { termination_reason: message }, message, "stale_target")
    } else if (error instanceof LlmCallError) {
      // Billable failures are never retried automatically (same rule as content-draft).
      await backend.fail(job.id, workerId, message, error.retryable, options.retryDelaySeconds ?? 30, error.code)
    } else {
      // Non-LLM failure (DB/network). Completed steps are persisted, so a retry resumes without re-billing.
      await backend.fail(job.id, workerId, message.slice(0, 1000), true, options.retryDelaySeconds ?? 30, "worker_error").catch((e) =>
        log.error("could not record failure", { job_id: job.id, error: String(e) })
      )
    }
    log.error("job error", { job_id: job.id, error: message })
    return { processed: true, jobId: job.id, error: message }
  } finally {
    clearInterval(beat)
  }
}

/**
 * Optional round-0 `fetch` step: fetch the captured link once per job and persist the result
 * (or the failure) as an audit step. On resume the persisted step is reused, never re-fetched.
 * A failed fetch degrades to note-only drafting.
 */
async function loadFetchedSource(options: WorkerOptions, job: HarnessJob, url: string | null): Promise<FetchedSource | null> {
  if (job.payload.fetch_source !== true || !url) return null
  const existing = (await options.backend.listSteps(job.id)).find((s) => s.round === 0 && s.stepKind === "fetch")
  if (existing) {
    const out = existing.output as { title?: string; text?: string; final_url?: string } | undefined
    return existing.status === "succeeded" && out?.text ? { url: out.final_url ?? url, title: out.title ?? "", text: out.text } : null
  }
  const started = Date.now()
  const result = await (options.fetchSource ?? defaultSourceFetcher)(url, options.signal)
  const step = {
    jobId: job.id,
    organizationId: job.organizationId,
    round: 0,
    stepKind: "fetch" as const,
    status: result.ok ? ("succeeded" as const) : ("failed" as const),
    inputSummary: { url },
    output: result.ok
      ? { final_url: result.finalUrl, title: result.title, text: result.text, content_type: result.contentType, bytes: result.bytes, trust: "untrusted" }
      : { code: result.code, fallback: "note_only" },
    costCents: 0,
    durationMs: Date.now() - started,
    error: result.ok ? null : `${result.code}: ${result.error}`.slice(0, 1000),
  }
  await options.backend.insertStep(step)
  options.onEvent?.(job, { type: "step", step, resumed: false })
  return result.ok ? { url: result.finalUrl, title: result.title, text: result.text } : null
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve() }, { once: true })
  })
}

/** Poll forever (until signal aborts). One job at a time per process; scale by running more processes. */
export async function runWorkerLoop(options: WorkerOptions): Promise<void> {
  const log = options.logger ?? consoleLogger
  log.info("worker started", { worker_id: options.workerId, job_types: options.jobTypes ?? SUPPORTED_JOB_TYPES, generator: options.generator.driver, evaluator: options.evaluator?.driver ?? null })
  while (!options.signal?.aborted) {
    try {
      const result = await processNextJob(options)
      if (!result.processed) await sleep(options.pollIntervalMs ?? 5000, options.signal)
    } catch (error) {
      log.error("poll failed", { error: String(error) })
      await sleep(Math.min((options.pollIntervalMs ?? 5000) * 2, 60_000), options.signal)
    }
  }
  log.info("worker stopped", { worker_id: options.workerId })
}
