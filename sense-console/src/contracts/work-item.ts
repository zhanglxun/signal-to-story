import { z } from 'zod'

/** 事项（work_items）：看板上的一张卡。status 就是看板列（docs/database.md §4.2）。 */
export const workItemStatuses = ['todo', 'doing', 'waiting', 'review', 'done', 'dropped'] as const
export type WorkItemStatus = (typeof workItemStatuses)[number]
export const workItemStatusLabels: Record<WorkItemStatus, string> = {
  todo: '待办', doing: 'AI 在做', waiting: '等你处理', review: '待审核', done: '完成', dropped: '放弃',
}
export const workItemKinds = ['article', 'video'] as const
export type WorkItemKind = (typeof workItemKinds)[number]
export const workItemKindLabels: Record<WorkItemKind, string> = { article: '图文', video: '视频' }
export const contentKindLabels = { explainer: '企业 AI 解说', knowledge: '图文知识', story: '故事 / 漫画' } as const
export type ContentKind = keyof typeof contentKindLabels
export const aspectRatios = ['9:16', '16:9', '1:1'] as const
export type AspectRatio = (typeof aspectRatios)[number]

/** brief 是自由 JSON 对象；这里只校验已知键，未知键原样保留。 */
export const workItemBriefSchema = z.looseObject({
  text: z.string().optional(),
  url: z.string().optional(),
  platforms: z.array(z.string()).optional(),
  content_kind: z.enum(['explainer', 'knowledge', 'story']).optional(),
  target_seconds: z.number().int().optional(),
  aspect_ratio: z.enum(aspectRatios).optional(),
  core_thesis: z.string().optional(),
  angle_type: z.string().optional(),
  outline_template: z.unknown().optional(),
})
export type WorkItemBrief = Record<string, unknown>

export const workItemSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  kind: z.enum(workItemKinds),
  title: z.string(),
  brief: z.record(z.string(), z.unknown()).catch({}),
  category_id: z.number().nullable(),
  status: z.enum(workItemStatuses),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type WorkItem = z.infer<typeof workItemSchema>

/** 新建 / 编辑事项表单。text、content_kind、target_seconds、aspect_ratio 写进 brief。 */
export const workItemInputSchema = z.object({
  title: z.string().trim().min(1, '请填写事项标题').max(200, '标题最多 200 字'),
  kind: z.enum(workItemKinds),
  category_id: z.number().int().nullable(),
  text: z.string().max(20000),
  content_kind: z.enum(['explainer', 'knowledge', 'story']),
  target_seconds: z.number().int().min(1).max(3600),
  aspect_ratio: z.enum(aspectRatios),
})
export type WorkItemInput = z.infer<typeof workItemInputSchema>

/** 把表单值合并进原 brief：只覆盖表单管的键，其他键（url、platforms、legacy…）原样保留。 */
export function mergeBrief(brief: WorkItemBrief, input: Pick<WorkItemInput, 'text' | 'content_kind' | 'target_seconds' | 'aspect_ratio'>): WorkItemBrief {
  const next: WorkItemBrief = { ...brief, content_kind: input.content_kind, target_seconds: input.target_seconds, aspect_ratio: input.aspect_ratio }
  if (input.text.trim()) next.text = input.text
  else delete next.text
  return next
}

/** 从事项读出表单初值；brief 里缺失或不合法的值用默认值。 */
export function workItemFormValues(item?: Pick<WorkItem, 'title' | 'kind' | 'category_id' | 'brief'>): WorkItemInput {
  // Read key by key, so one malformed value only falls back for that field.
  const shape = workItemBriefSchema.shape
  const read = <K extends 'text' | 'content_kind' | 'target_seconds' | 'aspect_ratio'>(key: K) => {
    const parsed = shape[key].safeParse(item?.brief?.[key])
    return parsed.success ? (parsed.data as z.infer<(typeof shape)[K]>) : undefined
  }
  const seconds = read('target_seconds')
  return {
    title: item?.title ?? '',
    kind: item?.kind ?? 'article',
    category_id: item?.category_id ?? null,
    text: read('text') ?? '',
    content_kind: read('content_kind') ?? 'explainer',
    target_seconds: seconds != null && seconds >= 1 && seconds <= 3600 ? seconds : 300,
    aspect_ratio: read('aspect_ratio') ?? '9:16',
  }
}

/** brief 中表单不编辑、但值得展示的键（来自旧选题回填或速记）。legacy 不展示。 */
export const briefExtraLabels: Record<string, string> = {
  url: '来源链接', platforms: '目标平台', core_thesis: '核心论点', angle_type: '切入角度', content_format: '内容形式',
  outline_template: '结构大纲', negative_prompts: '内容禁忌', summary: '摘要', description: '说明',
}
export function briefExtras(brief: WorkItemBrief): Array<{ key: string; label: string; value: string }> {
  return Object.entries(briefExtraLabels).flatMap(([key, label]) => {
    const value = brief[key]
    if (value == null || value === '') return []
    if (Array.isArray(value)) {
      const parts = value.map(v => (v && typeof v === 'object' && 'title' in v ? String((v as { title: unknown }).title) : String(v))).filter(Boolean)
      return parts.length ? [{ key, label, value: parts.join('、') }] : []
    }
    return [{ key, label, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }]
  })
}

// ── 收件箱（intake_events）──────────────────────────────────────────────────
export const intakeSources = ['web', 'im', 'api', 'chat'] as const
export type IntakeSource = (typeof intakeSources)[number]
export const intakeSourceLabels: Record<IntakeSource, string> = { web: '网页', im: 'IM', api: '接口', chat: '对话' }

export const intakeEventSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  source: z.enum(intakeSources),
  connection_id: z.string().nullable(),
  external_id: z.string(),
  text: z.string().catch(''),
  url: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).catch({}),
  work_item_id: z.string().nullable(),
  ignored_at: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
})
export type IntakeEvent = z.infer<typeof intakeEventSchema>

export const manualInputSchema = z.object({
  text: z.string().trim().max(20000),
  url: z.union([z.literal(''), z.url().refine(v => ['http:', 'https:'].includes(new URL(v).protocol), '请填写 http 或 https 链接')]),
}).refine(v => v.text || v.url, '请填写内容或链接')

/** 由输入推出事项标题：第一行非空文字，最多 200 字；没有文字时用链接。 */
export function titleFromInput(input: Pick<IntakeEvent, 'text' | 'url'>): string {
  const line = input.text.split('\n').map(l => l.trim()).find(Boolean)
  const title = line || input.url?.trim() || '未命名输入'
  return Array.from(title).slice(0, 200).join('')
}
