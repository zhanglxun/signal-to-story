import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { canTransition, exportMarkdown, platforms, statusLabels, type ContentDocument, type DocumentStatus } from '@/contracts/content'
import { documentHistory, reviewDocument, saveDocument, getAiProposals, generateDraft } from '@/services/content-service'
import { Field } from '@/components/content/content-common'
import { downloadText, useContentAction } from '@/hooks/use-content-action'

export function DocumentEditor({ document, canEdit, canReview }: { document: ContentDocument; canEdit: boolean; canReview: boolean }) {
  const [base, setBase] = useState(document)
  const [title, setTitle] = useState(document.title)
  const [body, setBody] = useState(document.body)
  const [note, setNote] = useState('')
  const [instruction, setInstruction] = useState('根据项目 Brief 和当前稿件完善一份可审核的内容草案。')
  const { busy, run } = useContentAction()
  const history = useQuery({ queryKey: ['document-history', document.id], queryFn: () => documentHistory(document.id) })
  const proposals = useQuery({ queryKey: ['document-history', document.id, 'ai'], queryFn: () => getAiProposals(document.id), refetchInterval: query => query.state.data?.some(p => p.status === 'running') ? 5000 : false })
  const dirty = title !== base.title || body !== base.body
  const stale = base.revision !== document.revision || base.status !== document.status
  async function transition(status: DocumentStatus) {
    await run(async () => { const updated = await reviewDocument(base, status, note); setBase(updated); setNote('') }, '审核状态已更新')
  }
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{base.platform === 'master' ? '母稿' : platforms[base.platform]}<Badge variant="outline">v{base.revision}</Badge><Badge>{statusLabels[base.status]}</Badge></CardTitle></CardHeader><CardContent className="space-y-4">
      {stale && <Alert><AlertDescription>云端稿件已变化，当前输入仍保留。请先复制需要保留的内容，再载入云端版本。<Button variant="outline" size="sm" onClick={() => { setBase(document); setTitle(document.title); setBody(document.body) }}>载入云端版本</Button></AlertDescription></Alert>}
      <Field label="稿件标题"><Input maxLength={200} value={title} disabled={!canEdit || busy} onChange={e => setTitle(e.target.value)} /></Field>
      <Field label="正文（Markdown）"><Textarea className="min-h-80 font-mono leading-7" maxLength={100000} value={body} disabled={!canEdit || busy} onChange={e => setBody(e.target.value)} /></Field>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && <Button disabled={busy || !dirty || stale} onClick={() => void run(async () => { const saved = await saveDocument(base, title, body); setBase(saved); setTitle(saved.title); setBody(saved.body) })}>保存新版本</Button>}
        {canTransition(base.status, 'in_review', canEdit, canReview) && <Button variant="outline" disabled={busy || dirty || stale || !body.trim()} onClick={() => void transition('in_review')}>提交审核</Button>}
        <Button variant="outline" disabled={dirty || stale} onClick={() => downloadText(`content-${base.id}-v${base.revision}.md`, exportMarkdown(base))}>导出 Markdown</Button>
        <span className="text-xs text-muted-foreground">{dirty ? '有未保存修改' : '已保存到云端'} · 改稿后需要重新审核</span>
      </div>
      {base.review_note && <p className="text-sm">最近审核意见：{base.review_note}</p>}
      {canReview && base.status === 'in_review' && <div className="space-y-3 border-t pt-4"><Field label="审核意见"><Textarea value={note} maxLength={4000} onChange={e => setNote(e.target.value)} placeholder="退回时请说明需要修改的内容" /></Field><div className="flex gap-2">
        <Button disabled={busy || dirty || stale} onClick={() => void transition('approved')}>审核通过</Button>
        <Button variant="outline" disabled={busy || dirty || stale || !note.trim()} onClick={() => void transition('changes_requested')}>退回修改</Button>
      </div></div>}
    </CardContent></Card>
    {canEdit && <Card><CardHeader><CardTitle>AI 创作提案</CardTitle></CardHeader><CardContent className="space-y-3">
      <Field label="创作要求"><Textarea value={instruction} maxLength={4000} onChange={e => setInstruction(e.target.value)} /></Field>
      <Button variant="outline" disabled={busy || dirty || stale || !instruction.trim() || proposals.data?.some(p => p.status === 'running')} onClick={() => void run(async () => { try { await generateDraft(base.id, instruction) } finally { await proposals.refetch() } }, '草案已生成，请审阅后采纳')}>生成文字草案</Button>
      <p className="text-xs text-muted-foreground">使用已保存的稿件与 Brief 生成提案。采纳后仍需保存版本并人工审核。</p>
      {proposals.error && <p role="alert" className="text-sm">提案记录读取失败。</p>}
      {proposals.data?.map(p => <details className="rounded-lg border p-3" key={p.id}><summary className="cursor-pointer text-sm">{p.model} · 输入 v{p.input_revision} · {({ running: '生成中', succeeded: '待人工审阅', failed: '失败' })[p.status]} · {new Date(p.created_at).toLocaleString()}</summary>
        {p.error && <p className="mt-2 text-sm text-destructive">{p.error}</p>}{p.body && <><pre className="my-3 max-h-96 overflow-auto whitespace-pre-wrap text-sm">{p.body}</pre><Button variant="outline" disabled={busy || dirty || stale || p.input_revision !== base.revision} onClick={() => setBody(p.body!)}>采纳到编辑区</Button>{p.input_revision !== base.revision && <p className="text-xs text-muted-foreground">输入版本已过期，请复制需要的片段后手动合并。</p>}</>}
        {p.usage?.total_tokens != null && <p className="mt-2 text-xs text-muted-foreground">Token 用量：{p.usage.total_tokens} · 实际费用以供应商账单为准</p>}
      </details>)}
    </CardContent></Card>}
    <Card><CardHeader><CardTitle>版本与审核记录</CardTitle></CardHeader><CardContent className="space-y-4">
      {history.error && <p role="alert">版本历史读取失败，请刷新重试。</p>}
      {history.data?.revisions.map(revision => <details key={revision.id} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">v{revision.revision} · {new Date(revision.created_at).toLocaleString()} · {revision.title}</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-sm">{revision.body}</pre></details>)}
      {history.data?.reviews.map(event => <p key={event.id} className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()} · v{event.revision} · {statusLabels[event.status]}{event.note && `：${event.note}`} · 操作人 {event.created_by.slice(0, 8)}</p>)}
    </CardContent></Card>
  </div>
}
