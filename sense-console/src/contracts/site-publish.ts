import { z } from 'zod'

// Back-office contract for publishing an approved revision to the reader site (sense-site).
// Mirrors public.publish_document / public.unpublish_document in
// supabase/migrations/20261126100000_publish_on_documents.sql. The database re-validates everything.
// The published snapshot lives on content_documents (published_* columns); there are no site_* tables.

export const siteFormats = { article: '文章', tutorial: '图文教程', video: '视频', comic: '漫画', resource: '资源' } as const
export type SiteFormat = keyof typeof siteFormats

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
  format: z.enum(['article', 'tutorial', 'video', 'comic', 'resource']).default('article'),
  cover_url: z.union([z.literal(''), httpsUrl]).default(''),
  cover_alt: z.string().trim().max(200).default(''),
  media: z.array(siteMediaSchema).max(20).default([]),
  source_refs: z.array(siteSourceRefSchema).max(50).default([]),
}).refine(m => !m.cover_url || Boolean(m.cover_alt), { message: '封面需填写替代文本', path: ['cover_alt'] })
  .refine(m => m.format !== 'video' || m.media.some(item => item.kind === 'video'), { message: '视频内容需要提供视频地址', path: ['media'] })

export type SitePublishMetaInput = z.input<typeof sitePublishMetaSchema>
export type SitePublishMeta = z.output<typeof sitePublishMetaSchema>

export type SitePublishResult = {
  document_id: string
  revision: number
  slug: string
  action: 'publish' | 'replace' | 'republish' | 'unchanged'
  unchanged: boolean
}
export type SiteUnpublishResult = { document_id: string; unchanged: boolean }

/** A document is live on the reader site while published_at is set. */
export function isLiveOnSite(doc: { published_at?: string | null }) {
  return Boolean(doc.published_at)
}
