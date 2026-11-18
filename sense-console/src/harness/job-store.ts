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

export interface SaveProposalInput {
  job: HarnessJob
  documentId: string
  inputRevision: number
  body: string
  model: string
  instruction: string
  inputBrief: string
  usage: LlmUsage
  promptVersion: string
}

/**
 * Persistence port for the loop controller. The worker implements it on Supabase
 * (service_role); tests use InMemoryJobStore or the PGlite-backed store.
 * Every method must be idempotent so a crashed job can resume from its last step.
 */
export interface JobStore {
  listSteps(jobId: string): Promise<HarnessStepRecord[]>
  /** Insert; if (jobId, round, stepKind) already exists, keep the existing row. */
  recordStep(step: HarnessStepRecord): Promise<void>
  /** Extend the lease. ok=false means the lease was lost: stop without writing. */
  heartbeat(jobId: string): Promise<{ ok: boolean; cancelRequested: boolean }>
  /** Write content_ai_proposals (status succeeded) once per job. Returns the proposal id. */
  saveProposal(input: SaveProposalInput): Promise<{ proposalId: string }>
  finish(jobId: string, outcome: { status: HarnessTerminalStatus; result: Record<string, unknown>; error?: string | null; errorCode?: string | null }): Promise<void>
}

export class InMemoryJobStore implements JobStore {
  readonly steps: HarnessStepRecord[] = []
  readonly proposals = new Map<string, { proposalId: string; input: SaveProposalInput }>()
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
  async saveProposal(input: SaveProposalInput) {
    const existing = this.proposals.get(input.job.id)
    if (existing) return { proposalId: existing.proposalId }
    const proposalId = `proposal-${this.proposals.size + 1}`
    this.proposals.set(input.job.id, { proposalId, input })
    return { proposalId }
  }
  async finish(jobId: string, outcome: { status: HarnessTerminalStatus; result: Record<string, unknown>; error?: string | null; errorCode?: string | null }) {
    this.outcomes.set(jobId, outcome)
  }
}
