/**
 * Worker-side copy of the agent_jobs / agent_job_steps contracts (R2, 2026-11-24).
 * The console keeps its own browser-facing copy in sense-console/src/contracts/agent-job.ts;
 * the two do not share code (docs/architecture.md). The database is the source of truth.
 */

export const AGENT_JOB_STATUSES = [
  "queued",
  "running",
  "pending_review",
  "blocked_needs_human",
  "succeeded",
  "failed",
  "cancelled",
] as const
export type AgentJobStatus = (typeof AGENT_JOB_STATUSES)[number]

/** Known job kinds. The column is free text (format-checked) so new pipelines need no migration. */
export type AgentJobKind = "content_draft" | "evaluate" | "video_render" | "publish_external" | "publish_site" | "chat_turn" | (string & {})

/** payload.target: the object the job acts on (DB2c-1). */
export interface JobTarget {
  type: string
  id: string
  revision: number | null
}

/** payload.limits: set at enqueue, raised by a human on resume, enforced by the worker loop. */
export interface JobLimits {
  maxRounds: number
  maxHops: number
  budgetCents: number
  tokenBudget: number | null
}

export const DEFAULT_JOB_LIMITS: JobLimits = { maxRounds: 3, maxHops: 8, budgetCents: 100, tokenBudget: null }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

export function readJobTarget(payload: Record<string, unknown> | null | undefined): JobTarget | null {
  const t = payload?.target
  if (!isObj(t) || typeof t.type !== "string" || typeof t.id !== "string") return null
  return { type: t.type, id: t.id, revision: typeof t.revision === "number" ? t.revision : null }
}

export function readJobLimits(payload: Record<string, unknown> | null | undefined): JobLimits {
  const l = isObj(payload?.limits) ? (payload!.limits as Record<string, unknown>) : {}
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
  return {
    maxRounds: n(l.max_rounds, DEFAULT_JOB_LIMITS.maxRounds),
    maxHops: n(l.max_hops, DEFAULT_JOB_LIMITS.maxHops),
    budgetCents: n(l.budget_cents, DEFAULT_JOB_LIMITS.budgetCents),
    tokenBudget: typeof l.token_budget === "number" ? l.token_budget : null,
  }
}

/** Row of public.agent_jobs. target / limits / approvalRequestId are read from payload. */
export interface AgentJob {
  id: string
  organizationId: string
  workItemId: string | null
  kind: AgentJobKind
  status: AgentJobStatus
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  idempotencyKey: string
  attempts: number
  maxAttempts: number
  runAfter: string | null
  nodeId: string | null
  lockedUntil: string | null
  leaseEpoch: number
  cancelRequestedAt: string | null
  notifiedAt: string | null
  error: string | null
  errorCode: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  target: JobTarget | null
  limits: JobLimits
  approvalRequestId: string | null
}

export type AgentJobStepKind = "context" | "fetch" | "generate" | "check" | "persist"

/** Step usage (agent_job_steps.usage). */
export interface StepUsage {
  inputTokens: number
  outputTokens: number
  costCents: number
  model: string | null
  driver: string | null
  durationMs: number | null
}

/** Row of public.agent_job_steps; round / stage / evaluation / inputSummary are read from output. */
export interface AgentJobStep {
  id: string
  jobId: string
  seq: number
  kind: AgentJobStepKind
  /** For kind = check: precheck (deterministic) or evaluate (independent model). */
  stage: "precheck" | "evaluate" | null
  round: number
  status: "succeeded" | "failed"
  output: Record<string, unknown>
  evaluation: unknown
  inputSummary: Record<string, unknown> | null
  usage: StepUsage
  error: string | null
  createdAt: string
}

/** Progress and usage of one job, derived from its steps (the job row no longer stores them). */
export interface JobUsage {
  rounds: number
  evaluatedRounds: number
  hops: number
  tokens: number
  costCents: number
  driver: string | null
  model: string | null
  durationMs: number
  startedAt: string | null
  lastStepAt: string | null
}

export const EMPTY_JOB_USAGE: JobUsage = { rounds: 0, evaluatedRounds: 0, hops: 0, tokens: 0, costCents: 0, driver: null, model: null, durationMs: 0, startedAt: null, lastStepAt: null }

export function summarizeJobUsage(steps: readonly AgentJobStep[]): JobUsage {
  if (!steps.length) return { ...EMPTY_JOB_USAGE }
  const ordered = [...steps].sort((a, b) => a.seq - b.seq)
  let rounds = 0, hops = 0, tokens = 0, cost = 0, duration = 0
  let driver: string | null = null
  let model: string | null = null
  const evaluated = new Set<number>()
  for (const s of ordered) {
    if (s.kind === "generate") {
      rounds = Math.max(rounds, s.round)
      if (s.usage.model) model = s.usage.model
      if (s.usage.driver) driver = s.usage.driver
    }
    if ((s.kind === "generate" || (s.kind === "check" && s.stage === "evaluate")) && s.usage.driver) hops += 1
    if (s.kind === "check") evaluated.add(s.round)
    tokens += s.usage.inputTokens + s.usage.outputTokens
    cost += s.usage.costCents
    duration += s.usage.durationMs ?? 0
  }
  return {
    rounds,
    evaluatedRounds: evaluated.size,
    hops,
    tokens,
    costCents: Math.round(cost * 10_000) / 10_000,
    driver,
    model,
    durationMs: duration,
    startedAt: ordered[0].createdAt,
    lastStepAt: ordered.at(-1)!.createdAt,
  }
}

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? null : String(v))
const num = (v: unknown) => (v == null ? 0 : Number(v))

export function mapAgentJobStep(row: Row): AgentJobStep {
  const output = isObj(row.output) ? row.output : {}
  const usage = isObj(row.usage) ? row.usage : {}
  const stage = output.stage === "precheck" || output.stage === "evaluate" ? output.stage : null
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    seq: num(row.seq),
    kind: row.kind as AgentJobStepKind,
    stage,
    round: num(output.round),
    status: row.status as "succeeded" | "failed",
    output,
    evaluation: output.evaluation ?? null,
    inputSummary: isObj(output.input_summary) ? output.input_summary : null,
    usage: {
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      costCents: num(usage.cost_cents),
      model: str(usage.model),
      driver: str(usage.driver),
      durationMs: usage.duration_ms == null ? null : Number(usage.duration_ms),
    },
    error: str(row.error),
    createdAt: String(row.created_at),
  }
}
