/**
 * Database access for the chat HTTP entry (docs/modules/chat.md 2.4–2.5, architecture.md 6.5).
 *
 * Two identities, never mixed:
 *  - UserDataApi: the signed-in user's JWT over the publishable key, so RLS and the RPCs' own permission
 *    checks apply (send_chat_message, regenerate_chat_turn, cancel_agent_job and the chat tools).
 *  - NodeChatApi: the node token for node_* RPCs (claim, context, heartbeat, usage, append).
 * Both are small interfaces so tests route them to PGlite and run the real SQL.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { RpcCall } from "./node-backend"
import type { SqlExecutor } from "./sql-backend"

/** A database error as PostgREST reports it: SQLSTATE in `code`, plus `hint` (e.g. turn_in_progress). */
export interface DbError {
  message: string
  code?: string
  hint?: string
}
export type DbResult<T> = { data: T | null; error: DbError | null }

export class DbCallError extends Error {
  readonly code?: string
  readonly hint?: string
  constructor(fn: string, error: DbError) {
    super(`${fn}: ${error.message}`)
    this.name = "DbCallError"
    this.code = error.code
    this.hint = error.hint
  }
}

export interface WorkItemRow {
  id: string
  organization_id: string
  kind: string
  title: string
  status: string
  brief: Record<string, unknown> | null
}
export interface DocumentRow {
  id: string
  organization_id: string
  work_item_id: string | null
  platform: string
  title: string
  status: string
  revision: number
  body?: string
}

/** Everything the entry does as the user. Reads go through RLS; writes only through RPCs. */
export interface UserDataApi {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<DbResult<T>>
  getWorkItem(id: string): Promise<WorkItemRow | null>
  /** Titles and status only (no bodies), newest first, at most 20. */
  listWorkItemDocuments(workItemId: string): Promise<DocumentRow[]>
  /** With an excerpt of the body (first 500 characters). */
  getDocument(id: string): Promise<DocumentRow | null>
}

/** Verified identity of a bearer token. */
export interface VerifiedUser {
  id: string
}

// ── Production: supabase-js with the user's JWT ────────────────────────────────────────────────────

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const

export function supabaseUserData(client: SupabaseClient): UserDataApi {
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`)
  }
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<DbResult<T>> {
      const { data, error } = await client.rpc(fn, args)
      return { data: (data ?? null) as T | null, error: error ? { message: error.message, code: error.code, hint: error.hint ?? undefined } : null }
    },
    async getWorkItem(id) {
      const { data, error } = await client.from("work_items").select("id,organization_id,kind,title,status,brief").eq("id", id).maybeSingle()
      fail("work_items", error)
      return (data as WorkItemRow | null) ?? null
    },
    async listWorkItemDocuments(workItemId) {
      const { data, error } = await client
        .from("content_documents")
        .select("id,organization_id,work_item_id,platform,title,status,revision")
        .eq("work_item_id", workItemId)
        .order("updated_at", { ascending: false })
        .limit(20)
      fail("content_documents", error)
      return (data as DocumentRow[] | null) ?? []
    },
    async getDocument(id) {
      const { data, error } = await client
        .from("content_documents")
        .select("id,organization_id,work_item_id,platform,title,status,revision,body")
        .eq("id", id)
        .maybeSingle()
      fail("content_documents", error)
      if (!data) return null
      const row = data as DocumentRow
      return { ...row, body: (row.body ?? "").slice(0, 500) }
    },
  }
}

/** One user-scoped client per request: publishable key + `Authorization: Bearer <user JWT>`. */
export function createSupabaseUserDataFactory(supabaseUrl: string, publishableKey: string): (accessToken: string) => UserDataApi {
  return (accessToken) =>
    supabaseUserData(
      createClient(supabaseUrl, publishableKey, {
        auth: NO_SESSION,
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
    )
}

/** Verifies a Supabase access token with the Auth server (getUser checks signature, expiry and revocation). */
export function createSupabaseUserVerifier(supabaseUrl: string, publishableKey: string): (token: string) => Promise<VerifiedUser | null> {
  const client = createClient(supabaseUrl, publishableKey, { auth: NO_SESSION })
  return async (token) => {
    const { data, error } = await client.auth.getUser(token)
    if (error || !data.user || data.user.is_anonymous) return null
    return { id: data.user.id }
  }
}

// ── Tests / demos: raw SQL run as the user (PGlite harness `db.asUser`) ─────────────────────────────

const IDENT = /^[a-z_][a-z0-9_]*$/

function toDbError(error: unknown): DbError {
  const e = error as { message?: string; code?: string; hint?: string }
  return { message: e?.message ?? String(error), ...(e?.code ? { code: e.code } : {}), ...(e?.hint ? { hint: e.hint } : {}) }
}

/** `run` executes the callback inside a transaction with the user's JWT claims and the authenticated role. */
export function sqlUserData(run: <T>(fn: (sql: SqlExecutor) => Promise<T>) => Promise<T>): UserDataApi {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<DbResult<T>> {
      if (!IDENT.test(fn)) return { data: null, error: { message: "invalid function name" } }
      const keys = Object.keys(args).filter((k) => IDENT.test(k))
      try {
        return await run(async (sql) => {
          const r = await sql.query<{ r: unknown }>(`select to_jsonb(public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})) as r`, keys.map((k) => args[k]))
          return { data: (r.rows[0]?.r ?? null) as T | null, error: null }
        })
      } catch (error) {
        return { data: null, error: toDbError(error) }
      }
    },
    getWorkItem: (id) =>
      run(async (sql) => (await sql.query<WorkItemRow>("select id, organization_id, kind, title, status, brief from public.work_items where id::text = $1", [id])).rows[0] ?? null),
    listWorkItemDocuments: (workItemId) =>
      run(async (sql) =>
        (await sql.query<DocumentRow>(
          "select id, organization_id, work_item_id, platform, title, status, revision from public.content_documents where work_item_id::text = $1 order by updated_at desc limit 20",
          [workItemId],
        )).rows),
    getDocument: (id) =>
      run(async (sql) =>
        (await sql.query<DocumentRow>(
          "select id, organization_id, work_item_id, platform, title, status, revision, left(body, 500) as body from public.content_documents where id::text = $1",
          [id],
        )).rows[0] ?? null),
  }
}

// ── Node side ─────────────────────────────────────────────────────────────────────────────────────

/** The claimed agent_jobs row (to_jsonb). */
export interface ClaimedChatJob {
  id: string
  organization_id: string
  kind: string
  status: string
  lease_epoch: number | string
  created_by: string | null
  payload: Record<string, unknown>
  work_item_id: string | null
}

export interface ChatContextMessage {
  id: string
  seq: number
  role: string
  content: string
  parts: unknown[]
  status: string
  reply_to_message_id: string | null
}

/** node_chat_context: { turn, session, messages, work_item, documents } (DB3b). */
export interface NodeChatContext {
  turn: {
    job_id: string
    user_message_id: string
    seq: number
    runtime: Record<string, unknown> | null
    limits: Record<string, unknown> | null
    target_node_id: string | null
    regenerate: boolean
  }
  session: {
    id: string
    title: string
    work_item_id: string | null
    exec_session: Record<string, unknown> | null
    runtime_config: Record<string, unknown> | null
    last_seq: number
  }
  messages: ChatContextMessage[]
  work_item: { id: string; kind: string; title: string; brief: unknown; status: string } | null
  documents: Array<{ id: string; platform: string; title: string; status: string; revision: number; excerpt: string; updated_at: string }>
}

/** node_append_chat_message returns { message_id, seq, status, job_status, existing }; existing: true is success. */
export interface AppendChatResult {
  message_id: string
  seq: number
  status: string
  job_status: string
  existing: boolean
}

export interface AppendChatInput {
  jobId: string
  leaseEpoch: number
  content: string
  execSession: Record<string, unknown> | null
  parts: unknown[]
  status: "completed" | "cancelled" | "error"
  title: string | null
}

export interface NodeChatApi {
  /** null = already taken, cancelled, expired or targeted at another node (→ 409 claim_failed). */
  claimJob(jobId: string, leaseSeconds: number): Promise<ClaimedChatJob | null>
  chatContext(jobId: string, limit?: number): Promise<NodeChatContext>
  heartbeat(jobId: string, leaseEpoch: number, leaseSeconds: number): Promise<{ ok: boolean; cancelRequested: boolean }>
  recordUsageStep(jobId: string, leaseEpoch: number, usage: Record<string, unknown>, output: Record<string, unknown>): Promise<void>
  appendChatMessage(input: AppendChatInput): Promise<AppendChatResult>
  reportCapabilities(capabilities: Record<string, unknown>): Promise<void>
}

async function nodeCall<T>(rpc: RpcCall, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args)
  if (error) throw new DbCallError(fn, error)
  return data as T
}

/** node_* RPCs with the node token (publishable key, anon role), like NodeBackend. */
export class NodeChatBackend implements NodeChatApi {
  private readonly rpc: RpcCall
  private readonly token: string
  constructor(rpc: RpcCall, token: string) {
    this.rpc = rpc
    this.token = token
  }

  async claimJob(jobId: string, leaseSeconds: number) {
    return (await nodeCall<ClaimedChatJob | null>(this.rpc, "node_claim_job", { p_token: this.token, p_job_id: jobId, p_lease_seconds: leaseSeconds })) ?? null
  }

  chatContext(jobId: string, limit = 40) {
    return nodeCall<NodeChatContext>(this.rpc, "node_chat_context", { p_token: this.token, p_job_id: jobId, p_limit: limit })
  }

  async heartbeat(jobId: string, leaseEpoch: number, leaseSeconds: number) {
    const data = await nodeCall<{ ok: boolean; cancel_requested: boolean } | null>(this.rpc, "node_heartbeat", {
      p_token: this.token, p_job_id: jobId, p_lease_epoch: leaseEpoch, p_lease_seconds: leaseSeconds,
    })
    return { ok: Boolean(data?.ok), cancelRequested: Boolean(data?.cancel_requested) }
  }

  async recordUsageStep(jobId: string, leaseEpoch: number, usage: Record<string, unknown>, output: Record<string, unknown>) {
    await nodeCall(this.rpc, "node_record_step", {
      p_token: this.token, p_job_id: jobId, p_lease_epoch: leaseEpoch, p_kind: "generate", p_status: "succeeded", p_output: output, p_usage: usage, p_error: null,
    })
  }

  appendChatMessage(input: AppendChatInput) {
    return nodeCall<AppendChatResult>(this.rpc, "node_append_chat_message", {
      p_token: this.token,
      p_job_id: input.jobId,
      p_lease_epoch: input.leaseEpoch,
      p_content: input.content,
      p_exec_session: input.execSession,
      p_parts: input.parts,
      p_status: input.status,
      p_finish: true,
      p_title: input.title,
    })
  }

  async reportCapabilities(capabilities: Record<string, unknown>) {
    await nodeCall(this.rpc, "node_report_capabilities", { p_token: this.token, p_capabilities: capabilities })
  }
}
