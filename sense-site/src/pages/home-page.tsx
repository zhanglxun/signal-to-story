import { ArrowRightIcon, LayersIcon } from "lucide-react"
import { useMemo } from "react"
import { Link } from "react-router"

import { EntryGrid } from "@/components/site/entry-card"
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/site/states"
import { Button } from "@/components/ui/button"
import { brandConfig } from "@/config/brand"
import { useCategories, useEntries, useSiteInfo, useTopics } from "@/features/site-queries"
import { usePageTitle } from "@/hooks/use-page-title"

export function HomePage() {
  usePageTitle()
  const site = useSiteInfo()
  const latest = useEntries({ limit: 6 })
  const categories = useCategories()
  const topics = useTopics()
  const entries = useMemo(() => latest.data?.pages.flatMap((page) => page.items) ?? [], [latest.data])
  const categoryNames = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data])
  // Categories without published entries do not take a homepage slot.
  const activeCategories = useMemo(
    () => (categories.data ?? []).filter((c) => entries.some((e) => e.category_id === c.id)),
    [categories.data, entries]
  )

  return (
    <div className="space-y-12">
      <section className="space-y-4 pt-2">
        <p className="text-sm text-muted-foreground">{brandConfig.englishName}</p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {site.data?.name ?? brandConfig.productName}
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">{site.data?.description || brandConfig.tagline}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button nativeButton={false} render={<Link to="/explore" />}>
            探索全部内容
            <ArrowRightIcon />
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link to="/topics" />}>
            按专题学习
          </Button>
        </div>
        {activeCategories.length > 0 && (
          <ul aria-label="主题分类" className="flex flex-wrap gap-2 pt-2">
            {activeCategories.map((category) => (
              <li key={category.id}>
                <Link
                  to={`/explore?category=${encodeURIComponent(category.slug)}`}
                  className="inline-flex rounded-full border px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="latest-heading" className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <h2 id="latest-heading" className="text-xl font-semibold">最新内容</h2>
          <Link to="/explore" className="text-sm text-muted-foreground hover:text-foreground">查看全部</Link>
        </div>
        {latest.isPending ? (
          <CardGridSkeleton />
        ) : latest.isError ? (
          <ErrorState message={latest.error.message} onRetry={() => void latest.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState>站点还没有上线的内容。</EmptyState>
        ) : (
          <EntryGrid entries={entries} categories={categoryNames} />
        )}
      </section>

      <section aria-labelledby="topics-heading" className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <h2 id="topics-heading" className="text-xl font-semibold">专题入口</h2>
          <Link to="/topics" className="text-sm text-muted-foreground hover:text-foreground">全部专题</Link>
        </div>
        {topics.isPending ? (
          <CardGridSkeleton count={2} />
        ) : topics.isError ? (
          <ErrorState message={topics.error.message} onRetry={() => void topics.refetch()} />
        ) : topics.data.length === 0 ? (
          <EmptyState>暂无上线的专题。</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {topics.data.slice(0, 4).map((topic) => (
              <Link key={topic.id} to={`/topics/${topic.slug}`} className="group flex gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-foreground/25">
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><LayersIcon className="size-5" /></span>
                <span className="min-w-0">
                  <span className="block font-semibold">{topic.title}</span>
                  <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">{topic.description}</span>
                  <span className="mt-2 block text-xs text-muted-foreground">{topic.entry_count} 篇内容</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
