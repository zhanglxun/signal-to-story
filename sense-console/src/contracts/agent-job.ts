/** Browser-facing contracts for public.agent_jobs / agent_job_steps / approval_requests. */

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

/** Known job types. The column is free text (format-checked) so new pipelines need no migration. */
export type AgentJobType = "content_draft" | "evaluate" | "video_render" | "publish_external" | "publish_site" | (string & {})

export interface AgentJob {
  id: string
  organizationId: string
  jobType: AgentJobType
  status: AgentJobStatus
  priority: number
  targetType: string | null
  targetId: string | null
  targetRevision: number | null
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  idempotencyKey: string
  attempts: number
  maxAttempts: number
  lockedBy: string | null
  lockedUntil: string | null
  cancelRequestedAt: string | null
  budgetCents: number
  costCents: number
  tokenBudget: number | null
  tokensUsed: number
  hopsUsed: number
  maxHops: number
  rounds: number
  maxRounds: number
  driver: string | null
  model: string | null
  approvalRequestId: string | null
  error: string | null
  errorCode: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type AgentJobStepKind = "context" | "fetch" | "generate" | "precheck" | "evaluate" | "persist"

export interface AgentJobStep {
  id: string
  jobId: string
  round: number
  stepKind: AgentJobStepKind
  status: "succeeded" | "failed"
  driver: string | null
  model: string | null
  inputDigest: string | null
  inputSummary: Record<string, unknown> | null
  output: unknown
  evaluation: unknown
  usage: Record<string, unknown> | null
  costCents: number
  durationMs: number | null
  error: string | null
  createdAt: string
}

export type ApprovalAction =
  | "publish_external"
  | "publish_site"
  | "paid_video_render"
  | "rotate_credentials"
  | "delete_project"
  | "change_org_permissions"
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired"

export interface ApprovalRequest {
  id: string
  organizationId: string
  action: ApprovalAction
  targetType: string
  targetId: string
  targetRevision: number | null
  status: ApprovalStatus
  summary: string
  payload: Record<string, unknown>
  estimatedCostCents: number | null
  requestedByJob: string | null
  requestedBy: string | null
  decidedBy: string | null
  decidedAt: string | null
  reason: string
  expiresAt: string
  createdAt: string
}

export interface EnqueueContentDraftInput {
  documentId: string
  instruction: string
  /** Defaults to a stable key per document revision + instruction, so double clicks don't duplicate. */
  idempotencyKey?: string
}

export interface EnqueueContentDraftResult {
  jobId: string
  status: AgentJobStatus
  duplicate: boolean
}

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? null : String(v))
const num = (v: unknown) => (v == null ? 0 : Number(v))

export function mapAgentJob(row: Row): AgentJob {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    jobType: String(row.job_type),
    status: row.status as AgentJobStatus,
    priority: num(row.priority),
    targetType: str(row.target_type),
    targetId: str(row.target_id),
    targetRevision: row.target_revision == null ? null : Number(row.target_revision),
    payload: (row.payload as Record<string, unknown>) ?? {},
    result: (row.result as Record<string, unknown> | null) ?? null,
    idempotencyKey: String(row.idempotency_key),
    attempts: num(row.attempts),
    maxAttempts: num(row.max_attempts),
    lockedBy: str(row.locked_by),
    lockedUntil: str(row.locked_until),
    cancelRequestedAt: str(row.cancel_requested_at),
    budgetCents: num(row.budget_cents),
    costCents: num(row.cost_cents),
    tokenBudget: row.token_budget == null ? null : Number(row.token_budget),
    tokensUsed: num(row.tokens_used),
    hopsUsed: num(row.hops_used),
    maxHops: num(row.max_hops),
    rounds: num(row.rounds),
    maxRounds: num(row.max_rounds),
    driver: str(row.driver),
    model: str(row.model),
    approvalRequestId: str(row.approval_request_id),
    error: str(row.error),
    errorCode: str(row.error_code),
    createdBy: str(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: str(row.started_at),
    finishedAt: str(row.finished_at),
  }
}

export function mapAgentJobStep(row: Row): AgentJobStep {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    round: num(row.round),
    stepKind: row.step_kind as AgentJobStepKind,
    status: row.status as "succeeded" | "failed",
    driver: str(row.driver),
    model: str(row.model),
    inputDigest: str(row.input_digest),
    inputSummary: (row.input_summary as Record<string, unknown> | null) ?? null,
    output: row.output ?? null,
    evaluation: row.evaluation ?? null,
    usage: (row.usage as Record<string, unknown> | null) ?? null,
    costCents: num(row.cost_cents),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    error: str(row.error),
    createdAt: String(row.created_at),
  }
}

export function mapApprovalRequest(row: Row): ApprovalRequest {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    action: row.action as ApprovalAction,
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    targetRevision: row.target_revision == null ? null : Number(row.target_revision),
    status: row.status as ApprovalStatus,
    summary: String(row.summary ?? ""),
    payload: (row.payload as Record<string, unknown>) ?? {},
    estimatedCostCents: row.estimated_cost_cents == null ? null : Number(row.estimated_cost_cents),
    requestedByJob: str(row.requested_by_job),
    requestedBy: str(row.requested_by),
    decidedBy: str(row.decided_by),
    decidedAt: str(row.decided_at),
    reason: String(row.reason ?? ""),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
  }
}

/** Jobs a human should look at, grouped for the "等我处理" view. */
export const HUMAN_ATTENTION_STATUSES: readonly AgentJobStatus[] = ["pending_review", "blocked_needs_human", "failed"]
