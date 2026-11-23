import { describe, expect, it } from 'vitest'
import { isLiveOnSite, sitePublishMetaSchema } from '@/contracts/site-publish'
import { siteError } from '@/services/site-publish-service'

describe('site publish contract', () => {
  it('accepts display metadata with safe defaults', () => {
    const parsed = sitePublishMetaSchema.parse({ slug: 'Agent-Basics', summary: '摘要' })
    expect(parsed).toMatchObject({ slug: 'agent-basics', format: 'article', media: [], source_refs: [] })
  })
  it('rejects unsafe urls and incomplete media', () => {
    expect(sitePublishMetaSchema.safeParse({ slug: 'a', summary: 's', cover_url: 'javascript:alert(1)', cover_alt: 'x' }).success).toBe(false)
    expect(sitePublishMetaSchema.safeParse({ slug: 'a', summary: 's', cover_url: 'https://cdn.example/c.png' }).success).toBe(false)
    expect(sitePublishMetaSchema.safeParse({ slug: 'a', summary: 's', format: 'video' }).success).toBe(false)
    expect(sitePublishMetaSchema.safeParse({ slug: 'a b', summary: 's' }).success).toBe(false)
    expect(sitePublishMetaSchema.safeParse({ slug: 'a', summary: 's', media: [{ kind: 'image', url: 'https://cdn.example/a.png' }] }).success).toBe(false)
  })
  it('is live only while published_at is set', () => {
    expect(isLiveOnSite({ published_at: '2026-11-26T00:00:00Z' })).toBe(true)
    expect(isLiveOnSite({ published_at: null })).toBe(false)
    expect(isLiveOnSite({})).toBe(false)
  })
  it('maps database errors without leaking internals', () => {
    expect(() => siteError({ code: '42501', message: 'x' })).toThrow('发布权限')
    expect(() => siteError({ code: 'P0001', message: '仅可发布当前已人工审核通过的版本' })).toThrow('仅可发布当前已人工审核通过的版本')
    expect(() => siteError({ code: 'XX000', message: 'internal relation' })).toThrow('发布操作未完成')
  })
})
