import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { ContentState } from '@/components/content/content-common'
import { downloadText, useContentAction } from '@/hooks/use-content-action'
import { TextHandoff } from '@/components/content/text-handoff'
import { DocumentEditor } from '@/components/content/document-editor'
import { platforms, platformKeys, type Platform } from '@/contracts/content'
import { getProject, getProjectDocuments, createDocument, linkedAssets, linkAsset, updateProject } from '@/services/content-service'
import { getContentWorkspace } from '@/services/content-workspace-service'
import { getAssets } from '@/services/asset-service'
import { ProjectForm } from './content-projects-page'

export function ContentProjectDetailPage() {
  const { projectId = '' } = useParams()
  const workspace = useQuery({ queryKey: ['content-workspace'], queryFn: getContentWorkspace })
  const query = useQuery({ queryKey: ['content-project', projectId], queryFn: async () => {
    const project = await getProject(projectId)
    const [documents, assets] = await Promise.all([getProjectDocuments(projectId), linkedAssets(projectId)])
    return { project, documents, assets }
  } })
  const assets = useQuery({ queryKey: ['content-project', projectId, 'asset-options'], enabled: Boolean(query.data), queryFn: () => getAssets({ organizationId: query.data!.project.organization_id, pageSize: 200 }) })
  const [active, setActive] = useState('')
  const [platform, setPlatform] = useState<Platform>('wechat_official')
  const [asset, setAsset] = useState('')
  const { busy, run } = useContentAction()
  const loading = workspace.isLoading || query.isLoading
  const error = workspace.error ?? query.error
  if (loading || error || !query.data || !workspace.data?.organization) return <ContentState loading={loading} error={error} hasOrg={Boolean(workspace.data?.organization)} />
  const { project, documents, assets: linked } = query.data
  const master = documents.find(d => d.platform === 'master')
  const selected = documents.find(d => d.id === active) ?? master ?? documents[0]
  return <div className="space-y-6">
    <Link className="text-sm text-muted-foreground hover:underline" to="/content/projects">← 返回内容项目</Link>
    <PageHeader title={project.title} description={`${project.aspect_ratio} · 目标 ${project.target_seconds} 秒 · 云端协作项目`} actions={<Button variant="outline" onClick={() => downloadText(`video-handoff-${project.id}.json`, JSON.stringify({ schema_version: '1.0', project, script: master ?? null, assets: linked, rendering: 'external' }, null, 2), 'application/json')}>导出视频交接包</Button>} />
    {project.selection_id && <Link className="text-sm underline" to={`/topics/${project.selection_id}`}>追溯来源选题 #{project.selection_id}</Link>}
    <details className="rounded-xl border p-4"><summary className="cursor-pointer font-medium">创作 Brief 与项目设置</summary><div className="pt-4">{workspace.data.canManage ? <ProjectForm key={project.id} initial={project} busy={busy} onSave={async (input, baseUpdatedAt) => { let updatedAt: string | undefined; await run(async () => { const saved = await updateProject({ ...project, updated_at: baseUpdatedAt ?? project.updated_at }, input); updatedAt = saved.updated_at }); return updatedAt }} /> : <p className="whitespace-pre-wrap">{project.brief}</p>}</div></details>
    {workspace.data.canManage && <div className="flex flex-wrap items-center gap-2">
      {!master && <Button disabled={busy} onClick={() => void run(async () => { const d = await createDocument(project, 'master'); setActive(d.id) })}>创建母稿</Button>}
      {master && <><NativeSelect aria-label="新平台版本" value={platform} onChange={e => setPlatform(e.target.value as Platform)}>{platformKeys.map(p => <option key={p} value={p}>{platforms[p]}</option>)}</NativeSelect><Button variant="outline" disabled={busy || documents.some(d => d.platform === platform)} onClick={() => void run(async () => { const d = await createDocument(project, platform, master); setActive(d.id) }, '已复制母稿，请按目标平台改写并审核')}>从母稿创建平台版本</Button></>}
    </div>}
    <div className="flex flex-wrap gap-2">{documents.map(d => <Button key={d.id} variant={selected?.id === d.id ? 'default' : 'outline'} onClick={() => setActive(d.id)}>{d.platform === 'master' ? '母稿' : platforms[d.platform]}</Button>)}</div>
    {selected ? <DocumentEditor key={selected.id} document={selected} canEdit={workspace.data.canManage} canReview={Boolean(workspace.data.canReview)} /> : <p className="py-10 text-center text-muted-foreground">创建母稿，开始写下核心观点。</p>}
    <TextHandoff project={project} documents={documents} />
    <Card><CardHeader><CardTitle>项目素材</CardTitle></CardHeader><CardContent className="space-y-4">
      {workspace.data.canManage && <div className="flex flex-wrap gap-2"><NativeSelect aria-label="选择素材" value={asset} onChange={e => setAsset(e.target.value)}><option value="">选择已登记的素材</option>{assets.data?.assets.filter(a => !linked.some(l => l.asset_id === a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect><Button variant="outline" disabled={!asset || busy} onClick={() => void run(() => linkAsset(project, Number(asset)))}>关联素材</Button><Button variant="ghost" nativeButton={false} render={<Link to="/assets" />}>管理资产</Button></div>}
      {assets.error && <p role="alert">素材选项读取失败，请到资产库检查。</p>}
      {linked.map(a => <p key={a.asset_id} className="text-sm"><Link className="underline" to={`/assets/${a.asset_id}`}>{a.assets.name}</Link> · {a.assets.media_type}</p>)}
      {!linked.length && <p className="text-sm text-muted-foreground">尚未关联素材。视频生成与合成在独立执行环境完成后，可将产物登记到资产库。</p>}
    </CardContent></Card>
  </div>
}
