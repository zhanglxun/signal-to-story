import type { AgentJob } from '@/contracts/agent-job'
import type { ContentDocument } from '@/contracts/content'
import { isLiveOnSite } from '@/contracts/site-publish'
import type { WorkItem } from '@/contracts/work-item'

export type MarkdownStats = {
  chars: number
  readingMinutes: number
  unverifiedCount: number
  headingCount: number
}

export function analyzeMarkdown(body: string): MarkdownStats {
  const chars = body.replace(/\s+/g, '').length
  const readingMinutes = chars === 0 ? 0 : Math.max(1, Math.ceil(chars / 400))
  const unverifiedCount = body.match(/\[待核实[^\]]*\]/g)?.length ?? 0
  const headingCount = body.match(/^#{1,6}\s+\S/gm)?.length ?? 0
  return { chars, readingMinutes, unverifiedCount, headingCount }
}

/**
 * AI-written drafts (matching an active pending_review job revision), submitted reviews,
 * and approved documents default to reading preview instead of raw Markdown textarea.
 */
export function shouldDefaultToPreview(
  doc: Pick<ContentDocument, 'body' | 'status' | 'revision'>,
  draftJobs: readonly AgentJob[] = []
): boolean {
  if (!doc.body.trim()) return false
  if (doc.status === 'in_review' || doc.status === 'approved') return true
  return draftJobs.some(
    (j) =>
      j.status === 'pending_review' &&
      typeof j.result?.written_revision === 'number' &&
      j.result.written_revision === doc.revision
  )
}

export type WorkflowStepNumber = 1 | 2 | 3 | 4
export type WorkflowStepVisual = 'done' | 'current' | 'upcoming' | 'running' | 'attention'

export type WorkflowSubstate =
  | 'no_master'
  | 'empty_doc'
  | 'ai_running'
  | 'ai_failed'
  | 'ai_ready_to_review'
  | 'draft_ready'
  | 'changes_requested'
  | 'in_review'
  | 'approved_ready_to_publish'
  | 'approved_published'
  | 'done_clean'
  | 'done_unapproved_mismatch'
  | 'dropped'

export type WorkflowStepItem = {
  number: WorkflowStepNumber
  title: string
  visual: WorkflowStepVisual
  detail: string
}

export type WorkItemWorkflowState = {
  currentStep: WorkflowStepNumber
  substate: WorkflowSubstate
  headline: string
  description: string
  steps: [WorkflowStepItem, WorkflowStepItem, WorkflowStepItem, WorkflowStepItem]
  activeJob: AgentJob | null
  latestJob: AgentJob | null
  hasApprovedDoc: boolean
  hasUnapprovedDocs: boolean
}

const STEP_TITLES: Record<WorkflowStepNumber, string> = {
  1: '准备与出稿',
  2: '审阅与定稿',
  3: '发布与分发',
  4: '归档完成',
}

function makeSteps(
  activeStep: WorkflowStepNumber,
  overrides: Partial<Record<WorkflowStepNumber, { visual?: WorkflowStepVisual; detail?: string }>> = {}
): [WorkflowStepItem, WorkflowStepItem, WorkflowStepItem, WorkflowStepItem] {
  const numbers: WorkflowStepNumber[] = [1, 2, 3, 4]
  return numbers.map((number) => {
    const baseVisual: WorkflowStepVisual =
      number < activeStep ? 'done' : number === activeStep ? 'current' : 'upcoming'
    const ov = overrides[number]
    return {
      number,
      title: STEP_TITLES[number],
      visual: ov?.visual ?? baseVisual,
      detail: ov?.detail ?? (baseVisual === 'done' ? '已完成' : baseVisual === 'current' ? '当前阶段' : '待进行'),
    }
  }) as [WorkflowStepItem, WorkflowStepItem, WorkflowStepItem, WorkflowStepItem]
}

export function deriveWorkItemWorkflow(input: {
  item: WorkItem
  documents: readonly ContentDocument[]
  activeDoc: ContentDocument | null
  draftJobs: readonly AgentJob[]
}): WorkItemWorkflowState {
  const { item, documents, activeDoc, draftJobs } = input
  const activeJob = draftJobs.find((j) => j.status === 'queued' || j.status === 'running') ?? null
  const latestJob = draftJobs[0] ?? null
  const pendingReviewJob = draftJobs.find((j) => j.status === 'pending_review') ?? null
  const liveOnSite = documents.some((d) => isLiveOnSite(d))
  const hasPublishedRecord = documents.some((d) => Boolean(d.published_url))
  const hasApprovedDoc = documents.some((d) => d.status === 'approved')
  const hasUnapprovedDocs = documents.length === 0 || documents.some((d) => d.status !== 'approved')

  const base = { activeJob, latestJob, hasApprovedDoc, hasUnapprovedDocs }

  if (item.status === 'dropped') {
    return {
      ...base,
      currentStep: 4,
      substate: 'dropped',
      headline: '事项已放弃',
      description: '当前卡片已停止推进；如需继续创作，可随时重新打开事项。',
      steps: makeSteps(4, {
        1: { visual: activeDoc ? 'done' : 'upcoming', detail: activeDoc ? '已有稿件' : '未建稿' },
        2: { visual: hasApprovedDoc ? 'done' : 'upcoming', detail: hasApprovedDoc ? '已定稿' : '未定稿' },
        3: { visual: liveOnSite || hasPublishedRecord ? 'done' : 'upcoming', detail: '已跳过' },
        4: { visual: 'attention', detail: '已放弃' },
      }),
    }
  }

  if (item.status === 'done') {
    if (!hasApprovedDoc) {
      return {
        ...base,
        currentStep: 4,
        substate: 'done_unapproved_mismatch',
        headline: '事项已归档，但稿件尚未定稿',
        description:
          '将看板状态选为「完成」仅会移动卡片，不会审核通过稿件、完成出稿任务或解锁发布。请点击「补做定稿」或切回「待审核」。',
        steps: makeSteps(4, {
          1: { visual: activeDoc?.body.trim() ? 'done' : 'attention', detail: activeDoc?.body.trim() ? '已有草稿' : '缺少正文' },
          2: { visual: 'attention', detail: '尚未定稿' },
          3: { visual: 'upcoming', detail: '需定稿后解锁' },
          4: { visual: 'attention', detail: '状态待对齐' },
        }),
      }
    }
    return {
      ...base,
      currentStep: 4,
      substate: 'done_clean',
      headline: '已完成闭环',
      description: '稿件已通过审核定稿，可随时复盘表现或复制导出 Markdown。',
      steps: makeSteps(4, {
        1: { visual: 'done', detail: '已成稿' },
        2: { visual: 'done', detail: `v${activeDoc?.revision ?? 1} 已定稿` },
        3: { visual: 'done', detail: liveOnSite || hasPublishedRecord ? '已发布' : '可导出/分发' },
        4: { visual: 'done', detail: '已完成' },
      }),
    }
  }

  if (activeJob) {
    return {
      ...base,
      currentStep: 1,
      substate: 'ai_running',
      headline: activeJob.status === 'queued' ? 'AI 出稿排队中' : 'AI 正在生成并评估草稿',
      description: '执行节点通过预检与评估后会自动写入新版本并切换到审阅阶段，无需手动刷新。',
      steps: makeSteps(1, {
        1: { visual: 'running', detail: activeJob.status === 'queued' ? '排队等待节点' : '生成与评估中' },
      }),
    }
  }

  if (!activeDoc) {
    return {
      ...base,
      currentStep: 1,
      substate: 'no_master',
      headline: '还没有母稿',
      description: '先创建母稿（推荐「创建并让 AI 出稿」一步完成建稿和初稿生成）。',
      steps: makeSteps(1, {
        1: { visual: 'current', detail: '待创建母稿' },
      }),
    }
  }

  if (!activeDoc.body.trim()) {
    if (latestJob && (latestJob.status === 'failed' || latestJob.status === 'blocked_needs_human')) {
      return {
        ...base,
        currentStep: 1,
        substate: 'ai_failed',
        headline: latestJob.status === 'blocked_needs_human' ? 'AI 出稿需要人工拍板' : '上次 AI 出稿未完成',
        description: latestJob.error || '请查看执行记录或直接重新触发 AI 出稿，也可切换到编辑模式手动写作。',
        steps: makeSteps(1, {
          1: { visual: 'attention', detail: '任务受阻' },
        }),
      }
    }
    return {
      ...base,
      currentStep: 1,
      substate: 'empty_doc',
      headline: '母稿已建，等待生成正文',
      description: '可一键交给 AI 根据 Brief 写出初稿，或直接手动撰写正文。',
      steps: makeSteps(1, {
        1: { visual: 'current', detail: '待写正文' },
      }),
    }
  }

  if (activeDoc.status === 'approved') {
    const published = liveOnSite || hasPublishedRecord
    return {
      ...base,
      currentStep: 3,
      substate: published ? 'approved_published' : 'approved_ready_to_publish',
      headline: published ? '稿件已定稿并上线，可以归档完成' : '稿件已定稿，可以发布或导出',
      description: published
        ? '已生成线上发布记录，可直接归档为「完成」，或继续生成各平台适配版本。'
        : '现在可一键发布到读者站、添加平台版本，或复制/导出 Markdown 后将事项标记完成。',
      steps: makeSteps(3, {
        1: { visual: 'done', detail: '已成稿' },
        2: { visual: 'done', detail: `v${activeDoc.revision} 已定稿` },
        3: { visual: 'current', detail: published ? '已发布' : '待发布 / 导出' },
      }),
    }
  }

  if (activeDoc.status === 'in_review') {
    return {
      ...base,
      currentStep: 2,
      substate: 'in_review',
      headline: '稿件已提交审核，等待确认定稿',
      description: '阅读下方排版成稿，确认无误后点击「审核通过」即可定稿并解锁发布。',
      steps: makeSteps(2, {
        1: { visual: 'done', detail: `v${activeDoc.revision} 已提交` },
        2: { visual: 'current', detail: '待审核决定' },
      }),
    }
  }

  if (activeDoc.status === 'changes_requested') {
    return {
      ...base,
      currentStep: 2,
      substate: 'changes_requested',
      headline: '稿件已退回，请修改后重新定稿',
      description: activeDoc.review_note ? `退回意见：${activeDoc.review_note}` : '修改正文并保存新版本，或重新让 AI 优化草稿。',
      steps: makeSteps(2, {
        1: { visual: 'done', detail: `v${activeDoc.revision} 待修订` },
        2: { visual: 'attention', detail: '待修改' },
      }),
    }
  }

  if (pendingReviewJob || item.status === 'review') {
    return {
      ...base,
      currentStep: 2,
      substate: 'ai_ready_to_review',
      headline: 'AI 草稿已就绪，请审阅并定稿',
      description: '草稿已写入正文。确认内容后点击「确认并定稿」，会自动完成出稿任务并解锁发布与导出。',
      steps: makeSteps(2, {
        1: { visual: 'done', detail: `AI 已写入 v${activeDoc.revision}` },
        2: { visual: 'current', detail: '待审阅定稿' },
      }),
    }
  }

  return {
    ...base,
    currentStep: 2,
    substate: 'draft_ready',
    headline: '草稿编辑完成，待确认定稿',
    description: '单人创作可直接点击「确认并定稿」一步完成审核；团队协作可点「提交审核」交由审校人员确认。',
    steps: makeSteps(2, {
      1: { visual: 'done', detail: `v${activeDoc.revision} 草稿已存` },
      2: { visual: 'current', detail: '待提交/定稿' },
    }),
  }
}

export type ReviewQueueEntry = {
  id: string
  kind: 'submitted' | 'ai_draft'
  workItemId: string | null
  documentId: string | null
  title: string
  platform: ContentDocument['platform'] | null
  revision: number | null
  updatedAt: string
  statusLabel: string
  hint: string
}

/**
 * Unifies "已提交审核的稿件" (`documents.status === 'in_review'`) and
 * "AI 写完待审阅的事项" (`work_items.status === 'review'` with non-approved doc)
 * into a single Review Center queue.
 */
export function listReviewQueueItems(
  workItems: readonly WorkItem[],
  documents: readonly ContentDocument[]
): ReviewQueueEntry[] {
  const entries: ReviewQueueEntry[] = []
  const workItemMap = new Map(workItems.map((w) => [w.id, w]))
  const coveredWorkItemIds = new Set<string>()

  for (const doc of documents) {
    if (doc.status !== 'in_review') continue
    if (doc.work_item_id) coveredWorkItemIds.add(doc.work_item_id)
    const item = doc.work_item_id ? workItemMap.get(doc.work_item_id) : undefined
    entries.push({
      id: `doc:${doc.id}`,
      kind: 'submitted',
      workItemId: doc.work_item_id,
      documentId: doc.id,
      title: doc.title || item?.title || '未命名稿件',
      platform: doc.platform,
      revision: doc.revision,
      updatedAt: doc.updated_at,
      statusLabel: '已提交待审核',
      hint: '点击进入审阅正文，确认后通过定稿',
    })
  }

  for (const item of workItems) {
    if (item.status !== 'review' || coveredWorkItemIds.has(item.id)) continue
    const docsForItem = documents.filter((d) => d.work_item_id === item.id)
    const pendingDoc =
      docsForItem.find((d) => d.platform === 'master' && d.status !== 'approved') ??
      docsForItem.find((d) => d.status !== 'approved')
    if (docsForItem.length > 0 && !pendingDoc) continue
    entries.push({
      id: `item:${item.id}`,
      kind: 'ai_draft',
      workItemId: item.id,
      documentId: pendingDoc?.id ?? null,
      title: pendingDoc?.title || item.title,
      platform: pendingDoc?.platform ?? null,
      revision: pendingDoc?.revision ?? null,
      updatedAt: pendingDoc?.updated_at ?? item.updated_at,
      statusLabel: 'AI 草稿待审阅',
      hint: pendingDoc ? 'AI 已写入草稿，审阅后可一键定稿' : '事项处于待审核状态，请检查稿件',
    })
  }

  return entries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}
