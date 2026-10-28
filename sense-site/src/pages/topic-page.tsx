import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router"

import { ContentCard } from "@/components/site/content-card"
import { ErrorBlock, LoadingBlock, NotFoundState } from "@/components/site/page-state"
import { usePageTitle } from "@/lib/use-page-title"
import { useCatalog } from "@/services/catalog"

export function TopicPage() {
  const { slug = "" } = useParams()
  const catalog = useCatalog()
  const topic = useQuery({
    queryKey: ["topic", slug],
    queryFn: () => catalog.getTopic(slug),
  })
  usePageTitle(topic.data?.title ?? "专题")

  if (topic.isPending) return <LoadingBlock />
  if (topic.isError) return <ErrorBlock onRetry={() => void topic.refetch()} />
  if (!topic.data) {
    return <NotFoundState title="没有这个专题" description="专题可能还没上线，或者地址写错了。" />
  }

  return (
    <div className="grid gap-6">
      <header className="max-w-3xl">
        <p className="text-sm text-muted-foreground">专题</p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight">{topic.data.title}</h1>
        <p className="mt-3 text-muted-foreground">{topic.data.description}</p>
      </header>
      <ol className="grid gap-4">
        {topic.data.items.map((entry, index) => (
          <li key={entry.id} className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <span className="grid size-8 place-items-center rounded-full bg-muted text-sm">{index + 1}</span>
            <ContentCard entry={entry} />
          </li>
        ))}
      </ol>
    </div>
  )
}
