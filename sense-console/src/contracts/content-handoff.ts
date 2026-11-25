import type { WorkItem } from './work-item'
import { platforms, statusLabels, type ContentDocument } from './content'

const briefText = (item: Pick<WorkItem, 'brief'>) => (typeof item.brief.text === 'string' ? item.brief.text : '')

// A rehearsal is a read-only handoff. Never turn a preview into an approval or publication record.
export function buildTextHandoff(item: Pick<WorkItem, 'id' | 'title' | 'brief'>, documents: ContentDocument[]) {
  const drafts = documents.filter(d => d.platform !== 'master')
  return {
    schema_version: '1.0', mode: 'rehearsal' as const, externally_published: false,
    work_item: { id: item.id, title: item.title, brief: briefText(item) },
    documents: documents.map(d => ({ id: d.id, platform: d.platform, revision: d.revision, status: d.status, title: d.title, body: d.body })),
    checks: drafts.map(d => ({ document_id: d.id, platform: d.platform, revision: d.revision,
      content_present: Boolean(d.title.trim() && d.body.trim()), human_approved: d.status === 'approved',
      published_url: d.published_url ?? '',
      next_action: !d.body.trim() ? '补充正文' : d.status !== 'approved' ? '人工审核当前版本' : d.published_url ? '已登记发布链接' : '导出后人工发布，并回填发布链接',
    })),
    notes: ['演练不创建发布记录，不生成阅读量。', '只包含已保存版本；实际发布前核对平台编辑器的长度、格式和素材要求。', '公众号配图、作者与原创声明等发布设置由人工核对。'],
  }
}

export function textHandoffMarkdown(item: Pick<WorkItem, 'id' | 'title' | 'brief'>, documents: ContentDocument[]) {
  const handoff = buildTextHandoff(item, documents)
  return `# ${item.title} — 文字发布演练\n\n> 未向外部平台发布。不是审核证明或发布回执。\n\n## 来源与创作要求\n\n${briefText(item) || '（未填写）'}\n\n` +
    documents.map(d => `## ${d.platform === 'master' ? '母稿' : platforms[d.platform]} · v${d.revision} · ${statusLabels[d.status]}\n\n### ${d.title}\n\n${d.body}\n`).join('\n') +
    '\n## 下一步\n\n' + handoff.checks.map(c => `- ${platforms[c.platform as keyof typeof platforms]}：${c.next_action}`).join('\n') + '\n'
}
