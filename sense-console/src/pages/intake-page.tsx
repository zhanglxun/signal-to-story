import { useState } from "react"
import { useNavigate } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { ExternalLinkIcon, InboxIcon } from "lucide-react"

import { Field } from "@/components/content/content-common"
import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { intakeSourceLabels, type IntakeEvent, type WorkItem } from "@/contracts/work-item"
import { useContentAction } from "@/hooks/use-content-action"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { attachInput, ignoreInput, listInbox, promoteInput, recordManualInput } from "@/services/intake-service"
import { listWorkItems } from "@/services/work-item-service"

const PAGE_SIZE = 20

function safeUrl(value: string | null) {
  if (!value) return null
  try { return ["http:", "https:"].includes(new URL(value).protocol) ? value : null } catch { return null }
}

export function IntakePage() {
  const [page, setPage] = useState(1)
  const workspace = useQuery({ queryKey: ["content-workspace"], queryFn: getContentWorkspace })
  const org = workspace.data?.organization?.id
  const canManage = Boolean(workspace.data?.canManage)
  const inbox = useQuery({ queryKey: ["intake-inbox", org, page], queryFn: () => listInbox(org!, page, PAGE_SIZE), enabled: Boolean(org) })
  const openItems = useQuery({
    queryKey: ["work-item", "open-options", org],
    queryFn: async () => (await listWorkItems(org!)).filter((i) => i.status !== "done" && i.status !== "dropped"),
    enabled: Boolean(org && canManage),
  })

  if (workspace.isLoading) return <p className="text-sm text-muted-foreground">正在加载收件箱…</p>
  if (workspace.isError) return <Alert variant="destructive"><AlertTitle>无法加载收件箱</AlertTitle><AlertDescription>{workspace.error.message}</AlertDescription></Alert>
  if (!org) return <Alert><AlertTitle>账号尚未加入组织</AlertTitle><AlertDescription>请先完成组织和 Owner 初始化。</AlertDescription></Alert>

  const events = inbox.data?.events ?? []
  const totalCount = inbox.data?.totalCount ?? 0
  return (
    <div className="space-y-6">
      <PageHeader
        title="收件箱"
        description="速记、IM 和外部接口收到的每一条输入都先放在这里。转为事项、归入已有事项，或忽略。"
      />
      {canManage && <RecordInputCard organizationId={org} />}
      {inbox.isError && <Alert variant="destructive"><AlertTitle>无法读取收件箱</AlertTitle><AlertDescription>{inbox.error.message}</AlertDescription></Alert>}
      {inbox.isLoading && <p className="text-sm text-muted-foreground">正在读取…</p>}
      {!inbox.isLoading && !inbox.isError && events.length === 0 && (
        <Empty className="min-h-60 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><InboxIcon /></EmptyMedia>
            <EmptyTitle>收件箱是空的</EmptyTitle>
            <EmptyDescription>新的输入会出现在这里。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <div className="space-y-3">
        {events.map((event) => <InboxRow key={event.id} event={event} canManage={canManage} openItems={openItems.data ?? []} />)}
      </div>
      <PaginationBar page={page} pageCount={Math.max(1, Math.ceil(totalCount / PAGE_SIZE))} totalCount={totalCount} onPageChange={setPage} />
    </div>
  )
}

function RecordInputCard({ organizationId }: { organizationId: string }) {
  const [text, setText] = useState("")
  const [url, setUrl] = useState("")
  const { busy, run } = useContentAction()
  return (
    <Card>
      <CardHeader><CardTitle>记录一条</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault()
          void run(() => recordManualInput(organizationId, { text, url: url.trim() }), "已记入收件箱").then((ok) => { if (ok) { setText(""); setUrl("") } })
        }}>
          <Field label="内容"><Textarea maxLength={20000} value={text} placeholder="一句想法、一段摘录…" onChange={(e) => setText(e.target.value)} /></Field>
          <Field label="链接（可选）"><Input type="url" maxLength={2048} value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} /></Field>
          <Button type="submit" disabled={busy || (!text.trim() && !url.trim())}>记录</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function InboxRow({ event, canManage, openItems }: { event: IntakeEvent; canManage: boolean; openItems: WorkItem[] }) {
  const [target, setTarget] = useState("")
  const { busy, run } = useContentAction()
  const navigate = useNavigate()
  const url = safeUrl(event.url)
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{intakeSourceLabels[event.source]}</Badge>
          <span>{new Date(event.created_at).toLocaleString()}</span>
        </div>
        {event.text && <p className="line-clamp-4 text-sm break-words whitespace-pre-wrap">{event.text}</p>}
        {url && <a className="inline-flex items-center gap-1 text-sm break-all underline" href={url} target="_blank" rel="noreferrer"><ExternalLinkIcon className="size-3.5 shrink-0" />{url}</a>}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void run(async () => { const item = await promoteInput(event); navigate(`/work-items/${item.id}`) }, "已转为事项")}>转为事项</Button>
            <NativeSelect size="sm" aria-label="选择要归入的事项" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">归入事项…</option>
              {openItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </NativeSelect>
            <Button size="sm" variant="outline" disabled={busy || !target} onClick={() => void run(() => attachInput(event, target), "已归入事项")}>归入</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => ignoreInput(event), "已忽略")}>忽略</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
