import { LayersIcon } from "lucide-react"
import { Link } from "react-router"

import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/site/states"
import { useTopics } from "@/features/site-queries"
import { usePageTitle } from "@/hooks/use-page-title"

export function TopicsPage() {
  usePageTitle("专题")
  const topics = useTopics()
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">专题</h1>
        <p className="text-sm text-muted-foreground">按学习路径串联的内容合集，按顺序阅读效果最好。</p>
      </header>
      {topics.isPending ? (
        <CardGridSkeleton count={4} />
      ) : topics.isError ? (
        <ErrorState message={topics.error.message} onRetry={() => void topics.refetch()} />
      ) : topics.data.length === 0 ? (
        <EmptyState>暂无上线的专题。</EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {topics.data.map((topic) => (
            <li key={topic.id}>
              <Link to={`/topics/${topic.slug}`} className="flex h-full gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-foreground/25">
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><LayersIcon className="size-5" /></span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold">{topic.title}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{topic.description}</span>
                  <span className="mt-3 block text-xs text-muted-foreground">{topic.entry_count} 篇内容</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
