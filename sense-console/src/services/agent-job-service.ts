import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"

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

function throwEnqueueError(error: { code?: string; message?: string } | null, fallback: string): never {
  if (error?.code === "42501") throw new Error(error.message || "没有调度 Agent 任务的权限")
  throw new Error(error?.message || fallback)
}

function randomRetrySuffix(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8)
  }
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0").slice(0, 8)
}

function buildRetryIdempotencyKey(jobId: string): string {
  return `retry:${jobId}:${randomRetrySuffix()}`
}

function stripReservedPayloadFields(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    target: _target,
    limits: _limits,
    approval_request_id: _approvalRequestId,
    server_estimate: _serverEstimate,
    ...rest
  } = payload
  void _target
  void _limits
  void _approvalRequestId
  void _serverEstimate
  return rest
}

async function findActiveContentDraftJob(
  client: ReturnType<typeof db>,
  organizationId: string,
  documentId: string,
): Promise<{ id: string; status: AgentJobStatus } | null> {
  const { data, error } = await client
    .from("agent_jobs")
    .select("id,status")
    .eq("organization_id", organizationId)
    .eq("kind", "content_draft")
    .eq("payload->target->>id", documentId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  fail(error)
  return data ? { id: String(data.id), status: data.status as AgentJobStatus } : null
}

/**
 * Queue a harness draft job directly via Postgres RPC (`enqueue_agent_job`, caller JWT).
 * Returns immediately; poll getAgentJob / listAgentJobSteps for progress. When the worker
 * passes precheck + evaluation, it writes a new revision directly to content_documents.
 */
export async function enqueueContentDraftJob(input: EnqueueContentDraftInput): Promise<EnqueueContentDraftResult> {
  const instruction = input.instruction.trim()
  if (!instruction || instruction.length > 4000) throw new Error("请填写 1–4000 字创作要求")
  if (input.idempotencyKey !== undefined && !/^[\w:.-]{1,200}$/.test(input.idempotencyKey)) {
    throw new Error("幂等键格式无效")
  }
  const client = db()
  const { data: doc, error: docError } = await client
    .from("content_documents")
    .select("id,organization_id,work_item_id,platform,revision")
    .eq("id", input.documentId)
    .single()
  if (docError || !doc) throw new Error("稿件不存在或无权访问")

  const digest = bytesToHex(sha256(new TextEncoder().encode(instruction))).slice(0, 16)
  const baseKey = `content_draft:${doc.id}:r${doc.revision}:${digest}`
  let idempotencyKey = input.idempotencyKey ?? baseKey
  const { data: existing } = await client
    .from("agent_jobs")
    .select("id,status")
    .eq("organization_id", doc.organization_id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle()

  let isDuplicate = Boolean(existing)
  if (!input.idempotencyKey && existing && (existing.status === "failed" || existing.status === "cancelled")) {
    const active = await findActiveContentDraftJob(client, String(doc.organization_id), String(doc.id))
    if (active) {
      return { jobId: active.id, status: active.status, duplicate: true }
    }
    idempotencyKey = `${baseKey}:${randomRetrySuffix()}`.slice(0, 200)
    isDuplicate = false
  }

  const { data: job, error: enqueueError } = await client.rpc("enqueue_agent_job", {
    p_organization_id: doc.organization_id,
    p_job_type: "content_draft",
    p_idempotency_key: idempotencyKey,
    p_payload: { document_id: doc.id, instruction, platform: doc.platform },
    p_target_type: "content_document",
    p_target_id: doc.id,
    p_target_revision: doc.revision,
    p_work_item_id: doc.work_item_id ?? null,
  })
  if (enqueueError || !job) {
    throwEnqueueError(enqueueError, "排队失败，稿件可能已被修改，请刷新后重试")
  }
  return { jobId: String(job.id), status: job.status as AgentJobStatus, duplicate: isDuplicate }
}

/**
 * Re-enqueue a failed or cancelled job as a fresh queued row via the appropriate Postgres RPC,
 * preserving terminal audit history and reading the target's latest revision when applicable.
 */
export async function retryAgentJob(job: AgentJob): Promise<AgentJob> {
  if (job.status !== "failed" && job.status !== "cancelled") {
    throw new Error("只有失败或已取消的任务可以重试")
  }
  const client = db()
  const retryKey = buildRetryIdempotencyKey(job.id)

  if (job.kind === "content_draft") {
    const documentId =
      (job.target?.type === "content_document" ? job.target.id : null) ??
      (typeof job.payload.document_id === "string" ? job.payload.document_id : null)
    if (!documentId) throw new Error("原任务缺少目标稿件信息，无法重试")

    const { data: doc, error: docError } = await client
      .from("content_documents")
      .select("id,organization_id,work_item_id,platform,revision")
      .eq("id", documentId)
      .maybeSingle()
    if (docError || !doc) throw new Error("关联稿件不存在或无权访问，无法重试")

    const active = await findActiveContentDraftJob(client, String(doc.organization_id), String(doc.id))
    if (active) throw new Error("该稿件已有排队或执行中的出稿任务，请勿重复提交")

    const cleanPayload: Record<string, unknown> = {
      ...stripReservedPayloadFields(job.payload),
      document_id: doc.id,
      platform: doc.platform,
      retry_of: job.id,
    }
    if (typeof cleanPayload.instruction !== "string" || !cleanPayload.instruction.trim()) {
      throw new Error("原任务缺少创作要求，无法重试")
    }

    const { data, error } = await client.rpc("enqueue_agent_job", {
      p_organization_id: doc.organization_id,
      p_job_type: "content_draft",
      p_idempotency_key: retryKey,
      p_payload: cleanPayload,
      p_target_type: "content_document",
      p_target_id: doc.id,
      p_target_revision: doc.revision,
      p_budget_cents: job.limits.budgetCents,
      p_max_rounds: job.limits.maxRounds,
      p_work_item_id: doc.work_item_id ?? job.workItemId ?? null,
    })
    if (error || !data) throwEnqueueError(error, "重试排队失败，请稍后重试")
    return mapAgentJob(data)
  }

  if (job.kind === "video_tts_preview" || job.kind === "video_shot_render" || job.kind === "video_compose") {
    const planId =
      (typeof job.payload.plan_id === "string" ? job.payload.plan_id : null) ??
      (job.target?.type === "video_plan" ? job.target.id : null)
    if (!planId) throw new Error("原任务缺少分镜计划信息，无法重试")
    const shotId = typeof job.payload.shot_id === "string" ? job.payload.shot_id : null
    if (job.kind !== "video_compose" && !shotId) throw new Error("原任务缺少镜头信息，无法重试")

    const { data, error } = await client.rpc("enqueue_video_job", {
      p_plan_id: planId,
      p_job_type: job.kind,
      p_shot_id: shotId,
      p_approval_request_id: job.approvalRequestId ?? null,
      p_idempotency_key: retryKey,
    })
    if (error || !data) throwEnqueueError(error, "重试视频任务失败，请稍后重试")
    return mapAgentJob(data)
  }

  if (job.kind === "video_storyboard") {
    const outline = typeof job.payload.outline === "string" ? job.payload.outline.trim() : ""
    if (!outline) throw new Error("原任务缺少视频大纲，无法重试")

    const { data, error } = await client.rpc("enqueue_video_storyboard_job", {
      p_organization_id: job.organizationId,
      p_outline: outline,
      p_options: {
        aspect_ratio: job.payload.aspect_ratio,
        target_seconds: job.payload.target_seconds,
        style: job.payload.style,
        default_voice: job.payload.default_voice,
        budget_cents: job.limits.budgetCents,
      },
      p_work_item_id: job.workItemId ?? null,
      p_idempotency_key: retryKey,
    })
    if (error || !data) throwEnqueueError(error, "重试分镜任务失败，请稍后重试")
    return mapAgentJob(data)
  }

  const cleanPayload = {
    ...stripReservedPayloadFields(job.payload),
    retry_of: job.id,
  }
  const { data, error } = await client.rpc("enqueue_agent_job", {
    p_organization_id: job.organizationId,
    p_job_type: job.kind,
    p_idempotency_key: retryKey,
    p_payload: cleanPayload,
    p_target_type: job.target?.type ?? null,
    p_target_id: job.target?.id ?? null,
    p_target_revision: job.target?.revision ?? null,
    p_budget_cents: job.limits.budgetCents,
    p_max_rounds: job.limits.maxRounds,
    p_approval_request_id: job.approvalRequestId ?? null,
    p_work_item_id: job.workItemId ?? null,
  })
  if (error || !data) throwEnqueueError(error, "重试任务失败，请稍后重试")
  return mapAgentJob(data)
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
  workItemId?: string
  limit?: number
}): Promise<AgentJob[]> {
  let query = db().from("agent_jobs").select("*").eq("organization_id", options.organizationId)
  if (options.statuses?.length) query = query.in("status", options.statuses)
  if (options.kind) query = query.eq("kind", options.kind)
  if (options.targetId) query = query.eq("payload->target->>id", options.targetId)
  if (options.workItemId) query = query.eq("work_item_id", options.workItemId)
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
