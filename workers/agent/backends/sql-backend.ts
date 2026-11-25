import { type HarnessJob, type HarnessStepRecord, type HarnessTerminalStatus, StaleRevisionError, type WriteDraftInput, type WriteDraftResult } from "../loop/job-store"
import { type AgentQueueBackend, type ClaimedJobRow, type DraftContextRows, rowToStep, stepToRow } from "../backend"
import { loadRepositoryKnowledge } from "../knowledge"

/** Minimal executor: PGlite, a PGlite Transaction or node-postgres all fit. */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

/**
 * Backend over raw SQL. `run` must execute the callback with service_role privileges
 * (the PGlite harness passes `db.asServiceRole`). Used by tests and `npm run demo:harness`.
 */
export class SqlBackend implements AgentQueueBackend {
  private readonly run: <T>(fn: (sql: SqlExecutor) => Promise<T>) => Promise<T>
  constructor(run: <T>(fn: (sql: SqlExecutor) => Promise<T>) => Promise<T>) {
    this.run = run
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    const ident = /^[a-z_][a-z0-9_]*$/
    if (!ident.test(fn)) return { data: null, error: { message: "invalid function name" } }
    const keys = Object.keys(args).filter((k) => ident.test(k))
    try {
      return await this.run(async (sql) => {
        const r = await sql.query<{ r: unknown }>(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]))
        return { data: (r.rows[0]?.r ?? null) as unknown, error: null }
      })
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }
    }
  }

  async claim(jobTypes: string[], leaseSeconds: number) {
    return this.run(async (sql) => {
      const r = await sql.query<ClaimedJobRow>("select * from public.claim_agent_job($1, $2)", [jobTypes, leaseSeconds])
      return r.rows[0] ?? null
    })
  }

  async heartbeat(jobId: string, leaseEpoch: number, leaseSeconds: number) {
    return this.run(async (sql) => {
      const r = await sql.query<{ beat: { ok: boolean; cancel_requested: boolean } }>("select public.heartbeat_agent_job($1, $2, $3) as beat", [jobId, leaseEpoch, leaseSeconds])
      const beat = r.rows[0].beat
      return { ok: beat.ok, cancelRequested: beat.cancel_requested }
    })
  }

  async complete(jobId: string, leaseEpoch: number, status: HarnessTerminalStatus, result: Record<string, unknown>, error: string | null, errorCode: string | null) {
    await this.run((sql) => sql.query("select public.complete_agent_job($1, $2, $3, $4, $5, $6)", [jobId, leaseEpoch, status, result, error, errorCode]))
  }

  async fail(jobId: string, leaseEpoch: number, error: string, retryable: boolean, retryDelaySeconds: number, errorCode: string | null) {
    await this.run((sql) => sql.query("select public.fail_agent_job($1, $2, $3, $4, $5, $6)", [jobId, leaseEpoch, error.slice(0, 4000), retryable, retryDelaySeconds, errorCode]))
  }

  async listSteps(jobId: string): Promise<HarnessStepRecord[]> {
    return this.run(async (sql) => {
      const r = await sql.query("select * from public.agent_job_steps where job_id = $1 order by seq", [jobId])
      return r.rows.map(rowToStep)
    })
  }

  /** Idempotent per (round, stepKind): the lease holder is the only writer, so check-then-append is safe. */
  async insertStep(step: HarnessStepRecord, leaseEpoch: number) {
    const existing = await this.listSteps(step.jobId)
    if (existing.some((s) => s.round === step.round && s.stepKind === step.stepKind)) return
    const row = stepToRow(step)
    await this.run((sql) =>
      sql.query("select public.record_agent_job_step($1, $2, $3, $4, $5, $6, $7)", [step.jobId, leaseEpoch, row.kind, row.status, JSON.stringify(row.output), JSON.stringify(row.usage), row.error])
    )
  }

  async writeDraft(input: WriteDraftInput): Promise<WriteDraftResult> {
    try {
      return await this.run(async (sql) => {
        const r = await sql.query<{ r: { document_id: string; revision: number; already_written?: boolean } }>(
          "select public.write_document_draft($1,$2,$3,$4,$5,$6) as r",
          [input.job.id, input.job.leaseEpoch, input.documentId, input.baseRevision, input.title ?? null, input.body]
        )
        const res = r.rows[0].r
        return { documentId: String(res.document_id), revision: Number(res.revision), alreadyWritten: Boolean(res.already_written) }
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (/stale_revision|拒绝覆盖/.test(msg)) throw new StaleRevisionError(msg)
      throw error
    }
  }

  async loadDraftContext(job: HarnessJob): Promise<DraftContextRows> {
    return this.run(async (sql) => {
      const doc = await sql.query<DraftContextRows["document"]>(
        "select id, organization_id, work_item_id, platform, title, body, revision from public.content_documents where id::text = $1 and organization_id = $2",
        [job.target?.id ?? "", job.organizationId]
      )
      const document = doc.rows[0]
      if (!document) throw new Error("稿件不存在或不属于该组织")
      const workItem = document.work_item_id
        ? (await sql.query<NonNullable<DraftContextRows["workItem"]>>(
            "select id, kind, title, brief from public.work_items where id = $1 and organization_id = $2",
            [document.work_item_id, job.organizationId]
          )).rows[0] ?? null
        : null
      const source = workItem
        ? (await sql.query<NonNullable<DraftContextRows["source"]>>(
            "select id, text, url, created_at from public.intake_events where work_item_id = $1 and organization_id = $2 order by created_at, id limit 1",
            [workItem.id, job.organizationId]
          )).rows[0] ?? null
        : null
      return { document, workItem, source, memories: [], knowledge: loadRepositoryKnowledge() }
    })
  }
}
