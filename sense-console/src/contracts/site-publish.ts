import { z } from 'zod'

// Back-office contract for publishing approved revisions to the reader site (sense-site).
// Mirrors public.publish_site_entry / public.unpublish_site_entry in
// supabase/migrations/20261116100100_site_publish_functions.sql. The database re-validates everything.

export const siteAccessLevels = { public: '公开', registered: '注册可读' } as const
export const siteFormats = { article: '文章', tutorial: '图文教程', video: '视频', comic: '漫画', resource: '资源' } as const
export const siteColumns = { news: '资讯', analysis: '分析', how_to: '实操', case: '案例' } as const
export type SiteAccessLevel = keyof typeof siteAccessLevels
export type SiteFormat = keyof typeof siteFormats
export type SiteColumn = keyof typeof siteColumns

const httpsUrl = z.string().trim().max(2000).regex(/^https:\/\/[^\s<>"]+$/, '请填写 https 地址')
const slug = z.string().trim().toLowerCase().max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '仅允许小写字母、数字和连字符')

export const siteMediaSchema = z.object({
  kind: z.enum(['image', 'video']),
  url: httpsUrl,
  alt: z.string().trim().max(200).optional(),
  poster: httpsUrl.optional(),
  caption: z.string().trim().max(200).optional(),
}).refine(m => m.kind !== 'image' || Boolean(m.alt), '图片需填写替代文本')

export const siteSourceRefSchema = z.object({ title: z.string().trim().min(1).max(200), url: httpsUrl })

/** Only display metadata is accepted; title and body always come from the approved revision. */
export const sitePublishMetaSchema = z.object({
  slug,
  summary: z.string().trim().min(1, '请填写人工摘要').max(500),
  category_id: z.uuid().nullable().optional(),
  format: z.enum(['article', 'tutorial', 'video', 'comic', 'resource']).default('article'),
  column_key: z.enum(['news', 'analysis', 'how_to', 'case']).nullable().optional(),
  // v1 deliberately has no member / purchase level.
  access_level: z.enum(['public', 'registered']).default('public'),
  cover_url: z.union([z.literal(''), httpsUrl]).default(''),
  cover_alt: z.string().trim().max(200).default(''),
  media: z.array(siteMediaSchema).max(20).default([]),
  source_refs: z.array(siteSourceRefSchema).max(50).default([]),
}).refine(m => !m.cover_url || Boolean(m.cover_alt), { message: '封面需填写替代文本', path: ['cover_alt'] })
  .refine(m => m.format !== 'video' || m.media.some(item => item.kind === 'video'), { message: '视频内容需要提供视频地址', path: ['media'] })

export type SitePublishMetaInput = z.input<typeof sitePublishMetaSchema>
export type SitePublishMeta = z.output<typeof sitePublishMetaSchema>

export type SitePublishResult = {
  entry_id: string
  release_id: string
  version: number
  slug: string
  action: 'publish' | 'replace' | 'republish' | 'unchanged'
  unchanged: boolean
}
export type SiteUnpublishResult = { entry_id: string; status: 'offline'; unchanged: boolean }

export type SiteSettings = { id: string; organization_id: string; slug: string; name: string; description: string; base_url: string; status: 'draft' | 'online' | 'offline' }

/** One immutable snapshot of a source document on the reader site, with its entry's live status. */
export type SiteRelease = {
  id: string
  site_id: string
  entry_id: string
  version: number
  source_document_id: string
  source_revision: number
  source_platform: string
  title: string
  display_meta: SitePublishMeta
  published_by: string
  published_at: string
  entry: { id: string; slug: string; status: 'online' | 'offline'; current_version: number; access_level: SiteAccessLevel } | null
}

export const siteReleaseActionLabels = { publish: '首次上线', replace: '替换版本', republish: '重新上线', unpublish: '下线', unchanged: '无变化' } as const

/** Release is live only when its entry is online and points to this version. */
export function isLiveRelease(release: Pick<SiteRelease, 'version' | 'entry'>) {
  return release.entry?.status === 'online' && release.entry.current_version === release.version
}
