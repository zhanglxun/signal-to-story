import { useState } from "react"
import { ChevronDownIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { platforms, type ContentDocument, type Platform } from "@/contracts/content"
import {
  buildTextHandoff,
  textHandoffMarkdown,
} from "@/contracts/content-handoff"
import type { WorkItem } from "@/contracts/work-item"
import { downloadText } from "@/hooks/use-content-action"

export function TextHandoff({
  item,
  documents,
  embedded = false,
}: {
  item: WorkItem
  documents: ContentDocument[]
  embedded?: boolean
}) {
  const [open, setOpen] = useState(false)
  const handoff = buildTextHandoff(item, documents)
  const rehearsalMarkdown = textHandoffMarkdown(item, documents)

  async function copyRehearsal() {
    try {
      await navigator.clipboard.writeText(rehearsalMarkdown)
      toast.success("已复制演练包内容")
    } catch {
      toast.error("无法访问剪贴板，请使用导出功能")
    }
  }

  const content = (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        检查已保存版本并导出演练包。不会发送帖子、代替人工审核或产生发布量与阅读量。
      </p>
      {(
        <>
          {!handoff.checks.length && (
            <p className="text-sm text-muted-foreground">
              先从母稿创建平台版本，即可生成对应渠道的演练包与交接清单。
            </p>
          )}
          {handoff.checks.map((c) => (
            <p className="text-sm" key={c.document_id}>
              {platforms[c.platform as Platform]} · v{c.revision}：
              {c.next_action}
            </p>
          ))}
          <Collapsible
            open={open}
            onOpenChange={setOpen}
            className="rounded-lg border p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <CollapsibleTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
                  />
                }
              >
                <ChevronDownIcon
                  className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
                />
                查看演练内容（可复制）
              </CollapsibleTrigger>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!documents.length}
                onClick={() => void copyRehearsal()}
              >
                <CopyIcon className="size-3.5" />
                复制
              </Button>
            </div>
            <CollapsibleContent>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-sm">
                {rehearsalMarkdown}
              </pre>
            </CollapsibleContent>
          </Collapsible>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={!documents.length}
              onClick={() =>
                downloadText(
                  `text-rehearsal-${item.id}.md`,
                  rehearsalMarkdown
                )
              }
            >
              导出文字演练包
            </Button>
            <Button
              variant="outline"
              disabled={!documents.length}
              onClick={() =>
                downloadText(
                  `text-handoff-${item.id}.json`,
                  JSON.stringify(handoff, null, 2),
                  "application/json"
                )
              }
            >
              导出流程交接 JSON
            </Button>
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        人工发布到外部平台后，在稿件上回填发布链接即可；系统不抓取阅读数据。
      </p>
    </div>
  )

  if (embedded) return content

  return (
    <Card>
      <CardHeader>
        <CardTitle>文字发布演练与交接</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
