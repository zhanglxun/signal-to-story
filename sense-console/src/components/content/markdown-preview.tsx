import { AlertTriangleIcon, FileTextIcon } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { renderSafeMarkdown } from "@/lib/safe-markdown"
import { analyzeMarkdown } from "@/lib/work-item-workflow"
import { cn } from "@/lib/utils"

export function MarkdownPreview({
  body,
  title,
  showMeta = true,
  emptyTitle = "暂无正文内容",
  emptyDescription = "可以通过「AI 助手」依据 Brief 生成初稿，或切换到「编辑原文」开始写作。",
  className,
}: {
  body: string
  title?: string
  showMeta?: boolean
  emptyTitle?: string
  emptyDescription?: string
  className?: string
}) {
  if (!body.trim()) {
    return (
      <Empty className={cn("border py-12", className)}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const stats = analyzeMarkdown(body)
  const html = renderSafeMarkdown(body)

  return (
    <div className={cn("space-y-4", className)}>
      {showMeta && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span>约 {stats.chars} 字</span>
            <span>·</span>
            <span>预计阅读 {stats.readingMinutes} 分钟</span>
            {stats.headingCount > 0 && (
              <>
                <span>·</span>
                <span>{stats.headingCount} 个章节</span>
              </>
            )}
          </div>
          {stats.unverifiedCount > 0 && (
            <Badge variant="outline" className="gap-1">
              <AlertTriangleIcon className="size-3" />
              含 {stats.unverifiedCount} 处 [待核实]
            </Badge>
          )}
        </div>
      )}

      {showMeta && stats.unverifiedCount > 0 && (
        <Alert>
          <AlertTriangleIcon className="size-4" />
          <AlertDescription>
            正文包含 {stats.unverifiedCount} 处 <code>[待核实]</code>{" "}
            标记，定稿前请核对事实来源并替换为准确表述。
          </AlertDescription>
        </Alert>
      )}

      {title && (
        <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      )}

      {/* renderSafeMarkdown uses markdown-it with html:false */}
      <div
        className="console-prose"
        data-testid="markdown-preview"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
