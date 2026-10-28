import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/site/page-state"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { usePageTitle } from "@/lib/use-page-title"
import { useCatalog } from "@/services/catalog"

export function TopicsPage() {
  usePageTitle("专题")
  const catalog = useCatalog()
  const topics = useQuery({
    queryKey: ["topics"],
    queryFn: () => catalog.listTopics(),
  })

  return (
    <div className="grid gap-6">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-medium tracking-tight">专题</h1>
        <p className="mt-3 text-muted-foreground">专题按阅读顺序串起已经上线的内容，和分类互不替代。</p>
      </header>
      {topics.isPending ? <LoadingBlock /> : null}
      {topics.isError ? <ErrorBlock onRetry={() => void topics.refetch()} /> : null}
      {topics.data && topics.data.length === 0 ? (
        <EmptyBlock title="还没有专题" description="专题上线后会列在这里。" />
      ) : null}
      {topics.data && topics.data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {topics.data.map((topic) => (
            <Card key={topic.slug}>
              <CardHeader>
                <CardTitle>
                  <Link to={`/topics/${topic.slug}`} className="rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50">
                    {topic.title}
                  </Link>
                </CardTitle>
                <CardDescription>{topic.description}</CardDescription>
                <p className="text-sm text-muted-foreground">{topic.itemCount} 篇</p>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  )
}
