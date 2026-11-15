import { describe, expect, it } from 'vitest'
import { isLiveRelease, sitePublishMetaSchema } from '@/contracts/site-publish'
import { siteError } from '@/services/site-publish-service'

describe('site publish contract', () => {
  it('accepts display metadata with safe defaults', () => {
    const parsed = sitePublishMetaSchema.parse({ slug: 'Agent-Basics', summary: '摘要' })
    expect(parsed).toMatchObject({ slug: 'agent-basics', access_level: 'public', format: 'article', media: [], source_refs: [] })
  })
  it('rejects paid levels, unsafe urls and incomplete media', () => {
    expect(sitePublishMetaSchema.safeParse({ slug: 'a', summary: 's', access_level: 'member' }).success).toBe(false)
    expect(sitePublishMetaSchema.safeParse({ slug: 'a', summary: 's', cover_url: 'javascript:alert(1)', cover_alt: 'x' }).success).toBe(false)
    expect(sitePublishMetaSchema.safeParse({ slug: 'a', summary: 's', cover_url: 'https://cdn.example/c.png' }).success).toBe(false)
    expect(sitePublishMetaSchema.safeParse({ slug: 'a', summary: 's', format: 'video' }).success).toBe(false)
    expect(sitePublishMetaSchema.safeParse({ slug: 'a b', summary: 's' }).success).toBe(false)
    expect(sitePublishMetaSchema.safeParse({ slug: 'a', summary: 's', media: [{ kind: 'image', url: 'https://cdn.example/a.png' }] }).success).toBe(false)
  })
  it('only marks the current online version as live', () => {
    const entry = { id: 'e', slug: 's', status: 'online' as const, current_version: 2, access_level: 'public' as const }
    expect(isLiveRelease({ version: 2, entry })).toBe(true)
    expect(isLiveRelease({ version: 1, entry })).toBe(false)
    expect(isLiveRelease({ version: 2, entry: { ...entry, status: 'offline' } })).toBe(false)
  })
  it('maps database errors without leaking internals', () => {
    expect(() => siteError({ code: '42501', message: 'x' })).toThrow('站点发布权限')
    expect(() => siteError({ code: 'P0001', message: '仅可发布当前已人工审核通过的版本' })).toThrow('仅可发布当前已人工审核通过的版本')
    expect(() => siteError({ code: 'XX000', message: 'internal relation' })).toThrow('站点操作未完成')
  })
})
