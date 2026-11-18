import type { WorkItem } from './work-item'
import { platforms, statusLabels, type ContentDocument, type PublishingChannel } from './content'

const briefText = (item: Pick<WorkItem, 'brief'>) => (typeof item.brief.text === 'string' ? item.brief.text : '')

export function reviewWindows(publishedAt: string) {
  const time = new Date(publishedAt).getTime()
  return [24, 48].map(hours => ({ hours, dueAt: new Date(time + hours * 3600000).toISOString() }))
}

// A rehearsal is a read-only handoff. Never turn a preview into an approval or publication record.
export function buildTextHandoff(item: Pick<WorkItem, 'id' | 'title' | 'brief'>, documents: ContentDocument[], channels: PublishingChannel[]) {
  const drafts = documents.filter(d => d.platform !== 'master')
  return {
    schema_version: '1.0', mode: 'rehearsal' as const, externally_published: false,
    work_item: { id: item.id, title: item.title, brief: briefText(item) },
    documents: documents.map(d => ({ id: d.id, platform: d.platform, revision: d.revision, status: d.status, title: d.title, body: d.body })),
    checks: drafts.map(d => ({ document_id: d.id, platform: d.platform, revision: d.revision,
      content_present: Boolean(d.title.trim() && d.body.trim()), human_approved: d.status === 'approved',
      channel_ids: channels.filter(c => c.platform === d.platform).map(c => c.id),
      next_action: !d.body.trim() ? '补充正文' : d.status !== 'approved' ? '人工审核当前版本' : !channels.some(c => c.platform === d.platform) ? '登记真实发布账号' : '创建正式发布计划，导出后人工发布',
    })),
    follow_up: { relative_to: 'actual_published_at', hours: [24, 48], metrics: ['views', 'likes', 'saves', 'comments'], unknown: null },
    notes: ['演练不创建发布记录，不生成阅读量。', '只包含已保存版本；实际发布前核对平台编辑器的长度、格式和素材要求。', '公众号配图、作者与原创声明等发布设置由人工核对。'],
  }
}

export function textHandoffMarkdown(item: Pick<WorkItem, 'id' | 'title' | 'brief'>, documents: ContentDocument[], channels: PublishingChannel[]) {
  const handoff = buildTextHandoff(item, documents, channels)
  return `# ${item.title} — 文字发布演练\n\n> 未向外部平台发布。不是审核证明或发布回执。\n\n## 来源与创作要求\n\n${briefText(item) || '（未填写）'}\n\n` +
    documents.map(d => `## ${d.platform === 'master' ? '母稿' : platforms[d.platform]} · v${d.revision} · ${statusLabels[d.status]}\n\n### ${d.title}\n\n${d.body}\n`).join('\n') +
    '\n## 下一步\n\n' + handoff.checks.map(c => `- ${platforms[c.platform as keyof typeof platforms]}：${c.next_action}`).join('\n') +
    '\n\n## 发布后复盘\n\n以真实发布时间为起点，24 / 48 小时回填数据。记录观察时间、阅读/展示、点赞、收藏、评论及数据来源；未知留空，各平台分别比较。演练无真实受众数据。\n'
}
