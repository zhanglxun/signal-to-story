import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { platforms, type ContentProject, type ContentDocument, type Platform } from '@/contracts/content'
import { buildTextHandoff, textHandoffMarkdown } from '@/contracts/content-handoff'
import { listChannels } from '@/services/content-service'
import { downloadText } from '@/hooks/use-content-action'

export function TextHandoff({ project, documents }: { project: ContentProject; documents: ContentDocument[] }) {
  const channels = useQuery({ queryKey: ['cloud-content', project.organization_id, 'handoff-channels'], queryFn: () => listChannels(project.organization_id) })
  const handoff = buildTextHandoff(project, documents, channels.data ?? [])
  return <Card><CardHeader><CardTitle>文字发布演练与交接</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">检查已保存版本并导出演练包。不会发送帖子、代替人工审核或产生发布量与阅读量。</p>
    {channels.isLoading ? <p>正在核对渠道…</p> : channels.error ? <p role="alert">渠道读取失败，请刷新重试。</p> : <>
      {!handoff.checks.length && <p className="text-sm">先从母稿创建平台版本。</p>}
      {handoff.checks.map(c => <p className="text-sm" key={c.document_id}>{platforms[c.platform as Platform]} · v{c.revision}：{c.next_action}{!c.channel_ids.length && ' · 真实账号待配置'}</p>)}
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">查看演练内容（可复制）</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-sm">{textHandoffMarkdown(project, documents, channels.data ?? [])}</pre></details>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!documents.length} onClick={() => downloadText(`text-rehearsal-${project.id}.md`, textHandoffMarkdown(project, documents, channels.data ?? []))}>导出文字演练包</Button>
        <Button variant="outline" disabled={!documents.length} onClick={() => downloadText(`text-handoff-${project.id}.json`, JSON.stringify(handoff, null, 2), 'application/json')}>导出流程交接 JSON</Button>
        <Link className="self-center text-sm underline" to="/publishing/channels">配置发布账号</Link></div>
    </>}
    <p className="text-xs text-muted-foreground">正式发布后 24 / 48 小时复盘；实际发布时间回填后，发布记录会显示对应时间。没有数据时保留空值。</p>
  </CardContent></Card>
}
