import { useQuery } from "@tanstack/react-query"
import { HistoryIcon } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { historyActionLabels } from "@/contracts/content"
import { documentHistory } from "@/services/content-service"

/**
 * Review, AI-draft and publishing history of a document (audit_events). Versions are counted, not stored:
 * the MVP keeps no revision snapshots (docs/database.md §3).
 */
export function DocumentHistoryPanel({
  documentId,
  embedded = false,
}: {
  documentId: string
  embedded?: boolean
}) {
  const history = useQuery({
    queryKey: ["document-history", documentId],
    queryFn: () => documentHistory(documentId),
  })
  const events = history.data ?? []

  const content = (
    <div className="space-y-4">
      {history.error && (
        <Alert variant="destructive">
          <AlertDescription>审核记录读取失败，请刷新重试。</AlertDescription>
        </Alert>
      )}

      {!history.isLoading && !history.error && events.length === 0 && (
        <Empty className="border py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyTitle>暂无审核记录</EmptyTitle>
            <EmptyDescription>
              提交审核、审核决定、AI 写入与发布操作会记录在这里；不保存历史版本正文。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {events.length > 0 && (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-xs"
            >
              <Badge variant={event.action === "content.approved" || event.action === "content.published" ? "default" : "outline"}>
                {historyActionLabels[event.action] ?? event.action}
              </Badge>
              {event.revision != null && <span className="font-medium">v{event.revision}</span>}
              {event.note && <span className="text-foreground">· {event.note}</span>}
              <span className="ml-auto text-muted-foreground">
                {new Date(event.created_at).toLocaleString()}
                {event.actor_user_id ? ` · 操作人 ${event.actor_user_id.slice(0, 8)}` : " · Agent"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  if (embedded) return content

  return (
    <Card>
      <CardHeader>
        <CardTitle>审核与发布记录</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
