import type { HarnessJob, HarnessProgress, HarnessStepRecord, HarnessTerminalStatus, SaveProposalInput } from "../../sense-console/src/harness/job-store"

/** Raw rows the worker reads to build a Context Pack (snake_case, as stored). */
export interface DraftContextRows {
  document: { id: string; organization_id: string; work_item_id: string | null; platform: string; title: string; body: string; revision: number }
  /** The board card the document belongs to (null only for V1 documents not yet backfilled). */
  workItem: { id: string; kind: string; title: string; brief: Record<string, unknown> } | null
  /** The card's first input (intake_events), i.e. the raw material the human captured. */
  source: { id: string; text: string; url: string | null; created_at: string } | null
  memories: Array<{ id: string; kind: string; summary: string; human_quote: string; platform: string | null; content_kind: string | null; active: boolean; expires_at: string | null; created_at: string }>
  knowledge: Array<{ slug: string; title: string; category: string; tags: string[]; content: string; trust_level: string }>
}

export interface ClaimedJobRow {
  id: string
  organization_id: string
  job_type: string
  payload: Record<string, unknown>
  target_type: string | null
  target_id: string | null
  target_revision: number | null
  created_by: string | null
  budget_cents: number
  token_budget: number | null
  max_hops: number
  max_rounds: number
  attempts: number
  max_attempts: number
}

/**
 * Everything the worker needs from the database. Two implementations:
 *  - SupabaseBackend (production; supabase-js + service_role over HTTPS, outbound only)
 *  - SqlBackend (PGlite / any `query(sql, params)` executor; used by tests and the local demo)
 */
export interface AgentQueueBackend {
  claim(workerId: string, jobTypes: string[], leaseSeconds: number): Promise<ClaimedJobRow | null>
  heartbeat(jobId: string, workerId: string, leaseSeconds: number): Promise<{ ok: boolean; cancelRequested: boolean }>
  complete(jobId: string, workerId: string, status: HarnessTerminalStatus, result: Record<string, unknown>, error: string | null, errorCode: string | null): Promise<void>
  fail(jobId: string, workerId: string, error: string, retryable: boolean, retryDelaySeconds: number, errorCode: string | null): Promise<void>
  listSteps(jobId: string): Promise<HarnessStepRecord[]>
  insertStep(step: HarnessStepRecord): Promise<void>
  updateProgress(jobId: string, progress: HarnessProgress): Promise<void>
  saveProposal(input: SaveProposalInput): Promise<{ proposalId: string }>
  loadDraftContext(job: HarnessJob): Promise<DraftContextRows>
  /** service_role RPC passthrough (e.g. im_notify_target). Returns {data, error}. */
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>
}

export function toHarnessJob(row: ClaimedJobRow): HarnessJob {
  return {
    id: row.id,
    organizationId: row.organization_id,
    jobType: row.job_type,
    payload: row.payload ?? {},
    targetType: row.target_type,
    targetId: row.target_id,
    targetRevision: row.target_revision,
    createdBy: row.created_by,
    budgetCents: Number(row.budget_cents),
    tokenBudget: row.token_budget == null ? null : Number(row.token_budget),
    maxHops: Number(row.max_hops),
    maxRounds: Number(row.max_rounds),
  }
}

export function stepToRow(step: HarnessStepRecord) {
  return {
    organization_id: step.organizationId,
    job_id: step.jobId,
    round: step.round,
    step_kind: step.stepKind,
    status: step.status,
    driver: step.driver ?? null,
    model: step.model ?? null,
    input_digest: step.inputDigest ?? null,
    input_summary: step.inputSummary ?? null,
    output: step.output === undefined ? null : step.output,
    evaluation: step.evaluation === undefined ? null : step.evaluation,
    usage: step.usage ?? null,
    cost_cents: step.costCents,
    duration_ms: Math.max(0, Math.round(step.durationMs)),
    error: step.error ?? null,
  }
}

export function rowToStep(row: Record<string, unknown>): HarnessStepRecord {
  return {
    jobId: String(row.job_id),
    organizationId: String(row.organization_id),
    round: Number(row.round),
    stepKind: row.step_kind as HarnessStepRecord["stepKind"],
    status: row.status as HarnessStepRecord["status"],
    driver: (row.driver as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    inputDigest: (row.input_digest as string | null) ?? null,
    inputSummary: (row.input_summary as Record<string, unknown> | null) ?? null,
    output: row.output ?? undefined,
    evaluation: row.evaluation ?? undefined,
    usage: (row.usage as HarnessStepRecord["usage"]) ?? null,
    costCents: Number(row.cost_cents ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    error: (row.error as string | null) ?? null,
  }
}
