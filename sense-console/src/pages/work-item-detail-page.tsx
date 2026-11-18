import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { ContentState } from '@/components/content/content-common'
import { TextHandoff } from '@/components/content/text-handoff'
import { DocumentEditor } from '@/components/content/document-editor'
import { WorkItemForm } from '@/components/work-items/work-item-form'
import { downloadText, useContentAction } from '@/hooks/use-content-action'
import { platforms, platformKeys, type Platform } from '@/contracts/content'
import { briefExtras, intakeSourceLabels, workItemFormValues, workItemKindLabels, workItemStatusLabels, workItemStatuses, type WorkItemStatus } from '@/contracts/work-item'
import { getContentWorkspace } from '@/services/content-workspace-service'
import { getSourceCategories } from '@/services/source-category-service'
import { createWorkItemDocument, getWorkItem, listWorkItemDocuments, listWorkItemInputs, setWorkItemStatus, updateWorkItem } from '@/services/work-item-service'

function safeUrl(value: string | null) {
  if (!value) return null
  try { return ['http:', 'https:'].includes(new URL(value).protocol) ? value : null } catch { return null }
}

export function WorkItemDetailPage() {
  const { workItemId = '' } = useParams()
  const workspace = useQuery({ queryKey: ['content-workspace'], queryFn: getContentWorkspace })
  const query = useQuery({ queryKey: ['work-item', workItemId], queryFn: async () => {
    const [item, documents, inputs] = await Promise.all([getWorkItem(workItemId), listWorkItemDocuments(workItemId), listWorkItemInputs(workItemId)])
    return { item, documents, inputs }
  } })
  const org = workspace.data?.organization?.id
  const categories = useQuery({ queryKey: ['source-categories', org], queryFn: () => getSourceCategories(org!), enabled: Boolean(org) })
  const [active, setActive] = useState('')
  const [platform, setPlatform] = useState<Platform>('wechat_official')
  const { busy, run } = useContentAction()
  const loading = workspace.isLoading || query.isLoading
  const error = workspace.error ?? query.error
  if (loading || error || !query.data || !workspace.data?.organization) return <ContentState loading={loading} error={error} hasOrg={Boolean(workspace.data?.organization)} />
  const { item, documents, inputs } = query.data
  const canManage = workspace.data.canManage
  const master = documents.find(d => d.platform === 'master')
  const selected = documents.find(d => d.id === active) ?? master ?? documents[0]
  const extras = briefExtras(item.brief)
  const briefText = typeof item.brief.text === 'string' ? item.brief.text : ''
  return <div className="space-y-6">
    <Link className="text-sm text-muted-foreground hover:underline" to="/work-items">← 返回事项</Link>
    <PageHeader title={item.title} description={`${workItemKindLabels[item.kind]} · 更新于 ${new Date(item.updated_at).toLocaleString()}`} actions={<>
      {canManage
        ? <NativeSelect aria-label="事项状态" value={item.status} disabled={busy} onChange={e => void run(() => setWorkItemStatus(item, e.target.value as WorkItemStatus), '状态已更新')}>{workItemStatuses.map(s => <option key={s} value={s}>{workItemStatusLabels[s]}</option>)}</NativeSelect>
        : <Badge variant="outline">{workItemStatusLabels[item.status]}</Badge>}
      <Button variant="outline" onClick={() => downloadText(`video-handoff-${item.id}.json`, JSON.stringify({ schema_version: '1.0', work_item: { id: item.id, title: item.title, kind: item.kind, brief: item.brief }, script: master ?? null, rendering: 'external' }, null, 2), 'application/json')}>导出视频交接包</Button>
    </>} />
    <details className="rounded-xl border p-4"><summary className="cursor-pointer font-medium">Brief 与设置</summary><div className="space-y-4 pt-4">
      {canManage
        ? <WorkItemForm key={item.updated_at} initial={{ ...workItemFormValues(item), updated_at: item.updated_at }} categories={categories.data ?? []} busy={busy} onSave={async (input, baseUpdatedAt) => { let updatedAt: string | undefined; await run(async () => { const saved = await updateWorkItem({ ...item, updated_at: baseUpdatedAt ?? item.updated_at }, input); updatedAt = saved.updated_at }); return updatedAt }} />
        : <p className="whitespace-pre-wrap">{briefText || '还没有写 Brief'}</p>}
      {extras.length > 0 && <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">{extras.map(e => <div key={e.key} className="contents"><dt className="text-muted-foreground">{e.label}</dt><dd className="break-words whitespace-pre-wrap">{e.value}</dd></div>)}</dl>}
    </div></details>
    <Card><CardHeader><CardTitle>来源输入</CardTitle></CardHeader><CardContent className="space-y-3">
      {!inputs.length && <p className="text-sm text-muted-foreground">没有归入的输入。可以在收件箱把输入归到这个事项。</p>}
      {inputs.map(input => { const url = safeUrl(input.url); return <div key={input.id} className="space-y-1 rounded-lg border p-3">
        <p className="text-xs text-muted-foreground"><Badge variant="outline" className="mr-2">{intakeSourceLabels[input.source]}</Badge>{new Date(input.created_at).toLocaleString()}</p>
        {input.text && <p className="line-clamp-6 text-sm break-words whitespace-pre-wrap">{input.text}</p>}
        {url && <a className="text-sm break-all underline" href={url} target="_blank" rel="noreferrer">{url}</a>}
      </div> })}
    </CardContent></Card>
    {canManage && <div className="flex flex-wrap items-center gap-2">
      {!master && <Button disabled={busy} onClick={() => void run(async () => { const d = await createWorkItemDocument(item, 'master'); setActive(d.id) })}>创建母稿</Button>}
      {master && <><NativeSelect aria-label="新平台版本" value={platform} onChange={e => setPlatform(e.target.value as Platform)}>{platformKeys.map(p => <option key={p} value={p}>{platforms[p]}</option>)}</NativeSelect><Button variant="outline" disabled={busy || documents.some(d => d.platform === platform)} onClick={() => void run(async () => { const d = await createWorkItemDocument(item, platform, master); setActive(d.id) }, '已复制母稿，请按目标平台改写并审核')}>从母稿创建平台版本</Button></>}
    </div>}
    <div className="flex flex-wrap gap-2">{documents.map(d => <Button key={d.id} variant={selected?.id === d.id ? 'default' : 'outline'} onClick={() => setActive(d.id)}>{d.platform === 'master' ? '母稿' : platforms[d.platform]}</Button>)}</div>
    {selected ? <DocumentEditor key={selected.id} document={selected} canEdit={canManage} canReview={Boolean(workspace.data.canReview)} canPublish={Boolean(workspace.data.canPublish)} /> : <p className="py-10 text-center text-muted-foreground">创建母稿，开始写下核心观点。</p>}
    <TextHandoff item={item} documents={documents} />
  </div>
}
