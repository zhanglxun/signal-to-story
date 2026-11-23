import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router"
import { CheckCircle2Icon, ShieldCheckIcon } from "lucide-react"

import { ContentState } from "@/components/content/content-common"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { platforms, statusLabels } from "@/contracts/content"
import { workItemStatusLabels } from "@/contracts/work-item"
import { useContentData } from "@/hooks/use-content-data"
import { listReviewQueueItems } from "@/lib/work-item-workflow"

type ReviewFilter = "all" | "ai_draft" | "submitted"

export function ContentOverviewPage({
  mode = "overview",
}: {
  mode?: "overview" | "reviews" | "pipeline" | "analytics"
}) {
  const content = useContentData()
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all")
  const queryClient = useQueryClient()

  if (
    content.loading ||
    content.error ||
    !content.data ||
    !content.workspace?.organization
  ) {
    return (
      <ContentState
        {...content}
        hasOrg={Boolean(content.workspace?.organization)}
      />
    )
  }

  const { workItems, documents } = content.data
  const openItems = workItems.filter(
    (i) => i.status !== "done" && i.status !== "dropped"
  )
  const reviewQueue = listReviewQueueItems(workItems, documents)
  const visibleReviews =
    reviewFilter === "all"
      ? reviewQueue
      : reviewQueue.filter((r) => r.kind === reviewFilter)
  const aiDraftCount = reviewQueue.filter((r) => r.kind === "ai_draft").length
  const submittedCount = reviewQueue.filter(
    (r) => r.kind === "submitted"
  ).length
  const published = documents.filter((d) => d.published_at || d.published_url)

  const titles = {
    overview: "创作工作台",
    reviews: "审核中心",
    pipeline: "内容生产流程",
    analytics: "发布记录",
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={titles[mode]}
        description={
          mode === "pipeline"
            ? "固定流程：收件箱 → 事项 → 母稿 → 平台版本 → 人工审核 → 发布。视频执行独立接入。"
            : mode === "reviews"
              ? "统一汇聚 AI 刚写完待审阅的草稿与已提交待审核的稿件，进入详情页可一键定稿。"
              : "所有状态来自云端实际记录。"
        }
        actions={
          <Button nativeButton={false} render={<Link to="/work-items" />}>
            进入事项
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["进行中事项", openItems.length],
          ["待审阅 / 审核", reviewQueue.length],
          ["已定稿待发布", documents.filter((d) => d.status === "approved" && !d.published_at && !d.published_url).length],
          ["已发布稿件", published.length],
        ].map(([label, count]) => (
          <Card key={label}>
            <CardContent className="py-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">
                {count}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {(mode === "overview" || mode === "reviews") && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheckIcon className="size-4" />
              <span>待审核与待审阅</span>
            </CardTitle>
            {mode === "reviews" && reviewQueue.length > 0 && (
              <Tabs
                value={reviewFilter}
                onValueChange={(v) =>
                  v && setReviewFilter(v as ReviewFilter)
                }
              >
                <TabsList>
                  <TabsTrigger value="all">
                    全部 {reviewQueue.length}
                  </TabsTrigger>
                  <TabsTrigger value="ai_draft">
                    AI 草稿 {aiDraftCount}
                  </TabsTrigger>
                  <TabsTrigger value="submitted">
                    已提交 {submittedCount}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {!visibleReviews.length ? (
              <Empty className="border py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CheckCircle2Icon />
                  </EmptyMedia>
                  <EmptyTitle>暂无待审核内容</EmptyTitle>
                  <EmptyDescription>
                    当 AI 完成出稿写入草稿，或有人手动提交审核时，会自动出现在这里。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              visibleReviews.map((entry) => {
                const targetUrl = entry.workItemId
                  ? `/work-items/${entry.workItemId}`
                  : "/work-items"
                const platformLabel =
                  entry.platform === "master"
                    ? "母稿"
                    : entry.platform
                      ? platforms[entry.platform]
                      : "待建稿"
                return (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3.5"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          className="font-medium hover:underline"
                          to={targetUrl}
                          onClick={() =>
                            void queryClient.invalidateQueries({
                              queryKey: ["work-item", entry.workItemId],
                            })
                          }
                        >
                          {entry.title}
                        </Link>
                        <Badge
                          variant={
                            entry.kind === "submitted" ? "default" : "outline"
                          }
                        >
                          {entry.statusLabel}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {platformLabel}
                        {entry.revision != null ? ` · v${entry.revision}` : ""} ·{" "}
                        {entry.hint} · 更新于{" "}
                        {new Date(entry.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      nativeButton={false}
                      render={<Link to={targetUrl} />}
                    >
                      去审阅定稿
                    </Button>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      )}

      {(mode === "overview" || mode === "pipeline") && (
        <Card>
          <CardHeader>
            <CardTitle>事项进度</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!openItems.length && (
              <p className="text-sm text-muted-foreground">
                还没有进行中的事项。新建事项后，这里会展示实际制作进度。
              </p>
            )}
            {openItems.map((p) => {
              const docs = documents.filter((d) => d.work_item_id === p.id)
              const pubs = docs.filter((d) => d.published_at || d.published_url)
              return (
                <div key={p.id} className="rounded-lg border p-4">
                  <Link
                    className="font-medium hover:underline"
                    to={`/work-items/${p.id}`}
                  >
                    {p.title}
                  </Link>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>{workItemStatusLabels[p.status]}</Badge>
                    {!docs.length && (
                      <Badge variant="outline">等待创建母稿</Badge>
                    )}
                    {docs.map((d) => (
                      <Badge key={d.id} variant="outline">
                        {d.platform === "master"
                          ? "母稿"
                          : platforms[d.platform]}
                        ：{statusLabels[d.status]}
                      </Badge>
                    ))}
                    <Badge variant="secondary">
                      已发布 {pubs.length}
                    </Badge>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {mode === "analytics" && (
        <Card>
          <CardHeader>
            <CardTitle>已发布稿件</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              读者站上线来自发布操作；外部平台为人工发布后回填的链接。系统不抓取阅读数据。
            </p>
            {!published.length && (
              <p className="text-sm">还没有已发布的稿件。稿件定稿后可在事项详情页发布或回填链接。</p>
            )}
            {published.map((doc) => (
              <div key={doc.id} className="rounded-lg border p-4">
                <Link className="font-medium hover:underline" to={`/work-items/${doc.work_item_id}`}>
                  {doc.published_title ?? doc.title}
                </Link>
                <p className="mt-2 text-sm text-muted-foreground">
                  {doc.platform === "master" ? "母稿" : platforms[doc.platform]}
                  {doc.published_at ? ` · 读者站 v${doc.published_revision} · ${new Date(doc.published_at).toLocaleString()}` : ""}
                  {doc.published_url ? " · 外部链接已登记" : ""}
                </p>
                {doc.published_url ? (
                  <a className="mt-1 block text-sm break-all underline" href={doc.published_url} target="_blank" rel="noreferrer">
                    {doc.published_url}
                  </a>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
