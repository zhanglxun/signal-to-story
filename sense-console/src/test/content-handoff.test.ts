import { describe, expect, it } from 'vitest'
import { buildTextHandoff, reviewWindows, selectionBrief } from '@/contracts/content-handoff'
import type { ContentDocument, ContentProject } from '@/contracts/content'
import type { Selection } from '@/contracts/selection'
import type { Signal } from '@/contracts/signal'

describe('text production handoff', () => {
  it('preserves source, negative constraints and outline when moving into authoring', () => {
    const selection = { id: 1, name: 'topic', coreThesis: 'thesis', negativePrompts: 'No invented clinical claims', outlineTemplate: [{ title: 'Evidence' }] } as Selection
    const signal = { id: 2, name: 'source', siteUrl: 'https://example.org/news', description: 'Checked 2026-10-06' } as Signal
    const brief = selectionBrief(selection, signal)
    expect(brief).toContain('No invented clinical claims')
    expect(brief).toContain('Evidence')
    expect(brief).toContain('https://example.org/news')
    expect(brief).toContain('Checked 2026-10-06')
  })
  it('does not promote unapproved drafts or invent accounts and publication metrics', () => {
    const project = { id: 'p', title: 'Topic', brief: 'Brief', selection_id: 1 } as ContentProject
    const document = { id: 'd', project_id: 'p', platform: 'x', title: 'Title', body: 'Draft', revision: 2, status: 'in_review' } as ContentDocument
    const before = JSON.stringify(document)
    const handoff = buildTextHandoff(project, [document], [])
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
