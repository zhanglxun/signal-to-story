import type { SupabaseClient } from "@supabase/supabase-js"

import type { HarnessJob, HarnessStepRecord, HarnessTerminalStatus, SaveProposalInput } from "../../../sense-console/src/harness/job-store"
import { type AgentQueueBackend, type ClaimedJobRow, type DraftContextRows, rowToStep, stepToRow } from "../backend"

function check<T>(result: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  return result.data
}

/**
 * Production backend: supabase-js with the service_role key (worker process env only).
 * Outbound HTTPS only, so the same worker runs in a cloud container or on a personal machine.
 * NOTE: not exercised against a live Supabase in CI (no local stack); the SQL it relies on is
 * covered by the PGlite tests through SqlBackend.
 */
export class SupabaseBackend implements AgentQueueBackend {
  private readonly client: SupabaseClient
  constructor(client: SupabaseClient) {
    this.client = client
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(fn, args)
    return { data: data as unknown, error: error ? { message: error.message } : null }
  }

  async claim(jobTypes: string[], leaseSeconds: number) {
    const data = check(await this.client.rpc("claim_agent_job", { p_job_types: jobTypes, p_lease_seconds: leaseSeconds }), "claim")
    const rows = (Array.isArray(data) ? data : data ? [data] : []) as ClaimedJobRow[]
    return rows[0] ?? null
  }

  async heartbeat(jobId: string, leaseEpoch: number, leaseSeconds: number) {
    const data = check(await this.client.rpc("heartbeat_agent_job", { p_job_id: jobId, p_lease_epoch: leaseEpoch, p_lease_seconds: leaseSeconds }), "heartbeat") as { ok: boolean; cancel_requested: boolean }
    return { ok: Boolean(data?.ok), cancelRequested: Boolean(data?.cancel_requested) }
  }

  async complete(jobId: string, leaseEpoch: number, status: HarnessTerminalStatus, result: Record<string, unknown>, error: string | null, errorCode: string | null) {
    check(await this.client.rpc("complete_agent_job", { p_job_id: jobId, p_lease_epoch: leaseEpoch, p_status: status, p_result: result, p_error: error, p_error_code: errorCode }), "complete")
  }

  async fail(jobId: string, leaseEpoch: number, error: string, retryable: boolean, retryDelaySeconds: number, errorCode: string | null) {
    check(
      await this.client.rpc("fail_agent_job", { p_job_id: jobId, p_lease_epoch: leaseEpoch, p_error: error.slice(0, 4000), p_retryable: retryable, p_retry_delay_seconds: retryDelaySeconds, p_error_code: errorCode }),
      "fail"
    )
  }

  async listSteps(jobId: string): Promise<HarnessStepRecord[]> {
    const data = check(await this.client.from("agent_job_steps").select("*").eq("job_id", jobId).order("seq"), "listSteps")
    return (data ?? []).map(rowToStep)
  }

  /** Idempotent per (round, stepKind): the lease holder is the only writer, so check-then-append is safe. */
  async insertStep(step: HarnessStepRecord, leaseEpoch: number) {
    const existing = await this.listSteps(step.jobId)
    if (existing.some((s) => s.round === step.round && s.stepKind === step.stepKind)) return
    const row = stepToRow(step)
    check(
      await this.client.rpc("record_agent_job_step", { p_job_id: step.jobId, p_lease_epoch: leaseEpoch, p_kind: row.kind, p_status: row.status, p_output: row.output, p_usage: row.usage, p_error: row.error }),
      "insertStep"
    )
  }

  async saveProposal(input: SaveProposalInput) {
    const existing = check(await this.client.from("content_ai_proposals").select("id").eq("agent_job_id", input.job.id).maybeSingle(), "proposal lookup")
    if (existing) return { proposalId: String((existing as { id: string }).id) }
    const data = check(
      await this.client
        .from("content_ai_proposals")
        .insert({
          organization_id: input.job.organizationId,
          document_id: input.documentId,
          input_revision: input.inputRevision,
          model: input.model,
          prompt_version: input.promptVersion,
          instruction: input.instruction,
          input_brief: input.inputBrief,
          status: "succeeded",
          body: input.body,
          usage: { input_tokens: input.usage.inputTokens, output_tokens: input.usage.outputTokens, total_tokens: input.usage.inputTokens + input.usage.outputTokens },
          created_by: input.job.createdBy,
          finished_at: new Date().toISOString(),
          agent_job_id: input.job.id,
        })
        .select("id")
        .single(),
      "saveProposal"
    )
    return { proposalId: String((data as { id: string }).id) }
  }

  async loadDraftContext(job: HarnessJob): Promise<DraftContextRows> {
    const document = check(
      await this.client.from("content_documents").select("id,organization_id,work_item_id,platform,title,body,revision").eq("id", job.target?.id ?? "").eq("organization_id", job.organizationId).single(),
      "document"
    ) as DraftContextRows["document"]
    const workItem = document.work_item_id
      ? (check(
          await this.client.from("work_items").select("id,kind,title,brief").eq("id", document.work_item_id).eq("organization_id", job.organizationId).maybeSingle(),
          "work item"
        ) as DraftContextRows["workItem"])
      : null
    const source = workItem
      ? (check(
          await this.client
            .from("intake_events")
            .select("id,text,url,created_at")
            .eq("work_item_id", workItem.id)
            .eq("organization_id", job.organizationId)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(1)
            .maybeSingle(),
          "source"
        ) as DraftContextRows["source"])
      : null
    const memories = check(
      await this.client
        .from("decision_memories")
        .select("id,kind,summary,human_quote,platform,content_kind,active,expires_at,created_at")
        .eq("organization_id", job.organizationId)
        .eq("active", true)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order("created_at", { ascending: false })
        .limit(100),
      "memories"
    ) as DraftContextRows["memories"]
    const knowledge = check(
      await this.client.from("knowledge_entries").select("slug,title,category,tags,content,trust_level").eq("organization_id", job.organizationId).neq("trust_level", "archived").order("updated_at", { ascending: false }).limit(200),
      "knowledge"
    ) as DraftContextRows["knowledge"]
    return { document, workItem, source, memories: memories ?? [], knowledge: knowledge ?? [] }
  }
}
