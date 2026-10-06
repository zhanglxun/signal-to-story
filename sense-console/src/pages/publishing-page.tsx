import { reviewWindows } from '@/contracts/content-handoff'
import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { ContentState, Field } from '@/components/content/content-common'
import { downloadText, localDateValue, useContentAction } from '@/hooks/use-content-action'
import { exportMarkdown, optionalCount, platforms, platformKeys, type ContentDocument, type Metric, type Platform, type Publication, type PublishingChannel } from '@/contracts/content'
import { useContentData } from '@/hooks/use-content-data'
import { cancelPublication, createChannel, planPublication, publicationSnapshot, recordPublication, saveMetric } from '@/services/content-service'

export function PublishingPage({ mode = 'plans' }: { mode?: 'plans' | 'channels' }) {
  const content = useContentData()
  const { busy, run } = useContentAction()
  const [platform, setPlatform] = useState<Platform>('wechat_channels')
  const [name, setName] = useState('')
  const [profileUrl, setProfileUrl] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [scheduledAt, setScheduledAt] = useState(localDateValue())
  if (content.loading || content.error || !content.data || !content.workspace?.organization) return <ContentState {...content} hasOrg={Boolean(content.workspace?.organization)} />
  const { documents, channels, publications, metrics } = content.data
  const org = content.workspace.organization.id
  const canPublish = Boolean(content.workspace.canPublish)
  const approved = documents.filter(d => d.platform !== 'master' && d.status === 'approved')
  const selected = approved.find(d => d.id === documentId)
  return <div className="space-y-6">
    <PageHeader title={mode === 'channels' ? '渠道与账号' : '发布计划与记录'} description="首版采用导出、人工发布和结果回填。每条发布记录绑定具体稿件版本。" />
    {!canPublish && <p className="text-sm text-muted-foreground">当前为只读视图。发布操作需要 content.publish 权限。</p>}
    {mode === 'channels' ? <>
      {canPublish && <Card><CardHeader><CardTitle>登记自媒体账号</CardTitle></CardHeader><CardContent><form className="grid items-end gap-4 md:grid-cols-2" onSubmit={e => { e.preventDefault(); void run(async () => { await createChannel(org, platform, name, profileUrl); setName(''); setProfileUrl('') }) }}>
        <Field label="发布平台"><NativeSelect value={platform} onChange={e => setPlatform(e.target.value as Platform)}>{platformKeys.map(p => <option key={p} value={p}>{platforms[p]}</option>)}</NativeSelect></Field>
        <Field label="账号名称"><Input required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="主页链接（可选）"><Input type="url" value={profileUrl} onChange={e => setProfileUrl(e.target.value)} /></Field><Button type="submit" disabled={busy}>登记账号</Button>
      </form></CardContent></Card>}
      <div className="grid gap-4 md:grid-cols-2">{channels.map(c => <Card key={c.id}><CardContent className="space-y-2 py-5"><p className="font-medium">{c.name}</p><Badge variant="outline">{platforms[c.platform]}</Badge><p className="text-sm text-muted-foreground">人工发布 · 未连接自动发布授权</p>{c.profile_url && <a className="text-sm underline" href={c.profile_url} target="_blank" rel="noreferrer">打开账号主页</a>}</CardContent></Card>)}</div>
      {!channels.length && <p className="text-muted-foreground">尚未登记账号。</p>}
    </> : <>
      {canPublish && <Card><CardHeader><CardTitle>安排发布</CardTitle></CardHeader><CardContent><form className="grid gap-4 md:grid-cols-2" onSubmit={e => { e.preventDefault(); if (selected) void run(() => planPublication(selected, channelId, scheduledAt), '发布计划已保存，请导出审核版本后人工发布') }}>
        <Field label="已审核的平台稿件"><NativeSelect required value={documentId} onChange={e => { setDocumentId(e.target.value); setChannelId('') }}><option value="">请选择稿件</option>{approved.map(d => <option key={d.id} value={d.id}>{d.title} · {platforms[d.platform as Platform]} · v{d.revision}</option>)}</NativeSelect></Field>
        <Field label="发布账号"><NativeSelect required value={channelId} onChange={e => setChannelId(e.target.value)}><option value="">请选择匹配的平台账号</option>{channels.filter(c => c.platform === selected?.platform).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
        <Field label="计划时间（本地时区）"><Input required type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} /></Field>
        <div className="flex items-end gap-2"><Button type="submit" disabled={busy || !selected || !channelId}>保存发布计划</Button><Link className="text-sm underline" to="/publishing/channels">管理账号</Link></div>
      </form></CardContent></Card>}
      {!publications.length && <p className="text-muted-foreground">还没有发布计划。先完成平台稿件审核，再选择目标账号。</p>}
      {publications.map(p => <PublicationCard key={p.id} publication={p} document={documents.find(d => d.id === p.document_id)} channel={channels.find(c => c.id === p.channel_id)} metrics={metrics.filter(m => m.publication_id === p.id)} canPublish={canPublish} />)}
    </>}
  </div>
}
function PublicationCard({ publication, document, channel, metrics, canPublish }: { publication: Publication; document?: ContentDocument; channel?: PublishingChannel; metrics: Metric[]; canPublish: boolean }) {
  const [url, setUrl] = useState('')
  const [publishedAt, setPublishedAt] = useState(localDateValue())
  const [observedAt, setObservedAt] = useState(localDateValue())
  const [counts, setCounts] = useState({ views: '', likes: '', saves: '', comments: '' })
  const [retrospective, setRetrospective] = useState('')
  const { busy, run } = useContentAction()
  const stale = document?.revision !== publication.revision || document?.status !== 'approved'
  return <Card><CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{publication.title_snapshot ?? document?.title ?? '稿件'}<Badge variant="outline">v{publication.revision}</Badge><Badge>{({ planned: '待人工发布', published: '已发布', cancelled: '已取消' })[publication.status]}</Badge></CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">{channel && `${platforms[channel.platform]} · ${channel.name}`} · 计划 {new Date(publication.scheduled_at).toLocaleString()}</p>
    {publication.published_at && <p className="text-sm text-muted-foreground">复盘时间：{reviewWindows(publication.published_at).map(w => `${w.hours} 小时 ${new Date(w.dueAt).toLocaleString()}`).join(" · ")}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void run(async () => { const snapshot = await publicationSnapshot(publication); downloadText(`publication-${publication.id}.md`, exportMarkdown({ ...snapshot, platform: channel!.platform })) }, '已导出绑定的历史版本')}>导出发布版本</Button>{document && <Button variant="ghost" nativeButton={false} render={<Link to={`/content/projects/${document.project_id}`} />}>查看内容项目</Button>}</div>
    {publication.status === 'planned' && stale && <p role="alert" className="text-sm text-destructive">稿件已改版或待重新审核。请取消此计划，审核后重新排期。</p>}
    {publication.status === 'planned' && canPublish && <form className="space-y-3 border-t pt-4" onSubmit={e => { e.preventDefault(); void run(() => recordPublication(publication, url, publishedAt), '已记录人工发布结果') }}>
      <div className="grid gap-3 md:grid-cols-2"><Field label="实际发布链接"><Input type="url" required value={url} onChange={e => setUrl(e.target.value)} /></Field><Field label="实际发布时间"><Input type="datetime-local" required value={publishedAt} onChange={e => setPublishedAt(e.target.value)} /></Field></div>
      <div className="flex gap-2"><Button type="submit" disabled={busy || stale}>确认已人工发布</Button><Button variant="outline" type="button" disabled={busy} onClick={() => void run(() => cancelPublication(publication.id), '计划已取消')}>取消计划</Button></div>
    </form>}
    {publication.status === 'published' && <><a href={publication.published_url} className="block text-sm underline" target="_blank" rel="noreferrer">打开已发布内容</a>
      {canPublish && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">回填数据与复盘</summary><form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); void run(async () => { await saveMetric(publication, { observed_at: new Date(observedAt).toISOString(), views: optionalCount(counts.views), likes: optionalCount(counts.likes), saves: optionalCount(counts.saves), comments: optionalCount(counts.comments), retrospective }); setRetrospective('') }) }}>
        <Field label="观察时间"><Input type="datetime-local" required value={observedAt} onChange={e => setObservedAt(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-4">{Object.entries({ views: '阅读 / 播放', likes: '点赞', saves: '收藏', comments: '评论' }).map(([key, label]) => <Field key={key} label={label}><Input type="number" min={0} step={1} placeholder="未知留空" value={counts[key as keyof typeof counts]} onChange={e => setCounts({ ...counts, [key]: e.target.value })} /></Field>)}</div>
        <Field label="复盘结论与下次实验"><Textarea maxLength={10000} value={retrospective} onChange={e => setRetrospective(e.target.value)} /></Field><Button disabled={busy} type="submit">保存观察快照</Button>
      </form></details>}
      {metrics.map(m => <div key={m.id} className="rounded-lg bg-muted p-3 text-sm"><p>{new Date(m.observed_at).toLocaleString()} · 阅读 / 播放 {m.views ?? '未记录'} · 点赞 {m.likes ?? '未记录'} · 收藏 {m.saves ?? '未记录'} · 评论 {m.comments ?? '未记录'}</p><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{m.retrospective || '暂无复盘结论'}</p></div>)}
    </>}
  </CardContent></Card>
}
