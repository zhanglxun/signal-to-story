import { z } from 'zod'

export const platforms = {
  wechat_channels: '视频号', wechat_official: '公众号', xiaohongshu: '小红书',
  douyin: '抖音', x: 'X', youtube: 'YouTube', reddit: 'Reddit',
} as const
export type Platform = keyof typeof platforms
export const platformKeys = Object.keys(platforms) as Platform[]
export const statusLabels = { draft: '草稿', in_review: '待审核', approved: '已通过', changes_requested: '待修改' } as const
export type DocumentStatus = keyof typeof statusLabels
export type ContentDocument = {
  id: string; organization_id: string; work_item_id: string; platform: Platform | 'master'; title: string;
  body: string; revision: number; status: DocumentStatus; review_note: string; updated_at: string
  /** Reader-site snapshot (written only by publish_document); published_at null = not on the site. */
  published_revision?: number | null; published_title?: string | null; published_at?: string | null
  /** Link to the manual publication on an external platform ('' when none). */
  published_url?: string; slug?: string | null
}
/** One entry of a document's history, read from audit_events (content.<status>, content.published, …). */
export type DocumentHistoryEvent = { id: number; action: string; revision: number | null; note: string; created_at: string; actor_user_id: string | null }
export const historyActionLabels: Record<string, string> = {
  'content.draft': '草稿', 'content.in_review': '提交审核', 'content.approved': '审核通过', 'content.changes_requested': '退回修改',
  'content.ai_draft_written': 'AI 写入草稿', 'content.published': '发布到读者站', 'content.unpublished': '读者站下线', 'content.published_url': '登记发布链接',
}
export const urlSchema = z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol), '请填写 http 或 https 链接')
export function exportMarkdown(document: Pick<ContentDocument, 'title' | 'body' | 'revision' | 'platform'>) {
  const destination = document.platform === 'master' ? '母稿' : platforms[document.platform]
  return `# ${document.title}\n\n> 星火工厂 · ${destination} · 版本 ${document.revision}\n\n${document.body}\n`
}
export function canTransition(from: DocumentStatus, to: DocumentStatus, canEdit: boolean, canReview: boolean) {
  if (to === 'in_review') return canEdit && (from === 'draft' || from === 'changes_requested')
  return canReview && from === 'in_review' && (to === 'approved' || to === 'changes_requested')
}
