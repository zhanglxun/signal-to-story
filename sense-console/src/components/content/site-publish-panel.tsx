import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/content/content-common'
import { useContentAction } from '@/hooks/use-content-action'
import { isLiveRelease, siteAccessLevels, type SiteAccessLevel } from '@/contracts/site-publish'
import type { ContentDocument } from '@/contracts/content'
import { sitePublishState } from '@/lib/site-publish-step'
import { decideSitePublishApproval, listSiteCategories, listSitePublishApprovals, listSiteReleasesForDocument, listSites, publishToSite, requestSitePublishApproval, unpublishFromSite } from '@/services/site-publish-service'

const stepHint = {
  not_approved: '稿件审核通过后才能请求发布到读者站。',
  request: '第 1 步：填写展示信息，然后请求发布批准。',
  wait_decision: '第 2 步：等待具有发布权限的成员批准。',
  publish: '第 3 步：批准已生效，可以发布到站点。',
  published: '该版本已在读者站上线。',
} as const

/** Publish an approved revision to the reader site: request Mandate, approve, publish, unpublish. Every step is an explicit click. */
export function SitePublishPanel({ document, canRequest, canPublish }: { document: ContentDocument; canRequest: boolean; canPublish: boolean }) {
  const { busy, run } = useContentAction()
  const sites = useQuery({ queryKey: ['document-history', document.id, 'sites', document.organization_id], queryFn: () => listSites(document.organization_id) })
  const [siteChoice, setSiteChoice] = useState('')
  const siteId = siteChoice || sites.data?.[0]?.id || ''
  const approvals = useQuery({ queryKey: ['document-history', document.id, 'site-approvals'], queryFn: () => listSitePublishApprovals(document.id), enabled: Boolean(siteId) })
  const releases = useQuery({ queryKey: ['document-history', document.id, 'site-releases'], queryFn: () => listSiteReleasesForDocument(document.id), enabled: Boolean(siteId) })
  const categories = useQuery({ queryKey: ['document-history', document.id, 'site-categories', siteId], queryFn: () => listSiteCategories(siteId), enabled: Boolean(siteId) })
  const [slug, setSlug] = useState('')
  const [summary, setSummary] = useState('')
  const [access, setAccess] = useState<SiteAccessLevel>('public')
  const [categoryId, setCategoryId] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const releaseList = releases.data ?? []
  const state = sitePublishState({ documentStatus: document.status, revision: document.revision, siteId, approvals: approvals.data ?? [], releases: releaseList })
  const hasHistory = releaseList.length > 0
  if (sites.isLoading) return null
  if (document.status !== 'approved' && !hasHistory) return null
  const meta = { slug, summary, access_level: access, category_id: categoryId || null }
  const live = releaseList.filter(isLiveRelease)
  return <Card><CardHeader><CardTitle className="flex flex-wrap items-center gap-2">发布到读者站<Badge variant="outline">v{document.revision}</Badge></CardTitle></CardHeader><CardContent className="space-y-4">
    {sites.error && <p role="alert" className="text-sm text-destructive">站点列表读取失败，请检查迁移与网络。</p>}
    {!sites.error && !sites.data?.length && <p className="text-sm text-muted-foreground">当前组织还没有读者站，请先在站点设置中创建。</p>}
    {siteId && <>
      {sites.data && sites.data.length > 1 && <Field label="目标站点"><NativeSelect value={siteId} onChange={e => setSiteChoice(e.target.value)}>{sites.data.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>}
      <p data-testid="site-step" className="text-sm">{stepHint[state.step]}</p>
      {state.staleApprovals && <p role="alert" className="text-sm text-destructive">稿件版本已变化，旧版本的发布批准已失效，需要对当前版本重新批准。</p>}
      {state.lastOutcome === 'rejected' && <p role="alert" className="text-sm text-destructive">上次批准请求被拒绝{state.approval?.reason ? `：${state.approval.reason}` : ''}。可修改后重新请求。</p>}
      {state.lastOutcome === 'expired' && <p role="alert" className="text-sm text-destructive">发布批准已过期，请重新请求批准。</p>}
      {(state.step === 'request' || state.step === 'publish') && <div className="grid gap-3 md:grid-cols-2">
        <Field label="站点链接标识（slug）"><Input value={slug} maxLength={96} placeholder="agent-basics" onChange={e => setSlug(e.target.value)} /></Field>
        <Field label="访问级别"><NativeSelect value={access} onChange={e => setAccess(e.target.value as SiteAccessLevel)}>{Object.entries(siteAccessLevels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
        <Field label="分类"><NativeSelect value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">未分类</option>{categories.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
        <Field label="人工摘要（1–500 字）"><Textarea value={summary} maxLength={500} onChange={e => setSummary(e.target.value)} /></Field>
      </div>}
      <div className="flex flex-wrap items-center gap-2">
        {state.step === 'request' && <Button disabled={busy || !canRequest || !slug.trim() || !summary.trim()} onClick={() => void run(() => requestSitePublishApproval({ organizationId: document.organization_id, siteId, documentId: document.id, revision: document.revision, slug: slug.trim().toLowerCase(), summary: summary.trim() }), '已提交发布批准请求')}>请求发布批准</Button>}
        {state.step === 'wait_decision' && state.approval && <>
          <Button disabled={busy || !canPublish} onClick={() => void run(() => decideSitePublishApproval(state.approval!.id, 'approved'), '已批准发布')}>批准</Button>
          <Input className="max-w-60" value={rejectReason} placeholder="拒绝原因" onChange={e => setRejectReason(e.target.value)} />
          <Button variant="outline" disabled={busy || !canPublish || !rejectReason.trim()} onClick={() => void run(() => decideSitePublishApproval(state.approval!.id, 'rejected', rejectReason.trim()), '已拒绝')}>拒绝</Button>
          {!canPublish && <span className="text-xs text-muted-foreground">批准需要站点发布权限（content.publish）。</span>}
        </>}
        {state.step === 'publish' && <Button disabled={busy || !canPublish || !slug.trim() || !summary.trim()} onClick={() => void run(async () => { await publishToSite(siteId, document.id, document.revision, meta) }, '已发布到读者站')}>发布到站点</Button>}
        {state.step === 'request' && !canRequest && <span className="text-xs text-muted-foreground">请求批准需要内容管理权限。</span>}
        {state.step === 'publish' && !canPublish && <span className="text-xs text-muted-foreground">发布需要站点发布权限（content.publish）。</span>}
      </div>
    </>}
    {hasHistory && <div className="space-y-2 border-t pt-4"><p className="text-sm font-medium">站点快照</p>
      {releaseList.map(r => <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
        <Badge variant="outline">站点 v{r.version}</Badge><span>稿件 v{r.source_revision}</span>
        <Badge>{isLiveRelease(r) ? '已上线' : r.entry?.status === 'online' ? '已被新版本替换' : '已下线'}</Badge>
        <span className="text-muted-foreground">{new Date(r.published_at).toLocaleString()}{r.entry ? ` · /${r.entry.slug}` : ''}</span>
        {isLiveRelease(r) && r.entry && canPublish && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => unpublishFromSite(r.entry_id), '已下线，历史快照保留')}>下线</Button>}
      </div>)}
      {live.length === 0 && <p className="text-xs text-muted-foreground">当前没有上线中的快照。</p>}
    </div>}
  </CardContent></Card>
}
