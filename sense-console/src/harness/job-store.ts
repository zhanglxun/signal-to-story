import type { LlmUsage } from "./llm"

export type HarnessStepKind = "context" | "fetch" | "generate" | "precheck" | "evaluate" | "persist"

/** Mirrors a row of public.agent_job_steps. (jobId, round, stepKind) is unique. */
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

/** Subset of public.agent_jobs the loop controller needs. */
export interface HarnessJob {
  id: string
  organizationId: string
  jobType: string
  payload: Record<string, unknown>
  targetType: string | null
  targetId: string | null
  targetRevision: number | null
  createdBy: string | null
  budgetCents: number
  tokenBudget: number | null
  maxHops: number
  maxRounds: number
}

export interface HarnessProgress {
  rounds: number
  hopsUsed: number
  costCents: number
  tokensUsed: number
  driver?: string
  model?: string
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
  updateProgress(jobId: string, progress: HarnessProgress): Promise<void>
  /** Extend the lease. ok=false means the lease was lost: stop without writing. */
  heartbeat(jobId: string): Promise<{ ok: boolean; cancelRequested: boolean }>
  /** Write content_ai_proposals (status succeeded) once per job. Returns the proposal id. */
  saveProposal(input: SaveProposalInput): Promise<{ proposalId: string }>
  finish(jobId: string, outcome: { status: HarnessTerminalStatus; result: Record<string, unknown>; error?: string | null; errorCode?: string | null }): Promise<void>
}

export class InMemoryJobStore implements JobStore {
  readonly steps: HarnessStepRecord[] = []
  readonly progress = new Map<string, HarnessProgress>()
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
  async updateProgress(jobId: string, progress: HarnessProgress) {
    this.progress.set(jobId, { ...progress })
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
