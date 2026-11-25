import { describe, expect, it } from 'vitest'
import { canTransition, urlSchema } from '@/contracts/content'

describe('content workflow boundaries', () => {
  it('requires the appropriate permission and an in-review version for approval', () => {
    expect(canTransition('draft', 'approved', true, true)).toBe(false)
    expect(canTransition('in_review', 'approved', true, false)).toBe(false)
    expect(canTransition('in_review', 'approved', false, true)).toBe(true)
    expect(canTransition('changes_requested', 'in_review', true, false)).toBe(true)
    expect(canTransition('approved', 'in_review', true, true)).toBe(false)
  })
  it('rejects unsafe publication links', () => {
    expect(urlSchema.safeParse('javascript:alert(1)').success).toBe(false)
    expect(urlSchema.safeParse('https://example.com/post').success).toBe(true)
  })
})
