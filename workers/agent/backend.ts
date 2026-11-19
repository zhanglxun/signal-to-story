import { type HarnessJob, type HarnessStepRecord, type HarnessTerminalStatus, readJobLimits, readJobTarget, type SaveProposalInput } from "../../sense-console/src/harness/job-store"

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
  work_item_id: string | null
  kind: string
  payload: Record<string, unknown>
  created_by: string | null
  attempts: number
  max_attempts: number
  /** bigint; PGlite may hand it back as a bigint or string. */
  lease_epoch: number | string | bigint
}

/**
 * Everything the worker needs from the database. Two implementations:
 *  - NodeBackend (production; node_* RPCs with a node token + publishable key over HTTPS, outbound only; DB2c-2)
 *  - SqlBackend (service_role SQL on PGlite; used by older tests and the local demos)
 * Every write after claim passes the lease epoch claim returned; the database refuses a stale epoch.
 */
export interface AgentQueueBackend {
  claim(jobTypes: string[], leaseSeconds: number): Promise<ClaimedJobRow | null>
  heartbeat(jobId: string, leaseEpoch: number, leaseSeconds: number): Promise<{ ok: boolean; cancelRequested: boolean }>
  complete(jobId: string, leaseEpoch: number, status: HarnessTerminalStatus, result: Record<string, unknown>, error: string | null, errorCode: string | null): Promise<void>
  fail(jobId: string, leaseEpoch: number, error: string, retryable: boolean, retryDelaySeconds: number, errorCode: string | null): Promise<void>
  listSteps(jobId: string): Promise<HarnessStepRecord[]>
  insertStep(step: HarnessStepRecord, leaseEpoch: number): Promise<void>
  saveProposal(input: SaveProposalInput): Promise<{ proposalId: string }>
  loadDraftContext(job: HarnessJob): Promise<DraftContextRows>
  /** service_role RPC passthrough (e.g. list_pending_notices). Returns {data, error}. */
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>
}

export function toHarnessJob(row: ClaimedJobRow): HarnessJob {
  const payload = row.payload ?? {}
  return {
    id: row.id,
    organizationId: row.organization_id,
    workItemId: row.work_item_id ?? null,
    kind: row.kind,
    payload,
    target: readJobTarget(payload),
    approvalRequestId: typeof payload.approval_request_id === "string" ? payload.approval_request_id : null,
    createdBy: row.created_by,
    limits: readJobLimits(payload),
    leaseEpoch: Number(row.lease_epoch),
  }
}

/** Database row shape of one step (agent_job_steps: kind, status, output, usage, error). */
export interface StepRow {
  kind: "context" | "fetch" | "generate" | "check" | "persist"
  status: "succeeded" | "failed"
  output: Record<string, unknown>
  usage: Record<string, unknown>
  error: string | null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const META_KEYS = ["round", "stage", "input_digest", "input_summary", "evaluation"] as const

export function stepToRow(step: HarnessStepRecord): StepRow {
  const isCheck = step.stepKind === "precheck" || step.stepKind === "evaluate"
  const base = step.output === undefined || step.output === null ? {} : isObj(step.output) ? step.output : { value: step.output }
  const output: Record<string, unknown> = { ...base, round: step.round }
  if (isCheck) output.stage = step.stepKind
  if (step.inputDigest) output.input_digest = step.inputDigest
  if (step.inputSummary) output.input_summary = step.inputSummary
  if (step.evaluation !== undefined && step.evaluation !== null) output.evaluation = step.evaluation
  const usage: Record<string, unknown> = { cost_cents: step.costCents, duration_ms: Math.max(0, Math.round(step.durationMs)) }
  if (step.usage?.inputTokens != null) usage.input_tokens = step.usage.inputTokens
  if (step.usage?.outputTokens != null) usage.output_tokens = step.usage.outputTokens
  if (step.driver) usage.driver = step.driver
  if (step.model) usage.model = step.model
  return { kind: isCheck ? "check" : (step.stepKind as StepRow["kind"]), status: step.status, output, usage, error: step.error ?? null }
}

export function rowToStep(row: Record<string, unknown>): HarnessStepRecord {
  const out = isObj(row.output) ? row.output : {}
  const usage = isObj(row.usage) ? row.usage : {}
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(out)) if (!(META_KEYS as readonly string[]).includes(k)) rest[k] = v
  const kind = String(row.kind)
  const stage = out.stage === "precheck" || out.stage === "evaluate" ? out.stage : "precheck"
  const num = (v: unknown) => (v == null ? undefined : Number(v))
  const cost = Number(usage.cost_cents ?? 0)
  return {
    jobId: String(row.job_id),
    organizationId: String(row.organization_id),
    round: Number(out.round ?? 0),
    stepKind: (kind === "check" ? stage : kind) as HarnessStepRecord["stepKind"],
    status: row.status as HarnessStepRecord["status"],
    driver: (usage.driver as string | undefined) ?? null,
    model: (usage.model as string | undefined) ?? null,
    inputDigest: (out.input_digest as string | undefined) ?? null,
    inputSummary: (out.input_summary as Record<string, unknown> | undefined) ?? null,
    output: Object.keys(rest).length ? rest : undefined,
    evaluation: out.evaluation ?? undefined,
    usage: usage.input_tokens != null || usage.output_tokens != null ? { inputTokens: num(usage.input_tokens) ?? 0, outputTokens: num(usage.output_tokens) ?? 0, costCents: cost } : null,
    costCents: cost,
    durationMs: Number(usage.duration_ms ?? 0),
    error: (row.error as string | null) ?? null,
  }
}
