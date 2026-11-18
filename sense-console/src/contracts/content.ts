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
  id: string; organization_id: string; work_item_id: string | null;
  /** 只有 V1 遗留稿件有值；新稿件只写 work_item_id。 */
  project_id: string | null; platform: Platform | 'master'; title: string;
  body: string; revision: number; status: DocumentStatus; review_note: string; updated_at: string
}
export type Revision = { id: string; document_id: string; revision: number; title: string; body: string; created_at: string; created_by: string }
export type ReviewEvent = { id: string; revision: number; status: DocumentStatus; note: string; created_at: string; created_by: string }
export type PublishingChannel = { id: string; organization_id: string; platform: Platform; name: string; profile_url: string }
export type Publication = {
  id: string; organization_id: string; document_id: string; revision: number; channel_id: string;
  title_snapshot?: string; scheduled_at: string; status: 'planned' | 'published' | 'cancelled'; published_url: string; published_at: string | null; invalidated_at?: string | null; video_asset_id?: number | null
}
export type Metric = { id: string; publication_id: string; observed_at: string; views: number | null; likes: number | null; saves: number | null; comments: number | null; retrospective: string }
export const urlSchema = z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol), '请填写 http 或 https 链接')
export function optionalCount(value: string): number | null {
  if (!value.trim()) return null
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('指标必须为非负整数；未知请留空。')
  return count
}
export function exportMarkdown(document: Pick<ContentDocument, 'title' | 'body' | 'revision' | 'platform'>) {
  const destination = document.platform === 'master' ? '母稿' : platforms[document.platform]
  return `# ${document.title}\n\n> 星火工厂 · ${destination} · 版本 ${document.revision}\n\n${document.body}\n`
}
export function canTransition(from: DocumentStatus, to: DocumentStatus, canEdit: boolean, canReview: boolean) {
  if (to === 'in_review') return canEdit && (from === 'draft' || from === 'changes_requested')
  return canReview && from === 'in_review' && (to === 'approved' || to === 'changes_requested')
}
