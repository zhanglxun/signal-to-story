import { getSupabaseClient } from '@/lib/supabase'
import { projectInputSchema, urlSchema, type ContentDocument, type ContentProject, type DocumentStatus, type Metric, type Platform, type ProjectInput, type Publication, type PublishingChannel, type ReviewEvent, type Revision } from '@/contracts/content'

function db() {
  const client = getSupabaseClient()
  if (!client) throw new Error('请先配置云端连接。')
  return client
}
function fail(error: { message: string; code?: string } | null) {
  if (!error) return
  if (error.code === '23505') throw new Error('该记录已存在，请刷新后查看。')
  if (error.code === '42501') throw new Error('当前账号没有执行此操作的权限。')
  if (error.code === 'P0001') throw new Error(error.message)
  throw new Error('云端操作未完成，请检查网络与数据库迁移。')
}
async function allRows<T>(table: string, organizationId: string, order: string, columns = '*') {
  const result: T[] = []
  // PostgREST caps individual responses. Fetch every page without silently truncating dashboards.
  for (let from = 0; ; from += 500) {
    const { data, error } = await db().from(table).select(columns).eq('organization_id', organizationId).order(order, { ascending: false }).order('id').range(from, from + 499)
    fail(error)
    result.push(...(data ?? []) as T[])
    if (!data || data.length < 500) return result
  }
}
export const listProjects = (org: string) => allRows<ContentProject>('content_projects', org, 'updated_at')
export const listDocuments = (org: string) => allRows<ContentDocument>('content_documents', org, 'updated_at')
export const listChannels = (org: string) => allRows<PublishingChannel>('publishing_channels', org, 'created_at')
export async function listPublications(org: string): Promise<Publication[]> {
  const rows = await allRows<Publication & { content_revisions: { title: string } }>('content_publications', org, 'scheduled_at', '*,content_revisions(title)')
  return rows.map(row => ({ ...row, title_snapshot: row.content_revisions.title }))
}
export const listMetrics = (org: string) => allRows<Metric>('publication_metrics', org, 'observed_at')
export async function createProject(org: string, input: ProjectInput, selectionId?: number) {
  const { data, error } = await db().from('content_projects').insert({ ...projectInputSchema.parse(input), organization_id: org, selection_id: selectionId ?? null }).select().single()
  fail(error); return data as ContentProject
}
export async function updateProject(project: ContentProject, input: ProjectInput) {
  const { data, error } = await db().from('content_projects').update(projectInputSchema.parse(input)).eq('id', project.id).eq('updated_at', project.updated_at).select().maybeSingle()
  fail(error); if (!data) throw new Error('项目已被其他成员修改，请刷新后重试。')
  return data as ContentProject
}
export async function getProject(id: string) {
  const { data, error } = await db().from('content_projects').select().eq('id', id).single()
  fail(error); return data as ContentProject
}
export async function getProjectDocuments(id: string) {
  const { data, error } = await db().from('content_documents').select().eq('project_id', id).order('created_at')
  fail(error); return (data ?? []) as ContentDocument[]
}
export async function createDocument(project: ContentProject, platform: Platform | 'master', source?: ContentDocument) {
  const { data, error } = await db().from('content_documents').insert({ organization_id: project.organization_id, project_id: project.id, platform, title: source?.title ?? project.title, body: source?.body ?? '' }).select().single()
  fail(error); return data as ContentDocument
}
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
export async function documentHistory(documentId: string) {
  const [revisions, reviews] = await Promise.all([
    db().from('content_revisions').select().eq('document_id', documentId).order('revision', { ascending: false }),
    db().from('content_review_events').select().eq('document_id', documentId).order('created_at', { ascending: false }),
  ])
  fail(revisions.error); fail(reviews.error)
  return { revisions: (revisions.data ?? []) as Revision[], reviews: (reviews.data ?? []) as ReviewEvent[] }
}
export async function createChannel(org: string, platform: Platform, name: string, profileUrl: string) {
  if (!name.trim() || name.trim().length > 100) throw new Error('账号名称需为 1–100 字。')
  if (profileUrl.trim()) urlSchema.parse(profileUrl.trim())
  const { error } = await db().from('publishing_channels').insert({ organization_id: org, platform, name: name.trim(), profile_url: profileUrl.trim() })
  fail(error)
}
export async function planPublication(document: ContentDocument, channelId: string, scheduledAt: string) {
  if (document.status !== 'approved') throw new Error('请先审核对应的平台稿件。')
  const { error } = await db().from('content_publications').insert({ organization_id: document.organization_id, document_id: document.id, revision: document.revision, channel_id: channelId, scheduled_at: new Date(scheduledAt).toISOString() })
  fail(error)
}
export async function recordPublication(publication: Publication, url: string, publishedAt: string) {
  const { error } = await db().from('content_publications').update({ status: 'published', published_url: urlSchema.parse(url.trim()), published_at: new Date(publishedAt).toISOString() }).eq('id', publication.id).eq('status', 'planned').select().single()
  fail(error)
}
export async function cancelPublication(id: string) {
  const { error } = await db().from('content_publications').update({ status: 'cancelled' }).eq('id', id).eq('status', 'planned').select().single()
  fail(error)
}
export async function saveMetric(publication: Publication, metric: Omit<Metric, 'id' | 'publication_id'>) {
  const { error } = await db().from('publication_metrics').insert({ ...metric, organization_id: publication.organization_id, publication_id: publication.id })
  fail(error)
}
export async function linkedAssets(projectId: string) {
  const { data, error } = await db().from('content_project_assets').select('asset_id, assets(id,name,media_type,cloud_url)').eq('project_id', projectId)
  fail(error)
  return (data ?? []) as unknown as { asset_id: number; assets: { id: number; name: string; media_type: string; cloud_url: string | null } }[]
}
export async function linkAsset(project: ContentProject, assetId: number) {
  const { error } = await db().from('content_project_assets').insert({ organization_id: project.organization_id, project_id: project.id, asset_id: assetId })
  fail(error)
}
export async function publicationSnapshot(publication: Publication) {
  const { data, error } = await db().from('content_revisions').select().eq('document_id', publication.document_id).eq('revision', publication.revision).single()
  fail(error); return data as Revision
}

export type AiProposal = { id: string; input_revision: number; model: string; status: 'running' | 'succeeded' | 'failed'; body: string | null; error: string | null; created_at: string; usage: { total_tokens?: number } | null }
export async function getAiProposals(documentId: string) {
  const { data, error } = await db().from('content_ai_proposals').select('*').eq('document_id', documentId).order('created_at', { ascending: false }).limit(20)
  fail(error); return (data ?? []) as AiProposal[]
}
export async function generateDraft(documentId: string, instruction: string) {
  const { data, error } = await db().functions.invoke('content-draft', { body: { document_id: documentId, instruction } })
  if (error) {
    let message = '生成未完成，请稍后查看提案或检查模型配置。'
    if (error.context instanceof Response) {
      const detail = await error.context.json().catch(() => null)
      if (typeof detail?.error === 'string') message = detail.error
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
}
