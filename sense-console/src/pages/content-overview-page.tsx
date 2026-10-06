import { Link } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ContentState } from '@/components/content/content-common'
import { useContentData } from '@/hooks/use-content-data'
import { platforms, statusLabels } from '@/contracts/content'

export function ContentOverviewPage({ mode = 'overview' }: { mode?: 'overview' | 'reviews' | 'pipeline' | 'analytics' }) {
  const content = useContentData()
  if (content.loading || content.error || !content.data || !content.workspace?.organization) return <ContentState {...content} hasOrg={Boolean(content.workspace?.organization)} />
  const { projects, documents, publications, metrics } = content.data
  const pending = documents.filter(d => d.status === 'in_review')
  const published = publications.filter(p => p.status === 'published')
  const titles = { overview: '创作工作台', reviews: '审核中心', pipeline: '内容生产流程', analytics: '数据与复盘' }
  return <div className="space-y-6"><PageHeader title={titles[mode]} description={mode === 'pipeline' ? '固定流程：选题立项 → 母稿 → 平台版本 → 人工审核 → 发布 → 复盘。视频执行独立接入。' : '所有状态来自云端实际记录。'} actions={<Button nativeButton={false} render={<Link to="/content/projects" />}>进入内容项目</Button>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['内容项目', projects.length], ['待审核稿件', pending.length], ['待发布计划', publications.filter(p => p.status === 'planned').length], ['已发布记录', published.length]].map(([label, count]) => <Card key={label}><CardContent className="py-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{count}</p></CardContent></Card>)}</div>
    {(mode === 'overview' || mode === 'reviews') && <Card><CardHeader><CardTitle>待审核</CardTitle></CardHeader><CardContent className="space-y-3">{!pending.length && <p className="text-sm text-muted-foreground">暂无待审核稿件。</p>}{pending.map(d => <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><Link className="font-medium hover:underline" to={`/content/projects/${d.project_id}`}>{d.title}</Link><p className="text-xs text-muted-foreground">{d.platform === 'master' ? '母稿' : platforms[d.platform]} · v{d.revision}</p></div><Badge variant="outline">等待人工审核</Badge></div>)}</CardContent></Card>}
    {(mode === 'overview' || mode === 'pipeline') && <Card><CardHeader><CardTitle>项目进度</CardTitle></CardHeader><CardContent className="space-y-3">{!projects.length && <p className="text-sm text-muted-foreground">创建第一个内容项目后，这里会展示实际制作进度。</p>}{projects.map(p => {
      const docs = documents.filter(d => d.project_id === p.id)
      const pubs = published.filter(pub => docs.some(d => d.id === pub.document_id))
      const reviewed = pubs.filter(pub => metrics.some(m => m.publication_id === pub.id && m.retrospective.trim()))
      return <div key={p.id} className="rounded-lg border p-4"><Link className="font-medium hover:underline" to={`/content/projects/${p.id}`}>{p.title}</Link><div className="mt-3 flex flex-wrap gap-2">{!docs.length && <Badge variant="outline">等待创建母稿</Badge>}{docs.map(d => <Badge key={d.id} variant="outline">{d.platform === 'master' ? '母稿' : platforms[d.platform]}：{statusLabels[d.status]}</Badge>)}<Badge variant="secondary">已发布 {pubs.length} · 已复盘 {reviewed.length}</Badge></div></div>
    })}</CardContent></Card>}
    {mode === 'analytics' && <Card><CardHeader><CardTitle>各条内容的最新观察</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">不同平台的指标口径独立查看。空值表示未录入，不等于零。</p>{!published.length && <p className="text-sm">记录第一条发布结果后即可回填数据。</p>}{published.map(pub => {
      const doc = documents.find(d => d.id === pub.document_id)
      const channel = content.data!.channels.find(c => c.id === pub.channel_id)
      const metric = metrics.find(m => m.publication_id === pub.id)
      return <div key={pub.id} className="rounded-lg border p-4"><p className="font-medium">{pub.title_snapshot ?? doc?.title} · {channel && platforms[channel.platform]} · v{pub.revision}</p><p className="mt-2 text-sm text-muted-foreground">{metric ? `${new Date(metric.observed_at).toLocaleString()} · 阅读/播放 ${metric.views ?? '未录入'} · 点赞 ${metric.likes ?? '未录入'} · 收藏 ${metric.saves ?? '未录入'} · 评论 ${metric.comments ?? '未录入'}` : '等待数据回填'}</p><p className="mt-2 whitespace-pre-wrap text-sm">{metric?.retrospective}</p></div>
    })}<Link to="/publishing/plans" className="text-sm underline">回填发布数据与复盘</Link></CardContent></Card>}
  </div>
}
