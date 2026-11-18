import { describe, expect, it } from 'vitest'
import {
  briefExtras, intakeEventSchema, manualInputSchema, mergeBrief, titleFromInput,
  workItemFormValues, workItemInputSchema, workItemSchema,
} from '@/contracts/work-item'

const row = {
  id: 'w1', organization_id: 'o1', kind: 'article', title: '标题', brief: { text: 'b' }, category_id: null,
  status: 'todo', created_by: null, created_at: '2026-11-18T00:00:00Z', updated_at: '2026-11-18T00:00:00Z',
}

describe('work item contract', () => {
  it('parses database rows and rejects unknown statuses / kinds', () => {
    expect(workItemSchema.parse(row).status).toBe('todo')
    expect(workItemSchema.safeParse({ ...row, status: 'archived' }).success).toBe(false)
    expect(workItemSchema.safeParse({ ...row, kind: 'podcast' }).success).toBe(false)
  })

  it('validates the form input', () => {
    const input = workItemFormValues({ title: 'AI 知识', kind: 'article', category_id: null, brief: {} })
    expect(workItemInputSchema.safeParse(input).success).toBe(true)
    expect(workItemInputSchema.safeParse({ ...input, title: ' ' }).success).toBe(false)
    expect(workItemInputSchema.safeParse({ ...input, title: 'x'.repeat(201) }).success).toBe(false)
    expect(workItemInputSchema.safeParse({ ...input, target_seconds: 0 }).success).toBe(false)
    expect(workItemInputSchema.safeParse({ ...input, aspect_ratio: '4:3' }).success).toBe(false)
  })

  it('merges form values into brief and preserves unknown keys', () => {
    const brief = { text: 'old', url: 'https://example.com', platforms: ['x'], legacy: { selection_id: 3 }, core_thesis: '论点' }
    const next = mergeBrief(brief, { text: 'new', content_kind: 'story', target_seconds: 60, aspect_ratio: '1:1' })
    expect(next).toEqual({ ...brief, text: 'new', content_kind: 'story', target_seconds: 60, aspect_ratio: '1:1' })
    expect(brief.text).toBe('old')
    expect(mergeBrief(brief, { text: '  ', content_kind: 'story', target_seconds: 60, aspect_ratio: '1:1' })).not.toHaveProperty('text')
  })

  it('reads form defaults from a free-form brief', () => {
    expect(workItemFormValues({ title: 't', kind: 'video', category_id: 2, brief: { target_seconds: 'bad', aspect_ratio: '16:9' } }))
      .toEqual({ title: 't', kind: 'video', category_id: 2, text: '', content_kind: 'explainer', target_seconds: 300, aspect_ratio: '16:9' })
  })

  it('shows extra brief fields but never legacy', () => {
    const extras = briefExtras({ core_thesis: '论点', outline_template: [{ title: '一' }, { title: '二' }], legacy: { signal_id: 1 } })
    expect(extras).toEqual([{ key: 'core_thesis', label: '核心论点', value: '论点' }, { key: 'outline_template', label: '结构大纲', value: '一、二' }])
  })
})

describe('inbox inputs', () => {
  it('derives a title from the first non-empty line, capped at 200 characters', () => {
    expect(titleFromInput({ text: '\n  第一行 \n第二行', url: null })).toBe('第一行')
    expect(titleFromInput({ text: '', url: 'https://example.com/a' })).toBe('https://example.com/a')
    expect(titleFromInput({ text: '字'.repeat(300), url: null })).toHaveLength(200)
  })

  it('requires text or a safe link for a manual input', () => {
    expect(manualInputSchema.safeParse({ text: '', url: '' }).success).toBe(false)
    expect(manualInputSchema.safeParse({ text: '', url: 'javascript:alert(1)' }).success).toBe(false)
    expect(manualInputSchema.safeParse({ text: '', url: 'https://example.com' }).success).toBe(true)
    expect(manualInputSchema.safeParse({ text: '想法', url: '' }).success).toBe(true)
  })

  it('parses intake_events rows', () => {
    const event = intakeEventSchema.parse({
      id: 'e1', organization_id: 'o1', source: 'im', connection_id: 'c1', external_id: 'm1', text: 'hi', url: null,
      payload: {}, work_item_id: null, ignored_at: null, created_by: null, created_at: '2026-11-18T00:00:00Z',
    })
    expect(event.source).toBe('im')
  })
})
