import { describe, expect, it } from 'vitest'
import { canTransition, optionalCount, projectInputSchema, urlSchema } from '@/contracts/content'

describe('content workflow boundaries', () => {
  it('preserves missing metrics separately from genuine zero observations', () => {
    expect(optionalCount('')).toBeNull()
    expect(optionalCount('  ')).toBeNull()
    expect(optionalCount('0')).toBe(0)
    expect(optionalCount('42')).toBe(42)
    for (const value of ['-1', '2.1', 'Infinity', 'text', '9007199254740992']) expect(() => optionalCount(value)).toThrow()
  })
  it('requires the appropriate permission and an in-review version for approval', () => {
    expect(canTransition('draft', 'approved', true, true)).toBe(false)
    expect(canTransition('in_review', 'approved', true, false)).toBe(false)
    expect(canTransition('in_review', 'approved', false, true)).toBe(true)
    expect(canTransition('changes_requested', 'in_review', true, false)).toBe(true)
    expect(canTransition('approved', 'in_review', true, true)).toBe(false)
  })
  it('rejects unsafe publication links and malformed project targets', () => {
    expect(urlSchema.safeParse('javascript:alert(1)').success).toBe(false)
    expect(urlSchema.safeParse('https://example.com/post').success).toBe(true)
    const input = { title: 'AI 知识', brief: '', content_kind: 'knowledge', target_seconds: 300, aspect_ratio: '9:16' }
    expect(projectInputSchema.safeParse(input).success).toBe(true)
    expect(projectInputSchema.safeParse({ ...input, title: ' ' }).success).toBe(false)
    expect(projectInputSchema.safeParse({ ...input, target_seconds: 0 }).success).toBe(false)
  })
})
