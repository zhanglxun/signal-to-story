import { getSupabaseClient } from '@/lib/supabase'
import { urlSchema, type ContentDocument, type DocumentHistoryEvent, type DocumentStatus } from '@/contracts/content'

export function db() {
  const client = getSupabaseClient()
  if (!client) throw new Error('请先配置云端连接。')
  return client
}
export function fail(error: { message: string; code?: string } | null) {
  if (!error) return
  if (error.code === '23505') throw new Error('该记录已存在，请刷新后查看。')
  if (error.code === '42501') throw new Error('当前账号没有执行此操作的权限。')
  if (error.code === 'P0001') throw new Error(error.message)
  throw new Error('云端操作未完成，请检查网络与数据库迁移。')
}
export async function allRows<T>(table: string, organizationId: string, order: string, columns = '*') {
  const result: T[] = []
  // PostgREST caps individual responses. Fetch every page without silently truncating dashboards.
  for (let from = 0; ; from += 500) {
    const { data, error } = await db().from(table).select(columns).eq('organization_id', organizationId).order(order, { ascending: false }).order('id').range(from, from + 499)
    fail(error)
    result.push(...(data ?? []) as T[])
    if (!data || data.length < 500) return result
  }
}
export const listDocuments = (org: string) => allRows<ContentDocument>('content_documents', org, 'updated_at')
export async function saveDocument(document: ContentDocument, title: string, body: string) {
  if (!title.trim() || title.trim().length > 200 || body.length > 100000) throw new Error('标题需为 1–200 字，正文不超过 100000 字。')
  const { data, error } = await db().from('content_documents').update({ title: title.trim(), body }).eq('id', document.id).eq('revision', document.revision).eq('status', document.status).select().maybeSingle()
  fail(error); if (!data) throw new Error('稿件已被其他成员更新。当前输入已保留，请复制后刷新并合并。')
  return data as ContentDocument
}
export async function reviewDocument(document: ContentDocument, status: DocumentStatus, reviewNote: string) {
  const { data, error } = await db().from('content_documents').update({ status, review_note: reviewNote }).eq('id', document.id).eq('revision', document.revision).eq('status', document.status).select().maybeSingle()
  fail(error); if (!data) throw new Error('审核对象已变化，请刷新后重新审核。')
  return data as ContentDocument
}
/** Solo-friendly direct approval: walks draft/changes_requested -> in_review -> approved while obeying DB triggers. */
export async function approveDocumentDirectly(document: ContentDocument, reviewNote = '') {
  if (document.status === 'in_review') return reviewDocument(document, 'approved', reviewNote)
  const submitted = await reviewDocument(document, 'in_review', '')
  return reviewDocument(submitted, 'approved', reviewNote)
}
/** Review / AI / publishing history of one document (audit_events; there is no revision snapshot table). */
export async function documentHistory(documentId: string): Promise<DocumentHistoryEvent[]> {
  const { data, error } = await db().from('audit_events').select('id,action,metadata,created_at,actor_user_id')
    .eq('target_type', 'content_document').eq('target_id', documentId).like('action', 'content.%')
    .order('created_at', { ascending: false }).limit(100)
  fail(error)
  return ((data ?? []) as Array<{ id: number; action: string; metadata: Record<string, unknown> | null; created_at: string; actor_user_id: string | null }>).map(row => ({
    id: Number(row.id), action: row.action, created_at: row.created_at, actor_user_id: row.actor_user_id,
    revision: typeof row.metadata?.revision === 'number' ? row.metadata.revision : null,
    note: typeof row.metadata?.note === 'string' ? row.metadata.note : '',
  }))
}
/** Record (or clear with '') the link of a manual publication on an external platform. Requires content.publish. */
export async function setPublishedUrl(documentId: string, url: string) {
  const value = url.trim()
  if (value) urlSchema.parse(value)
  const { error } = await db().rpc('set_document_published_url', { p_document_id: documentId, p_url: value })
  fail(error)
}
