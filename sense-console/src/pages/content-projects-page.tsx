import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { Badge } from '@/components/ui/badge'
import { ContentState, Field } from '@/components/content/content-common'
import { useContentAction } from '@/hooks/use-content-action'
import { kinds, type ProjectInput } from '@/contracts/content'
import { useContentData } from '@/hooks/use-content-data'
import { createProject } from '@/services/content-service'
import { selectionBrief } from '@/contracts/content-handoff'
import { getSignal } from '@/services/signal-service'
import { getSelection } from '@/services/selection-service'

export function ContentProjectsPage() {
  const content = useContentData()
  const [params] = useSearchParams()
  const selectionId = Number(params.get('selection')) || undefined
  const source = useQuery({ queryKey: ['selection', selectionId], queryFn: async () => { const selection = await getSelection(selectionId!); return selection ? { ...selection, signal: await getSignal(selection.signalId) } : null }, enabled: Boolean(selectionId) })
  const [creating, setCreating] = useState(Boolean(selectionId))
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const { busy, run } = useContentAction()
  if (content.loading || content.error || !content.workspace?.organization || !content.data) return <ContentState {...content} hasOrg={Boolean(content.workspace?.organization)} />
  const organizationId = content.workspace.organization.id
  const projects = content.data.projects.filter(p => p.title.toLowerCase().includes(search.toLowerCase()))
  return <div className="space-y-6">
    <PageHeader title="内容项目" description="从一个观点出发，在云端协作完成母稿、平台版本和发布。" actions={content.workspace.canManage && <Button onClick={() => setCreating(!creating)}>新建内容项目</Button>} />
    {creating && content.workspace.canManage && <Card><CardHeader><CardTitle>创建项目</CardTitle></CardHeader><CardContent>
      {source.isLoading ? <p>正在读取选题…</p> : source.error ? <p role="alert">选题读取失败，请返回选题重试。</p> : selectionId && !source.data ? <p role="alert">选题不存在或无权访问。</p> : <ProjectForm key={source.data?.id ?? 'new'} busy={busy} initial={{ title: source.data?.name ?? '', brief: source.data ? selectionBrief(source.data, source.data.signal) : '', content_kind: 'explainer', target_seconds: 300, aspect_ratio: '9:16' }} onSave={async input => {
        await run(async () => { const project = await createProject(organizationId, input, selectionId); navigate(`/content/projects/${project.id}`) })
      }} />}
    </CardContent></Card>}
    <Input aria-label="搜索内容项目" placeholder="搜索项目名称" value={search} onChange={e => setSearch(e.target.value)} />
    {!projects.length && <Card><CardContent className="py-12 text-center text-muted-foreground">还没有匹配的项目。从选题立项，或直接创建第一个内容项目。</CardContent></Card>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{projects.map(project => {
      const docs = content.data!.documents.filter(d => d.project_id === project.id)
      return <Card key={project.id}><CardHeader><CardTitle><Link to={`/content/projects/${project.id}`} className="hover:underline">{project.title}</Link></CardTitle></CardHeader><CardContent className="space-y-3">
        <Badge variant="outline">{kinds[project.content_kind]}</Badge><p className="line-clamp-3 text-sm text-muted-foreground">{project.brief || '待填写创作 Brief'}</p>
        <p className="text-xs text-muted-foreground">{docs.length} 份稿件 · {docs.filter(d => d.status === 'approved').length} 份已通过 · {project.aspect_ratio} / {project.target_seconds} 秒</p>
      </CardContent></Card>
    })}</div>
  </div>
}
export function ProjectForm({ initial, busy, onSave }: { initial: ProjectInput & { updated_at?: string }; busy: boolean; onSave: (input: ProjectInput, baseUpdatedAt?: string) => Promise<string | void> }) {
  const [value, setValue] = useState(initial)
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(initial.updated_at)
  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); void onSave(value, baseUpdatedAt).then(updatedAt => { if (updatedAt) setBaseUpdatedAt(updatedAt) }) }}>
    <Field label="项目名称"><Input required maxLength={160} value={value.title} onChange={e => setValue({ ...value, title: e.target.value })} /></Field>
    <div className="grid gap-4 sm:grid-cols-3"><Field label="内容类型"><NativeSelect value={value.content_kind} onChange={e => setValue({ ...value, content_kind: e.target.value as ProjectInput['content_kind'] })}>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></Field>
      <Field label="目标时长（秒）"><Input type="number" min={1} max={3600} required value={value.target_seconds} onChange={e => setValue({ ...value, target_seconds: Number(e.target.value) })} /></Field>
      <Field label="画面比例"><NativeSelect value={value.aspect_ratio} onChange={e => setValue({ ...value, aspect_ratio: e.target.value as ProjectInput['aspect_ratio'] })}>{['9:16', '16:9', '1:1'].map(v => <option key={v}>{v}</option>)}</NativeSelect></Field></div>
    <Field label="创作 Brief"><Textarea className="min-h-32" maxLength={20000} value={value.brief} placeholder="受众、核心观点、证据来源、表达风格、目标平台…" onChange={e => setValue({ ...value, brief: e.target.value })} /></Field>
    <Button disabled={busy} type="submit">{busy ? '正在保存…' : '保存项目'}</Button>
  </form>
}
