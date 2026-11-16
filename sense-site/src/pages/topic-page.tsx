import { ArrowLeftIcon } from "lucide-react"
import { Link, useParams } from "react-router"

import { AccessBadge } from "@/components/site/entry-meta"
import { EmptyState, ErrorState, LoadingState } from "@/components/site/states"
import { entryFormats } from "@/contracts/site"
import { useTopic } from "@/features/site-queries"
import { usePageTitle } from "@/hooks/use-page-title"
import { formatDate } from "@/lib/format"
import { NotFoundPage } from "@/pages/not-found-page"

export function TopicPage() {
  const { slug = "" } = useParams()
  const topic = useTopic(slug)
  usePageTitle(topic.data?.topic.title)
  if (topic.isPending) return <LoadingState label="正在加载专题" />
  if (topic.isError) return <ErrorState message={topic.error.message} onRetry={() => void topic.refetch()} />
  if (!topic.data) return <NotFoundPage message="专题不存在或已下线。" />
  const { topic: info, entries } = topic.data
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-3">
        <Link to="/topics" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" />
          全部专题
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{info.title}</h1>
        <p className="text-muted-foreground">{info.description}</p>
      </div>
      {entries.length === 0 ? (
        <EmptyState>该专题暂时没有上线的内容。</EmptyState>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry, index) => (
            <li key={entry.id}>
              <Link to={`/content/${entry.slug}`} className="flex gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/25">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold tabular-nums">{index + 1}</span>
                <span className="min-w-0 space-y-1">
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {entryFormats[entry.format]} · {formatDate(entry.published_at)}
                    <AccessBadge level={entry.access_level} />
                  </span>
                  <span className="block font-semibold">{entry.title}</span>
                  <span className="line-clamp-2 block text-sm text-muted-foreground">{entry.summary}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
