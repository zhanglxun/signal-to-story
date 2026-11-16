import type { DecisionMemoryKind } from "@/contracts/agent-harness"
import type { DecisionMemoryInput, DecisionMemoryRecord, DecisionMemorySource } from "@/contracts/decision-memory"
import { MEMORY_QUOTE_MAX, MEMORY_SUMMARY_MAX } from "@/contracts/decision-memory"
import { selectScopedMemories } from "@/harness/context-pack"
import { getSupabaseClient } from "@/lib/supabase"

function db() {
  const client = getSupabaseClient()
  if (!client) throw new Error("Supabase 未配置")
  return client
}

function fail(error: { message: string; code?: string } | null) {
  if (!error) return
  if (error.code === "42501") throw new Error("当前账号没有管理决定记忆的权限（需要 content.manage）")
  throw new Error(error.message)
}

export function mapDecisionMemoryRow(row: Record<string, unknown>): DecisionMemoryRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    kind: row.kind as DecisionMemoryKind,
    summary: String(row.summary),
    humanQuote: String(row.human_quote ?? ""),
    recordedAt: String(row.created_at),
    active: Boolean(row.active),
    platform: (row.platform as string | null) ?? null,
    contentKind: (row.content_kind as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    source: row.source as DecisionMemorySource,
    sourceRef: (row.source_ref as string | null) ?? null,
    createdBy: String(row.created_by),
    updatedAt: String(row.updated_at),
  }
}

export type MemoryStatusFilter = "all" | "active" | "inactive" | "expired"

export function memoryStatus(memory: Pick<DecisionMemoryRecord, "active" | "expiresAt">, now = new Date()): Exclude<MemoryStatusFilter, "all"> {
  if (!memory.active) return "inactive"
  if (memory.expiresAt && new Date(memory.expiresAt).getTime() <= now.getTime()) return "expired"
  return "active"
}

export interface ListDecisionMemoriesOptions {
  kind?: DecisionMemoryKind
  status?: MemoryStatusFilter
  /** Only memories that would apply to this platform/content kind (global ones included). */
  scope?: { platform: string; contentKind?: string | null }
}

export async function listDecisionMemories(organizationId: string, options: ListDecisionMemoriesOptions = {}): Promise<DecisionMemoryRecord[]> {
  let query = db().from("decision_memories").select("*").eq("organization_id", organizationId)
  if (options.kind) query = query.eq("kind", options.kind)
  const { data, error } = await query.order("created_at", { ascending: false }).limit(500)
  fail(error)
  let rows = (data ?? []).map(mapDecisionMemoryRow)
  const status = options.status ?? "all"
  if (status !== "all") rows = rows.filter((m) => memoryStatus(m) === status)
  if (options.scope) {
    // Same rule the Context Pack uses; limit lifted so the manager sees everything that would apply.
    rows = selectScopedMemories({ organizationId, platform: options.scope.platform, contentKind: options.scope.contentKind, memories: rows, limit: 100 }) as DecisionMemoryRecord[]
  }
  return rows
}

export async function createDecisionMemory(input: DecisionMemoryInput): Promise<DecisionMemoryRecord> {
  const summary = input.summary.trim()
  if (!summary) throw new Error("摘要不能为空")
  if (summary.length > MEMORY_SUMMARY_MAX) throw new Error(`摘要不能超过 ${MEMORY_SUMMARY_MAX} 字`)
  const { data, error } = await db()
    .from("decision_memories")
    .insert({
      organization_id: input.organizationId,
      kind: input.kind,
      summary,
      human_quote: (input.humanQuote ?? "").slice(0, MEMORY_QUOTE_MAX),
      platform: input.platform ?? null,
      content_kind: input.contentKind ?? null,
      expires_at: input.expiresAt ?? null,
      source: input.source ?? "manual",
      source_ref: input.sourceRef ?? null,
    })
    .select("*")
    .single()
  fail(error)
  return mapDecisionMemoryRow(data as Record<string, unknown>)
}

export interface DecisionMemoryPatch {
  summary?: string
  humanQuote?: string
  active?: boolean
  /** null clears the expiry. */
  expiresAt?: string | null
}

export async function updateDecisionMemory(id: string, patch: DecisionMemoryPatch): Promise<DecisionMemoryRecord> {
  const row: Record<string, unknown> = {}
  if (patch.summary !== undefined) {
    const summary = patch.summary.trim()
    if (!summary || summary.length > MEMORY_SUMMARY_MAX) throw new Error(`摘要需要 1-${MEMORY_SUMMARY_MAX} 字`)
    row.summary = summary
  }
  if (patch.humanQuote !== undefined) row.human_quote = patch.humanQuote.slice(0, MEMORY_QUOTE_MAX)
  if (patch.active !== undefined) row.active = patch.active
  if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt
  const { data, error } = await db().from("decision_memories").update(row).eq("id", id).select("*").single()
  fail(error)
  return mapDecisionMemoryRow(data as Record<string, unknown>)
}

export const setDecisionMemoryActive = (id: string, active: boolean) => updateDecisionMemory(id, { active })
export const setDecisionMemoryExpiry = (id: string, expiresAt: string | null) => updateDecisionMemory(id, { expiresAt })
