import type { HarnessJob, HarnessStepRecord, HarnessTerminalStatus, SaveProposalInput } from "../../../sense-console/src/harness/job-store"
import { type AgentQueueBackend, type ClaimedJobRow, type DraftContextRows, rowToStep, stepToRow } from "../backend"

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

  async saveProposal(input: SaveProposalInput) {
    return this.run(async (sql) => {
      const existing = await sql.query<{ id: string }>("select id from public.content_ai_proposals where agent_job_id = $1", [input.job.id])
      if (existing.rows[0]) return { proposalId: existing.rows[0].id }
      const r = await sql.query<{ id: string }>(
        `insert into public.content_ai_proposals(organization_id, document_id, input_revision, model, prompt_version, instruction, input_brief, status, body, usage, created_by, finished_at, agent_job_id)
         values ($1,$2,$3,$4,$5,$6,$7,'succeeded',$8,$9,$10,now(),$11) returning id`,
        [input.job.organizationId, input.documentId, input.inputRevision, input.model, input.promptVersion, input.instruction, input.inputBrief,
          input.body, { input_tokens: input.usage.inputTokens, output_tokens: input.usage.outputTokens, total_tokens: input.usage.inputTokens + input.usage.outputTokens }, input.job.createdBy, input.job.id]
      )
      return { proposalId: r.rows[0].id }
    })
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
      const memories = (await sql.query<DraftContextRows["memories"][number]>(
        `select id, kind, summary, human_quote, platform, content_kind, active, expires_at, created_at from public.decision_memories
         where organization_id = $1 and active and (expires_at is null or expires_at > now()) order by created_at desc limit 100`,
        [job.organizationId]
      )).rows
      const knowledge = (await sql.query<DraftContextRows["knowledge"][number]>(
        "select slug, title, category, tags, content, trust_level from public.knowledge_entries where organization_id = $1 and trust_level <> 'archived' order by updated_at desc limit 200",
        [job.organizationId]
      )).rows
      return { document, workItem, source, memories, knowledge }
    })
  }
}
