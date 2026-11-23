import type { JobLimits, JobTarget } from "../contracts/agent-job"
import type { LlmUsage } from "./llm"

export type HarnessStepKind = "context" | "fetch" | "generate" | "precheck" | "evaluate" | "persist"

/**
 * One durable step as the loop sees it. Stored in public.agent_job_steps as (seq, kind, output, usage):
 * precheck / evaluate become kind 'check' with output.stage; round, digest, summary and evaluation live in
 * output; model, driver, cost and duration live in usage. (jobId, round, stepKind) is unique per job.
 */
export interface HarnessStepRecord {
  jobId: string
  organizationId: string
  round: number
  stepKind: HarnessStepKind
  status: "succeeded" | "failed"
  driver?: string | null
  model?: string | null
  inputDigest?: string | null
  inputSummary?: Record<string, unknown> | null
  output?: unknown
  evaluation?: unknown
  usage?: Partial<LlmUsage> | null
  costCents: number
  durationMs: number
  error?: string | null
}

export { DEFAULT_JOB_LIMITS, type JobLimits, type JobTarget, readJobLimits, readJobTarget } from "../contracts/agent-job"

/** Subset of public.agent_jobs the loop controller needs. */
export interface HarnessJob {
  id: string
  organizationId: string
  workItemId: string | null
  kind: string
  payload: Record<string, unknown>
  result?: Record<string, unknown> | null
  target: JobTarget | null
  approvalRequestId: string | null
  createdBy: string | null
  limits: JobLimits
  /** Lease generation returned by claim; every write must carry it. */
  leaseEpoch: number
}

export interface HarnessProgress {
  rounds: number
  hopsUsed: number
  costCents: number
  tokensUsed: number
}

export type HarnessTerminalStatus = "pending_review" | "blocked_needs_human" | "failed" | "cancelled" | "succeeded"

export interface WriteDraftInput {
  job: HarnessJob
  documentId: string
  baseRevision: number
  title?: string | null
  body: string
}

export interface WriteDraftResult {
  documentId: string
  revision: number
  alreadyWritten?: boolean
}

export class StaleRevisionError extends Error {
  constructor(message = "稿件在出稿期间已被人工修改，拒绝覆盖") {
    super(message)
    this.name = "StaleRevisionError"
  }
}

/**
 * Persistence port for the loop controller. The worker implements it on Supabase
 * (node_* RPCs); tests use InMemoryJobStore or the PGlite-backed store.
 * Every method must be idempotent so a crashed job can resume from its last step.
 */
export interface JobStore {
  listSteps(jobId: string): Promise<HarnessStepRecord[]>
  /** Insert; if (jobId, round, stepKind) already exists, keep the existing row. */
  recordStep(step: HarnessStepRecord): Promise<void>
  /** Extend the lease. ok=false means the lease was lost: stop without writing. */
  heartbeat(jobId: string): Promise<{ ok: boolean; cancelRequested: boolean }>
  /** Write directly to content_documents with base_revision optimistic concurrency. */
  writeDraft(input: WriteDraftInput): Promise<WriteDraftResult>
  finish(jobId: string, outcome: { status: HarnessTerminalStatus; result: Record<string, unknown>; error?: string | null; errorCode?: string | null }): Promise<void>
}

export class InMemoryJobStore implements JobStore {
  readonly steps: HarnessStepRecord[] = []
  readonly drafts = new Map<string, { documentId: string; revision: number; input: WriteDraftInput }>()
  readonly documentRevisions = new Map<string, number>()
  readonly outcomes = new Map<string, { status: HarnessTerminalStatus; result: Record<string, unknown>; error?: string | null; errorCode?: string | null }>()
  cancelRequested = false
  leaseLost = false

  async listSteps(jobId: string) {
    return this.steps.filter((s) => s.jobId === jobId).map((s) => ({ ...s }))
  }
  async recordStep(step: HarnessStepRecord) {
    if (this.steps.some((s) => s.jobId === step.jobId && s.round === step.round && s.stepKind === step.stepKind)) return
    this.steps.push({ ...step })
  }
  async heartbeat() {
    return { ok: !this.leaseLost, cancelRequested: this.cancelRequested }
  }
  async writeDraft(input: WriteDraftInput): Promise<WriteDraftResult> {
    const existing = this.drafts.get(input.job.id)
    if (existing) return { documentId: existing.documentId, revision: existing.revision, alreadyWritten: true }
    const currentRevision = this.documentRevisions.get(input.documentId) ?? input.baseRevision
    if (currentRevision !== input.baseRevision) {
      throw new StaleRevisionError(`stale_revision: 稿件已从 v${input.baseRevision} 变为 v${currentRevision}，拒绝覆盖人工修改`)
    }
    const revision = input.baseRevision + 1
    this.documentRevisions.set(input.documentId, revision)
    this.drafts.set(input.job.id, { documentId: input.documentId, revision, input })
    return { documentId: input.documentId, revision, alreadyWritten: false }
  }
  async finish(jobId: string, outcome: { status: HarnessTerminalStatus; result: Record<string, unknown>; error?: string | null; errorCode?: string | null }) {
    this.outcomes.set(jobId, outcome)
  }
}
