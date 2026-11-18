import { describe, expect, it } from 'vitest'
import { buildTextHandoff, reviewWindows, textHandoffMarkdown } from '@/contracts/content-handoff'
import type { ContentDocument } from '@/contracts/content'
import type { WorkItem } from '@/contracts/work-item'

describe('text production handoff', () => {
  it('carries the work item brief text into the rehearsal', () => {
    const item = { id: 'w', title: 'Topic', brief: { text: 'No invented clinical claims', legacy: { selection_id: 1 } } } as unknown as WorkItem
    const handoff = buildTextHandoff(item, [], [])
    expect(handoff.work_item).toEqual({ id: 'w', title: 'Topic', brief: 'No invented clinical claims' })
    expect(textHandoffMarkdown(item, [], [])).toContain('No invented clinical claims')
  })
  it('does not promote unapproved drafts or invent accounts and publication metrics', () => {
    const item = { id: 'w', title: 'Topic', brief: { text: 'Brief' } } as unknown as WorkItem
    const document = { id: 'd', work_item_id: 'w', project_id: null, platform: 'x', title: 'Title', body: 'Draft', revision: 2, status: 'in_review' } as ContentDocument
    const before = JSON.stringify(document)
    const handoff = buildTextHandoff(item, [document], [])
    expect(handoff.externally_published).toBe(false)
    expect(handoff.checks[0].human_approved).toBe(false)
    expect(handoff.checks[0].channel_ids).toEqual([])
    expect(handoff.checks[0].next_action).toBe('人工审核当前版本')
    expect(JSON.stringify(document)).toBe(before)
    expect(handoff.follow_up.unknown).toBeNull()
  })
  it('anchors reviews to the actual publication instant across date boundaries', () => {
    expect(reviewWindows('2026-10-06T23:30:00+08:00')).toEqual([
      { hours: 24, dueAt: '2026-10-07T15:30:00.000Z' },
      { hours: 48, dueAt: '2026-10-08T15:30:00.000Z' },
    ])
  })
})
