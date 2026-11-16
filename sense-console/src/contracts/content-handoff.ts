import type { Selection } from './selection'
import type { Signal } from './signal'
import { platforms, statusLabels, type ContentDocument, type ContentProject, type PublishingChannel } from './content'

export function selectionBrief(selection: Selection, signal?: Signal | null) {
  return [
    `选题：${selection.name}（#${selection.id}）`,
    selection.coreThesis && `核心论点：${selection.coreThesis}`,
    selection.angleType && `切入角度：${selection.angleType}`,
    selection.contentFormat && `内容形式：${selection.contentFormat}`,
    selection.outlineTemplate.length && `结构大纲：\n${selection.outlineTemplate.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}`,
    selection.negativePrompts && `内容禁忌：${selection.negativePrompts}`,
    selection.description,
    signal && `来源：${signal.name}（信息 #${signal.id}）\n${signal.siteUrl ?? ''}\n${signal.summary ?? ''}\n核查备注：${signal.description ?? ''}`,
  ].filter(Boolean).join('\n\n')
}

export function reviewWindows(publishedAt: string) {
  const time = new Date(publishedAt).getTime()
  return [24, 48].map(hours => ({ hours, dueAt: new Date(time + hours * 3600000).toISOString() }))
}

// A rehearsal is a read-only handoff. Never turn a preview into an approval or publication record.
export function buildTextHandoff(project: ContentProject, documents: ContentDocument[], channels: PublishingChannel[]) {
  const drafts = documents.filter(d => d.platform !== 'master')
  return {
    schema_version: '1.0', mode: 'rehearsal' as const, externally_published: false,
    project: { id: project.id, title: project.title, selection_id: project.selection_id, brief: project.brief },
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

export function textHandoffMarkdown(project: ContentProject, documents: ContentDocument[], channels: PublishingChannel[]) {
  const handoff = buildTextHandoff(project, documents, channels)
  return `# ${project.title} — 文字发布演练\n\n> 未向外部平台发布。不是审核证明或发布回执。\n\n## 来源与创作要求\n\n${project.brief}\n\n` +
    documents.map(d => `## ${d.platform === 'master' ? '母稿' : platforms[d.platform]} · v${d.revision} · ${statusLabels[d.status]}\n\n### ${d.title}\n\n${d.body}\n`).join('\n') +
    '\n## 下一步\n\n' + handoff.checks.map(c => `- ${platforms[c.platform as keyof typeof platforms]}：${c.next_action}`).join('\n') +
    '\n\n## 发布后复盘\n\n以真实发布时间为起点，24 / 48 小时回填数据。记录观察时间、阅读/展示、点赞、收藏、评论及数据来源；未知留空，各平台分别比较。演练无真实受众数据。\n'
}
