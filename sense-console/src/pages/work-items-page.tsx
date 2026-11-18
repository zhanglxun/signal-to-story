import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ContentState } from '@/components/content/content-common'
import { WorkItemForm } from '@/components/work-items/work-item-form'
import { useContentAction } from '@/hooks/use-content-action'
import { useContentData } from '@/hooks/use-content-data'
import { workItemFormValues, workItemKindLabels, workItemStatusLabels, workItemStatuses, type WorkItem, type WorkItemStatus } from '@/contracts/work-item'
import { createWorkItem } from '@/services/work-item-service'
import { getSourceCategories } from '@/services/source-category-service'

type StatusFilter = 'open' | 'all' | WorkItemStatus
const isOpen = (item: WorkItem) => item.status !== 'done' && item.status !== 'dropped'

export function WorkItemsPage() {
  const content = useContentData()
  const org = content.workspace?.organization?.id
  const categories = useQuery({ queryKey: ['source-categories', org], queryFn: () => getSourceCategories(org!), enabled: Boolean(org) })
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('open')
  const navigate = useNavigate()
  const { busy, run } = useContentAction()
  if (content.loading || content.error || !content.workspace?.organization || !content.data) return <ContentState {...content} hasOrg={Boolean(content.workspace?.organization)} />
  const organizationId = content.workspace.organization.id
  const { workItems, documents } = content.data
  const count = (f: StatusFilter) => workItems.filter(i => f === 'all' || (f === 'open' ? isOpen(i) : i.status === f)).length
  const keyword = search.trim().toLowerCase()
  const items = workItems
    .filter(i => filter === 'all' || (filter === 'open' ? isOpen(i) : i.status === filter))
    .filter(i => !keyword || i.title.toLowerCase().includes(keyword))
  return <div className="space-y-6">
    <PageHeader title="事项" description="每张卡是一件要做的内容。状态就是看板列：待办、AI 在做、等你处理、待审核、完成、放弃。" actions={content.workspace.canManage && <Button onClick={() => setCreating(!creating)}>新建事项</Button>} />
    {creating && content.workspace.canManage && <Card><CardHeader><CardTitle>新建事项</CardTitle></CardHeader><CardContent>
      <WorkItemForm initial={workItemFormValues()} categories={categories.data ?? []} busy={busy} submitLabel="创建事项" onSave={async input => {
        await run(async () => { const item = await createWorkItem(organizationId, input); navigate(`/work-items/${item.id}`) }, '已创建事项')
      }} />
    </CardContent></Card>}
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <Tabs value={filter} onValueChange={value => value && setFilter(value as StatusFilter)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="open">进行中 {count('open')}</TabsTrigger>
          {workItemStatuses.map(s => <TabsTrigger key={s} value={s}>{workItemStatusLabels[s]} {count(s)}</TabsTrigger>)}
          <TabsTrigger value="all">全部 {count('all')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Input className="lg:max-w-xs" aria-label="搜索事项" placeholder="搜索标题" value={search} onChange={e => setSearch(e.target.value)} />
    </div>
    {!items.length && <Card><CardContent className="py-12 text-center text-muted-foreground">没有匹配的事项。可以从收件箱把输入转为事项，或直接新建。</CardContent></Card>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map(item => {
      const docs = documents.filter(d => d.work_item_id === item.id)
      const text = typeof item.brief.text === 'string' ? item.brief.text : ''
      return <Card key={item.id}><CardHeader><CardTitle><Link to={`/work-items/${item.id}`} className="hover:underline">{item.title}</Link></CardTitle></CardHeader><CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2"><Badge variant={isOpen(item) ? 'default' : 'secondary'}>{workItemStatusLabels[item.status]}</Badge><Badge variant="outline">{workItemKindLabels[item.kind]}</Badge></div>
        <p className="line-clamp-3 text-sm text-muted-foreground">{text || '还没有写 Brief'}</p>
        <p className="text-xs text-muted-foreground">{docs.length} 份稿件 · {docs.filter(d => d.status === 'approved').length} 份已通过</p>
      </CardContent></Card>
    })}</div>
  </div>
}
