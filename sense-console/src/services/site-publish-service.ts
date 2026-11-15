import { sitePublishMetaSchema, type SitePublishMetaInput, type SitePublishResult, type SiteRelease, type SiteSettings, type SiteUnpublishResult } from '@/contracts/site-publish'
import { getSupabaseClient } from '@/lib/supabase'
import { mapApprovalRequest, type ApprovalRequest } from '@/contracts/agent-job'
import { createApprovalRequest, decideApprovalRequest } from '@/services/agent-job-service'

// Writes go only through the security-reviewed RPCs; there is no direct table write path.
function db() {
  const client = getSupabaseClient()
  if (!client) throw new Error('请先配置云端连接。')
  return client
}

export function siteError(error: { message: string; code?: string } | null) {
  if (!error) return
  if (error.code === '42501') throw new Error('当前账号没有站点发布权限，或稿件不属于该组织。')
  if (error.code === 'MD001' || error.code === 'MD002') throw new Error(error.message)
  if (error.code === '23505') throw new Error('站点链接标识已被其他内容使用。')
  if (error.code === 'P0001' || error.code === '22023' || error.code === 'P0002') throw new Error(error.message)
  throw new Error('站点操作未完成，请检查网络与数据库迁移。')
}

export async function listSites(organizationId: string): Promise<SiteSettings[]> {
  const { data, error } = await db().from('site_settings').select('id,organization_id,slug,name,description,base_url,status').eq('organization_id', organizationId).order('created_at')
  siteError(error)
  return (data ?? []) as SiteSettings[]
}

/** Publish (or replace) the reader-site snapshot of an approved revision. Requires content.publish. */
export async function publishToSite(siteId: string, documentId: string, revision: number, meta: SitePublishMetaInput): Promise<SitePublishResult> {
  const parsed = sitePublishMetaSchema.safeParse(meta)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '发布参数无效')
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('请选择已审核通过的版本')
  const { data, error } = await db().rpc('publish_site_entry', { p_site_id: siteId, p_document_id: documentId, p_revision: revision, p_meta: parsed.data })
  siteError(error)
  return data as SitePublishResult
}

/** Take an entry offline. Snapshots and audit history are kept; this is a state change, not a delete. */
export async function unpublishFromSite(entryId: string, note = ''): Promise<SiteUnpublishResult> {
  if (note.length > 1000) throw new Error('下线说明不超过 1000 字。')
  const { data, error } = await db().rpc('unpublish_site_entry', { p_entry_id: entryId, p_note: note })
  siteError(error)
  return data as SiteUnpublishResult
}

type ReleaseRow = Omit<SiteRelease, 'entry'> & { site_entries: SiteRelease['entry'] | SiteRelease['entry'][] }

// Explicit FK hint: site_entries also references releases via current_release_id.
/** All site snapshots created from one document, newest first, with the entry's live status. */
export async function listSiteReleasesForDocument(documentId: string): Promise<SiteRelease[]> {
  const { data, error } = await db()
    .from('site_entry_releases')
    .select('id,site_id,entry_id,version,source_document_id,source_revision,source_platform,title,display_meta,published_by,published_at,site_entries!site_entry_releases_entry_fkey(id,slug,status,current_version,access_level)')
    .eq('source_document_id', documentId)
    .order('published_at', { ascending: false })
    .order('version', { ascending: false })
  siteError(error)
  return ((data ?? []) as unknown as ReleaseRow[]).map(({ site_entries, ...row }) => ({
    ...row,
    entry: Array.isArray(site_entries) ? (site_entries[0] ?? null) : site_entries,
  }))
}

export type SiteCategory = { id: string; name: string }
export async function listSiteCategories(siteId: string): Promise<SiteCategory[]> {
  const { data, error } = await db().from('site_categories').select('id,name').eq('site_id', siteId).eq('enabled', true).order('name')
  siteError(error)
  return (data ?? []) as SiteCategory[]
}

/** Mandate requests for publishing one document to a site, newest first. */
export async function listSitePublishApprovals(documentId: string): Promise<ApprovalRequest[]> {
  const { data, error } = await db().from('approval_requests').select('*').eq('action', 'publish_site').eq('target_type', 'content_document').eq('target_id', documentId).order('created_at', { ascending: false }).limit(30)
  siteError(error)
  return (data ?? []).map(mapApprovalRequest)
}

/** Ask a human with content.publish to approve publishing this exact revision to this site. */
export function requestSitePublishApproval(input: { organizationId: string; siteId: string; documentId: string; revision: number; slug: string; summary?: string }) {
  return createApprovalRequest({
    organizationId: input.organizationId, action: 'publish_site', targetType: 'content_document', targetId: input.documentId,
    targetRevision: input.revision, summary: input.summary ?? `发布到读者站：${input.slug}`, payload: { site_id: input.siteId, slug: input.slug },
  })
}
export const decideSitePublishApproval = decideApprovalRequest
