import { useState } from "react"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NativeSelect } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { KnowledgeCategory, KnowledgeEntry } from "@/contracts/knowledge-base"
import { downloadText } from "@/hooks/use-content-action"
import { renderSafeMarkdown } from "@/lib/safe-markdown"
import { BUILTIN_KNOWLEDGE_BASE_ENTRIES, exportKnowledgeEntryToMarkdown } from "@/services/knowledge-base-service"

const categoryLabels: Record<KnowledgeCategory, string> = { sop: "写作 SOP", brand_voice: "品牌调性", domain_fact: "领域事实", decision_memory: "决定记忆" }

/**
 * Read-only view of the repository knowledge base (knowledge-base/*.md). The agent worker reads the same files;
 * edit them in git (reviewed like code), then `npm run kb:seed` refreshes this view.
 */
export function KnowledgeBasePage() {
  const [category, setCategory] = useState<"all" | KnowledgeCategory>("all")
  const [preview, setPreview] = useState<KnowledgeEntry | null>(null)
  const rows = BUILTIN_KNOWLEDGE_BASE_ENTRIES.filter((e) => category === "all" || e.category === category)

  return (
    <div className="space-y-6">
      <PageHeader
        title="知识库"
        description="知识条目来自仓库的 knowledge-base/ 目录，经 git 审阅后即为可信，Agent 执行节点直接读取这些文件。要修改请在仓库中编辑 Markdown。"
      />
      <div className="flex flex-wrap gap-3">
        <NativeSelect aria-label="分类" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          <option value="all">全部分类</option>
          {Object.entries(categoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
      </div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">暂无知识条目。</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>标题</TableHead><TableHead>分类</TableHead><TableHead>标签</TableHead><TableHead>来源</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.slug}>
                    <TableCell><div className="font-medium">{e.title}</div><div className="text-xs text-muted-foreground">{e.slug}</div></TableCell>
                    <TableCell>{categoryLabels[e.category] ?? e.category}</TableCell>
                    <TableCell className="whitespace-normal">{e.tags.map((t) => <Badge key={t} variant="outline" className="mr-1">{t}</Badge>)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{e.sourcePath ?? "—"}</TableCell>
                    <TableCell className="space-x-1 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => setPreview(e)}>预览</Button>
                      <Button variant="ghost" size="sm" onClick={() => downloadText(`${e.slug}.md`, exportKnowledgeEntryToMarkdown(e))}>导出</Button>
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
          <DialogHeader><DialogTitle>{preview?.title}</DialogTitle><DialogDescription>{preview?.slug}</DialogDescription></DialogHeader>
          {/* renderSafeMarkdown uses markdown-it with html:false */}
          {preview && <div className="console-prose max-w-none" data-testid="knowledge-preview" dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(preview.content) }} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
