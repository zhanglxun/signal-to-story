import type { SupabaseClient } from "@supabase/supabase-js"

import { type HarnessJob, type HarnessStepRecord, type HarnessTerminalStatus, StaleRevisionError, type WriteDraftInput, type WriteDraftResult } from "../../../sense-console/src/harness/job-store"
import { type AgentQueueBackend, type ClaimedJobRow, type DraftContextRows, rowToStep, stepToRow } from "../backend"
import { loadRepositoryKnowledge } from "../knowledge"
import type { VideoStoryboardStore } from "../video-storyboard"
import type { SqlExecutor } from "./sql-backend"

/** One RPC call: supabase-js `rpc` shape. */
export type RpcCall = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

/** Production: the publishable key only (anon role). The node token in each call is the credential. */
export function supabaseRpc(client: SupabaseClient): RpcCall {
  return async (fn, args) => {
    const { data, error } = await client.rpc(fn, args)
    return { data: data as unknown, error: error ? { message: error.message } : null }
  }
}

/** Tests / demos: `run` executes with the role PostgREST would use (the PGlite harness passes `db.asAnon`). */
export function sqlRpc(run: <T>(fn: (sql: SqlExecutor) => Promise<T>) => Promise<T>): RpcCall {
  const ident = /^[a-z_][a-z0-9_]*$/
  return async (fn, args) => {
    if (!ident.test(fn)) return { data: null, error: { message: "invalid function name" } }
    const keys = Object.keys(args).filter((k) => ident.test(k))
    try {
      return await run(async (sql) => {
        const r = await sql.query<{ r: unknown }>(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]))
        return { data: (r.rows[0]?.r ?? null) as unknown, error: null }
      })
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }
    }
  }
}

async function call<T>(rpc: RpcCall, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}

/** Notice RPCs the notifier calls by their DB2c-1 names, mapped to the node-scoped ones. */
const NODE_NOTICE_RPC: Record<string, string> = { list_pending_notices: "node_list_pending_notices", mark_notice_sent: "node_mark_notice_sent" }

/**
 * Agent worker backend over node_* RPCs (DB2c-2, DB-D16). The worker holds a revocable node token instead of
 * service_role; the database resolves the node from the token, scopes claims to its organization and refuses
 * writes to jobs the node does not hold. Every write after claim also carries the lease epoch.
 */
export class NodeBackend implements AgentQueueBackend {
  private readonly call: RpcCall
  private readonly token: string
  constructor(rpc: RpcCall, token: string) {
    this.call = rpc
    this.token = token
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    const nodeFn = NODE_NOTICE_RPC[fn]
    if (!nodeFn) return { data: null, error: { message: `节点不能调用 ${fn}` } }
    return this.call(nodeFn, { p_token: this.token, ...args })
  }

  async claim(jobTypes: string[], leaseSeconds: number) {
    const row = await call<ClaimedJobRow | null>(this.call, "node_claim", { p_token: this.token, p_job_types: jobTypes, p_lease_seconds: leaseSeconds })
    return row ?? null
  }

  async heartbeat(jobId: string, leaseEpoch: number, leaseSeconds: number) {
    const data = await call<{ ok: boolean; cancel_requested: boolean } | null>(this.call, "node_heartbeat", { p_token: this.token, p_job_id: jobId, p_lease_epoch: leaseEpoch, p_lease_seconds: leaseSeconds })
    return { ok: Boolean(data?.ok), cancelRequested: Boolean(data?.cancel_requested) }
  }

  async complete(jobId: string, leaseEpoch: number, status: HarnessTerminalStatus, result: Record<string, unknown>, error: string | null, errorCode: string | null) {
    await call(this.call, "node_complete", { p_token: this.token, p_job_id: jobId, p_lease_epoch: leaseEpoch, p_status: status, p_result: result, p_error: error, p_error_code: errorCode })
  }

  async fail(jobId: string, leaseEpoch: number, error: string, retryable: boolean, retryDelaySeconds: number, errorCode: string | null) {
    await call(this.call, "node_fail", { p_token: this.token, p_job_id: jobId, p_lease_epoch: leaseEpoch, p_error: error.slice(0, 4000), p_retryable: retryable, p_retry_delay_seconds: retryDelaySeconds, p_error_code: errorCode })
  }

  async listSteps(jobId: string): Promise<HarnessStepRecord[]> {
    const rows = await call<Record<string, unknown>[] | null>(this.call, "node_list_steps", { p_token: this.token, p_job_id: jobId })
    return (rows ?? []).map(rowToStep)
  }

  /** Idempotent per (round, stepKind): the lease holder is the only writer, so check-then-append is safe. */
  async insertStep(step: HarnessStepRecord, leaseEpoch: number) {
    const existing = await this.listSteps(step.jobId)
    if (existing.some((s) => s.round === step.round && s.stepKind === step.stepKind)) return
    const row = stepToRow(step)
    await call(this.call, "node_record_step", { p_token: this.token, p_job_id: step.jobId, p_lease_epoch: leaseEpoch, p_kind: row.kind, p_status: row.status, p_output: row.output, p_usage: row.usage, p_error: row.error })
  }

  async writeDraft(input: WriteDraftInput): Promise<WriteDraftResult> {
    const { data, error } = await this.call("node_write_document_draft", {
      p_token: this.token,
      p_job_id: input.job.id,
      p_lease_epoch: input.job.leaseEpoch,
      p_document_id: input.documentId,
      p_base_revision: input.baseRevision,
      p_title: input.title ?? null,
      p_body: input.body,
    })
    if (error) {
      if (/stale_revision|拒绝覆盖/.test(error.message)) throw new StaleRevisionError(error.message)
      throw new Error(`node_write_document_draft: ${error.message}`)
    }
    const res = data as { document_id: string; revision: number; already_written?: boolean }
    return { documentId: String(res.document_id), revision: Number(res.revision), alreadyWritten: Boolean(res.already_written) }
  }

  async loadDraftContext(job: HarnessJob): Promise<DraftContextRows> {
    const rows = await call<DraftContextRows>(this.call, "node_draft_context", { p_token: this.token, p_job_id: job.id })
    return { ...rows, memories: [], knowledge: loadRepositoryKnowledge() }
  }
}

/** Storyboard persistence for the agent worker, through the same node token. */
export class NodeVideoStoryboardStore implements VideoStoryboardStore {
  private readonly call: RpcCall
  private readonly token: string
  constructor(rpc: RpcCall, token: string) {
    this.call = rpc
    this.token = token
  }
  async writeDraft(input: Parameters<VideoStoryboardStore["writeDraft"]>[0]) {
    const id = await call<string>(this.call, "node_write_video_draft", {
      p_token: this.token,
      p_job_id: input.jobId,
      p_lease_epoch: input.leaseEpoch,
      p_draft: { ...input.draft, model: input.model },
    })
    return { planId: String(id) }
  }
}
