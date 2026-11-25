import { sitePublishMetaSchema, type SitePublishMetaInput, type SitePublishResult, type SiteUnpublishResult } from '@/contracts/site-publish'
import { getSupabaseClient } from '@/lib/supabase'
import { mapApprovalRequest, type ApprovalRequest } from '@/contracts/agent-job'
import { createApprovalRequest, decideApprovalRequest } from '@/services/agent-job-service'

// Writes go only through the security-reviewed RPCs; the published_* columns cannot be written directly.
function db() {
  const client = getSupabaseClient()
  if (!client) throw new Error('请先配置云端连接。')
  return client
}

export function siteError(error: { message: string; code?: string } | null) {
  if (!error) return
  if (error.code === '42501') throw new Error('当前账号没有发布权限，或稿件不属于该组织。')
  if (error.code === 'MD001' || error.code === 'MD002') throw new Error(error.message)
  if (error.code === '23505') throw new Error('链接标识已被其他稿件使用。')
  if (error.code === 'P0001' || error.code === '22023' || error.code === 'P0002') throw new Error(error.message)
  throw new Error('发布操作未完成，请检查网络与数据库迁移。')
}

/** Copy an approved revision to the reader site (published_* columns). Requires content.publish + an approval. */
export async function publishDocument(documentId: string, revision: number, meta: SitePublishMetaInput): Promise<SitePublishResult> {
  const parsed = sitePublishMetaSchema.safeParse(meta)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '发布参数无效')
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('请选择已审核通过的版本')
  const { data, error } = await db().rpc('publish_document', { p_document_id: documentId, p_revision: revision, p_meta: parsed.data })
  siteError(error)
  return data as SitePublishResult
}

/** Take a document off the reader site. The snapshot and audit history stay; this is a state change. */
export async function unpublishDocument(documentId: string, note = ''): Promise<SiteUnpublishResult> {
  if (note.length > 1000) throw new Error('下线说明不超过 1000 字。')
  const { data, error } = await db().rpc('unpublish_document', { p_document_id: documentId, p_note: note })
  siteError(error)
  return data as SiteUnpublishResult
}

/** Mandate requests for publishing one document, newest first. */
export async function listSitePublishApprovals(documentId: string): Promise<ApprovalRequest[]> {
  const { data, error } = await db().from('approval_requests').select('*').eq('action', 'publish_site').eq('target_type', 'content_document').eq('target_id', documentId).order('created_at', { ascending: false }).limit(30)
  siteError(error)
  return (data ?? []).map(mapApprovalRequest)
}

/** Ask a human with content.publish to approve publishing this exact revision. */
export function requestSitePublishApproval(input: { organizationId: string; documentId: string; revision: number; slug: string; summary?: string }) {
  return createApprovalRequest({
    organizationId: input.organizationId, action: 'publish_site', targetType: 'content_document', targetId: input.documentId,
    targetRevision: input.revision, summary: input.summary ?? `发布到读者站：${input.slug}`, payload: { slug: input.slug },
  })
}
export const decideSitePublishApproval = decideApprovalRequest

/**
 * Solo-friendly 1-click publish: validates metadata first, ensures an approved Mandate row for
 * (documentId, revision) exists (request + decide as the current user), then calls publish_document.
 * The MD001/MD002 gates stay in the database.
 */
export async function publishWithApproval(input: {
  organizationId: string
  documentId: string
  revision: number
  meta: SitePublishMetaInput
  existingApproval?: ApprovalRequest | null
}): Promise<SitePublishResult> {
  const parsed = sitePublishMetaSchema.safeParse(input.meta)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '发布参数无效')
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('请选择已审核通过的版本')

  const existing = input.existingApproval
  const sameRevision = existing && existing.targetRevision === input.revision
  const validApproved = sameRevision && existing.status === 'approved' && Date.parse(existing.expiresAt) > Date.now()
  if (!validApproved) {
    if (sameRevision && existing.status === 'pending') {
      await decideSitePublishApproval(existing.id, 'approved')
    } else {
      const req = await requestSitePublishApproval({
        organizationId: input.organizationId, documentId: input.documentId, revision: input.revision,
        slug: parsed.data.slug, summary: parsed.data.summary,
      })
      await decideSitePublishApproval(req.id, 'approved')
    }
  }
  return publishDocument(input.documentId, input.revision, parsed.data)
}
