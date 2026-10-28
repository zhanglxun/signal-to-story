import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { ContentGrid } from "@/components/site/content-card"
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/site/page-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { usePageTitle } from "@/lib/use-page-title"
import { useCatalog } from "@/services/catalog"

export function HomePage() {
  usePageTitle("首页")
  const catalog = useCatalog()
  const entries = useQuery({
    queryKey: ["home-entries"],
    queryFn: () => catalog.listEntries({ limit: 12 }),
  })
  const topics = useQuery({
    queryKey: ["topics"],
    queryFn: () => catalog.listTopics(),
  })

  if (entries.isPending || topics.isPending) return <LoadingBlock />
  if (entries.isError || topics.isError) {
    return (
      <ErrorBlock
        onRetry={() => {
          void entries.refetch()
          void topics.refetch()
        }}
      />
    )
  }

  const featured = entries.data.items.filter((entry) => entry.featured)
  const featuredIds = new Set(featured.map((entry) => entry.id))
  const latest = entries.data.items.filter((entry) => !featuredIds.has(entry.id)).slice(0, 4)
  const categories = new Map<string, string>()
  for (const entry of entries.data.items) categories.set(entry.categorySlug, entry.categoryName)

  return (
    <div className="grid gap-10">
      <header className="max-w-3xl">
        <p className="text-sm text-muted-foreground">读者站</p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">把已发布的内容读清楚</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          企业 AI 实战、知识科普、工具工作流，以及故事。首页只给已经有内容的分类留位置。
        </p>
      </header>

      {categories.size > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label="有内容的分类">
          {[...categories].map(([slug, name]) => (
            <Badge key={slug} variant="outline" render={<Link to={`/explore?category=${slug}`} />}>
              {name}
            </Badge>
          ))}
        </div>
      ) : null}

      <section className="grid gap-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-medium">精选</h2>
        </div>
        {featured.length === 0 ? (
          <EmptyBlock title="还没有精选" description="有内容发布并标为精选后，会出现在这里。" />
        ) : (
          <ContentGrid entries={featured} />
        )}
      </section>

      <section className="grid gap-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-medium">最新</h2>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/explore" />}>
            去探索
          </Button>
        </div>
        {latest.length === 0 ? (
          <EmptyBlock title="还没有更多内容" description="新的发布会出现在这个列表里。" />
        ) : (
          <ContentGrid entries={latest} />
        )}
      </section>

      <section className="grid gap-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-medium">专题</h2>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/topics" />}>
            全部专题
          </Button>
        </div>
        {topics.data.length === 0 ? (
          <EmptyBlock title="还没有专题" description="专题用来把几篇内容按学习顺序串起来。" />
        ) : (
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
        )}
      </section>
    </div>
  )
}
