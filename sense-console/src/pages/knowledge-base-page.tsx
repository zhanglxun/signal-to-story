import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { UploadIcon } from "lucide-react"
import { toast } from "sonner"

import { ContentState } from "@/components/content/content-common"
import { KnowledgeImportDialog } from "@/components/knowledge/knowledge-import-dialog"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NativeSelect } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { KnowledgeTrustLevel } from "@/contracts/agent-harness"
import type { KnowledgeCategory, StoredKnowledgeEntry } from "@/contracts/knowledge-base"
import { downloadText } from "@/hooks/use-content-action"
import { renderSafeMarkdown } from "@/lib/safe-markdown"
import { archiveKnowledgeEntry, exportKnowledgeMarkdown, listKnowledgeEntries, markKnowledgeTrusted, restoreKnowledgeEntry } from "@/services/knowledge-base-service"
import { getContentWorkspace } from "@/services/content-workspace-service"

const categoryLabels: Record<KnowledgeCategory, string> = { sop: "写作 SOP", brand_voice: "品牌调性", domain_fact: "领域事实", decision_memory: "决定记忆" }
const trustLabels: Record<KnowledgeTrustLevel, string> = { trusted: "可信", unreviewed: "未审核", archived: "已归档" }

export function KnowledgeBasePage() {
  const queryClient = useQueryClient()
  const workspace = useQuery({ queryKey: ["content-workspace"], queryFn: getContentWorkspace })
  const org = workspace.data?.organization?.id
  const canManage = Boolean(workspace.data?.canManage)
  const canReview = Boolean(workspace.data?.canReview)
  const [category, setCategory] = useState<"all" | KnowledgeCategory>("all")
  const [trust, setTrust] = useState<"all" | KnowledgeTrustLevel>("all")
  const [preview, setPreview] = useState<StoredKnowledgeEntry | null>(null)

  const entries = useQuery({
    queryKey: ["knowledge-entries", org, category, trust],
    enabled: Boolean(org),
    queryFn: () => listKnowledgeEntries(org!, { category: category === "all" ? undefined : category, trustLevels: trust === "all" ? undefined : [trust] }),
  })
  const change = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "trust" | "archive" | "restore" }) =>
      action === "trust" ? markKnowledgeTrusted(id) : action === "archive" ? archiveKnowledgeEntry(id) : restoreKnowledgeEntry(id),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["knowledge-entries"] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "操作失败"),
  })

  if (workspace.isLoading || workspace.error || !org) return <ContentState loading={workspace.isLoading} error={workspace.error} hasOrg={Boolean(org)} />
  const rows = entries.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="知识库"
        description="云端知识条目。只有「可信」条目会进入 Agent 的系统指令区；「未审核」仅作为不可信参考资料。标记可信需要 content.review 权限，由数据库强制。"
        actions={canManage && <KnowledgeImportDialog organizationId={org} trigger={<Button><UploadIcon />导入 Markdown</Button>} />}
      />
      <div className="flex flex-wrap gap-3">
        <NativeSelect aria-label="分类" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          <option value="all">全部分类</option>
          {Object.entries(categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="可信等级" value={trust} onChange={(e) => setTrust(e.target.value as typeof trust)}>
          <option value="all">全部等级</option>
          {Object.entries(trustLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
      </div>
      <Card>
        <CardContent className="p-0">
          {entries.isLoading ? <p role="status" className="p-6 text-sm">正在读取…</p> : entries.error ? <p className="p-6 text-sm text-destructive">{entries.error.message}</p> : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">暂无知识条目。可导入 Markdown，导入后为「未审核」。</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>标题</TableHead><TableHead>分类</TableHead><TableHead>标签</TableHead><TableHead>可信等级</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell><div className="font-medium">{e.title}</div><div className="text-xs text-muted-foreground">{e.slug}</div></TableCell>
                    <TableCell>{categoryLabels[e.category] ?? e.category}</TableCell>
                    <TableCell className="whitespace-normal">{e.tags.map((t) => <Badge key={t} variant="outline" className="mr-1">{t}</Badge>)}</TableCell>
                    <TableCell><Badge variant={e.trustLevel === "trusted" ? "secondary" : "outline"}>{trustLabels[e.trustLevel]}</Badge></TableCell>
                    <TableCell className="space-x-1 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => setPreview(e)}>预览</Button>
                      <Button variant="ghost" size="sm" onClick={() => downloadText(`${e.slug}.md`, exportKnowledgeMarkdown(e))}>导出</Button>
                      {canReview && e.trustLevel !== "trusted" && e.trustLevel !== "archived" && <Button variant="outline" size="sm" disabled={change.isPending} onClick={() => change.mutate({ id: e.id, action: "trust" })}>标记可信</Button>}
                      {canManage && e.trustLevel !== "archived" && <Button variant="outline" size="sm" disabled={change.isPending} onClick={() => change.mutate({ id: e.id, action: "archive" })}>归档</Button>}
                      {canManage && e.trustLevel === "archived" && <Button variant="outline" size="sm" disabled={change.isPending} onClick={() => change.mutate({ id: e.id, action: "restore" })}>恢复为未审核</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>{preview?.title}</DialogTitle><DialogDescription>{preview ? `${preview.slug} · ${trustLabels[preview.trustLevel]}` : ""}</DialogDescription></DialogHeader>
          {/* renderSafeMarkdown uses markdown-it with html:false */}
          {preview && <div className="prose prose-sm max-w-none dark:prose-invert" data-testid="knowledge-preview" dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(preview.content) }} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
