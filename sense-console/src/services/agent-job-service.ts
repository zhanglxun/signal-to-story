import {
  type AgentJob,
  type AgentJobStatus,
  type AgentJobStep,
  type ApprovalAction,
  type ApprovalRequest,
  type EnqueueContentDraftInput,
  type EnqueueContentDraftResult,
  EMPTY_JOB_USAGE,
  type JobUsage,
  mapAgentJob,
  mapAgentJobStep,
  summarizeJobUsage,
  mapApprovalRequest,
} from "@/contracts/agent-job"
import { getSupabaseClient } from "@/lib/supabase"

function db() {
  const client = getSupabaseClient()
  if (!client) throw new Error("Supabase 未配置")
  return client
}

function fail(error: { message?: string } | null): void {
  if (error) throw new Error(error.message || "请求失败，请稍后重试")
}

/**
 * Queue a harness draft job. Calls the `content-draft` Edge Function in queue mode, which
 * re-checks permissions and inserts an idempotent agent_jobs row. Returns immediately;
 * poll getAgentJob / listAgentJobSteps for progress. The proposal lands in content_ai_proposals.
 */
export async function enqueueContentDraftJob(input: EnqueueContentDraftInput): Promise<EnqueueContentDraftResult> {
  const { data, error } = await db().functions.invoke("content-draft", {
    body: { mode: "queue", document_id: input.documentId, instruction: input.instruction, idempotency_key: input.idempotencyKey },
  })
  if (error) {
    const context = (error as { context?: Response }).context
    const body = context && typeof context.json === "function" ? await context.json().catch(() => null) : null
    throw new Error(body?.error ?? error.message ?? "排队失败")
  }
  return { jobId: String(data.job_id), status: data.status as AgentJobStatus, duplicate: Boolean(data.duplicate) }
}

export async function getAgentJob(jobId: string): Promise<AgentJob | null> {
  const { data, error } = await db().from("agent_jobs").select("*").eq("id", jobId).maybeSingle()
  fail(error)
  return data ? mapAgentJob(data) : null
}

export async function listAgentJobs(options: {
  organizationId: string
  statuses?: AgentJobStatus[]
  kind?: string
  targetId?: string
  limit?: number
}): Promise<AgentJob[]> {
  let query = db().from("agent_jobs").select("*").eq("organization_id", options.organizationId)
  if (options.statuses?.length) query = query.in("status", options.statuses)
  if (options.kind) query = query.eq("kind", options.kind)
  if (options.targetId) query = query.eq("payload->target->>id", options.targetId)
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(Math.min(options.limit ?? 50, 200))
  fail(error)
  return (data ?? []).map(mapAgentJob)
}

export async function listAgentJobSteps(jobId: string): Promise<AgentJobStep[]> {
  const { data, error } = await db()
    .from("agent_job_steps")
    .select("*")
    .eq("job_id", jobId)
    .order("seq", { ascending: true })
  fail(error)
  return (data ?? []).map(mapAgentJobStep)
}

/**
 * Rounds, tokens, cost, model … per job, derived from agent_job_steps (DB2c-1 dropped the job-level columns).
 * Reads only the small fields (round / stage / usage), not the step outputs.
 */
export async function listJobUsage(jobIds: readonly string[]): Promise<Record<string, JobUsage>> {
  const ids = [...new Set(jobIds)]
  if (!ids.length) return {}
  const { data, error } = await db()
    .from("agent_job_steps")
    .select("id,job_id,seq,kind,status,error,created_at,round:output->round,stage:output->stage,usage")
    .in("job_id", ids)
    .order("seq", { ascending: true })
  fail(error)
  const byJob = new Map<string, ReturnType<typeof mapAgentJobStep>[]>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const step = mapAgentJobStep({ ...r, output: { round: r.round, stage: r.stage } })
    byJob.set(step.jobId, [...(byJob.get(step.jobId) ?? []), step])
  }
  return Object.fromEntries(ids.map((id) => [id, byJob.has(id) ? summarizeJobUsage(byJob.get(id)!) : { ...EMPTY_JOB_USAGE }]))
}

export async function cancelAgentJob(jobId: string): Promise<AgentJob> {
  const { data, error } = await db().rpc("cancel_agent_job", { p_job_id: jobId })
  fail(error)
  return mapAgentJob(data)
}

export async function resumeAgentJob(jobId: string, options: { extraRounds?: number; extraBudgetCents?: number } = {}): Promise<AgentJob> {
  const { data, error } = await db().rpc("resume_agent_job", {
    p_job_id: jobId,
    p_extra_rounds: options.extraRounds ?? 1,
    p_extra_budget_cents: options.extraBudgetCents ?? 0,
  })
  fail(error)
  return mapAgentJob(data)
}

export async function listApprovalRequests(options: { organizationId: string; statuses?: ApprovalRequest["status"][]; limit?: number }): Promise<ApprovalRequest[]> {
  let query = db().from("approval_requests").select("*").eq("organization_id", options.organizationId)
  if (options.statuses?.length) query = query.in("status", options.statuses)
  const { data, error } = await query.order("created_at", { ascending: false }).limit(Math.min(options.limit ?? 50, 200))
  fail(error)
  return (data ?? []).map(mapApprovalRequest)
}

export async function createApprovalRequest(input: {
  organizationId: string
  action: ApprovalAction
  targetType: string
  targetId: string
  targetRevision?: number | null
  summary?: string
  payload?: Record<string, unknown>
  estimatedCostCents?: number | null
}): Promise<ApprovalRequest> {
  const { data, error } = await db().rpc("create_approval_request", {
    p_organization_id: input.organizationId,
    p_action: input.action,
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_target_revision: input.targetRevision ?? null,
    p_summary: input.summary ?? "",
    p_payload: input.payload ?? {},
    p_estimated_cost_cents: input.estimatedCostCents ?? null,
  })
  fail(error)
  return mapApprovalRequest(data)
}

/** Human decision. The database re-checks membership, permission, expiry and target revision. */
export async function decideApprovalRequest(requestId: string, decision: "approved" | "rejected", reason = ""): Promise<ApprovalRequest> {
  const { data, error } = await db().rpc("decide_approval_request", { p_request_id: requestId, p_decision: decision, p_reason: reason })
  fail(error)
  return mapApprovalRequest(data)
}
