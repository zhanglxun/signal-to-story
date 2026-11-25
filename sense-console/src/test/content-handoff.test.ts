import { describe, expect, it } from 'vitest'
import { buildTextHandoff, textHandoffMarkdown } from '@/contracts/content-handoff'
import type { ContentDocument } from '@/contracts/content'
import type { WorkItem } from '@/contracts/work-item'

const doc = (over: Partial<ContentDocument>): ContentDocument => ({
  id: 'd', organization_id: 'o', work_item_id: 'w', platform: 'x', title: 'Title', body: 'Draft', revision: 2,
  status: 'in_review', review_note: '', updated_at: '2026-11-26T00:00:00Z', ...over,
})

describe('text production handoff', () => {
  it('carries the work item brief text into the rehearsal', () => {
    const item = { id: 'w', title: 'Topic', brief: { text: 'No invented clinical claims', legacy: { selection_id: 1 } } } as unknown as WorkItem
    const handoff = buildTextHandoff(item, [])
    expect(handoff.work_item).toEqual({ id: 'w', title: 'Topic', brief: 'No invented clinical claims' })
    expect(textHandoffMarkdown(item, [])).toContain('No invented clinical claims')
  })
  it('does not promote unapproved drafts or invent publications', () => {
    const item = { id: 'w', title: 'Topic', brief: { text: 'Brief' } } as unknown as WorkItem
    const document = doc({})
    const before = JSON.stringify(document)
    const handoff = buildTextHandoff(item, [document])
    expect(handoff.externally_published).toBe(false)
    expect(handoff.checks[0].human_approved).toBe(false)
    expect(handoff.checks[0].published_url).toBe('')
    expect(handoff.checks[0].next_action).toBe('人工审核当前版本')
    expect(JSON.stringify(document)).toBe(before)
  })
  it('asks for the external link once approved, and reports it once recorded', () => {
    const item = { id: 'w', title: 'Topic', brief: {} } as unknown as WorkItem
    expect(buildTextHandoff(item, [doc({ status: 'approved' })]).checks[0].next_action).toBe('导出后人工发布，并回填发布链接')
    expect(buildTextHandoff(item, [doc({ status: 'approved', published_url: 'https://x.com/p/1' })]).checks[0].next_action).toBe('已登记发布链接')
  })
})
