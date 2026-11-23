import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react"
import { useMemo } from "react"
import { Link, useParams } from "react-router"

import { EntryCard, EntryCover } from "@/components/site/entry-card"
import { EntryBadges } from "@/components/site/entry-meta"
import { MarkdownView, TableOfContents } from "@/components/site/markdown-view"
import { ErrorState, LoadingState } from "@/components/site/states"
import { VideoPlayer } from "@/components/site/video-player"
import { Separator } from "@/components/ui/separator"
import type { SiteEntry } from "@/contracts/site"
import { useEntries, useEntry, useEntryBody } from "@/features/site-queries"
import { usePageTitle } from "@/hooks/use-page-title"
import { formatDate } from "@/lib/format"
import { renderMarkdown } from "@/lib/markdown"
import { NotFoundPage } from "@/pages/not-found-page"

function RelatedEntries({ entry }: { entry: SiteEntry }) {
  const related = useEntries({ format: entry.format, limit: 4 })
  const items = (related.data?.pages[0]?.items ?? []).filter((e) => e.id !== entry.id).slice(0, 3)
  if (items.length === 0) return null
  return (
    <section aria-labelledby="related-heading" className="space-y-4">
      <h2 id="related-heading" className="text-lg font-semibold">相关内容</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {items.map((e) => (
          <EntryCard key={e.id} entry={e} />
        ))}
      </div>
    </section>
  )
}

export function EntryPage() {
  const { slug = "" } = useParams()
  const entry = useEntry(slug)
  const body = useEntryBody(entry.data)
  const rendered = useMemo(() => (body.data ? renderMarkdown(body.data.markdown) : null), [body.data])
  usePageTitle(entry.data?.title)

  if (entry.isPending) return <LoadingState label="正在加载内容" />
  if (entry.isError) return <ErrorState message={entry.error.message} onRetry={() => void entry.refetch()} />
  if (!entry.data) return <NotFoundPage message="内容不存在或已下线。" />

  const item = entry.data
  const video = body.data?.media.find((m) => m.kind === "video")

  return (
    <article className="mx-auto max-w-5xl space-y-10">
      <div className="space-y-5">
        <Link to="/explore" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" />
          返回探索
        </Link>
        <EntryBadges entry={item} />
        <h1 className="max-w-3xl text-3xl leading-tight font-semibold tracking-tight text-balance">{item.title}</h1>
        <p className="max-w-3xl text-base text-muted-foreground">{item.summary}</p>
        <p className="text-sm text-muted-foreground">
          发布于 <time dateTime={item.published_at}>{formatDate(item.published_at)}</time>
        </p>
      </div>

      {item.cover_url && item.format !== "video" && <EntryCover entry={item} className="rounded-xl border" />}

      {body.isPending ? (
        <LoadingState label="正在加载正文" />
      ) : body.isError ? (
        <ErrorState message={body.error.message} onRetry={() => void body.refetch()} />
      ) : (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="min-w-0 space-y-8">
            {video && <VideoPlayer media={video} />}
            {rendered && <MarkdownView html={rendered.html} />}
            {body.data.source_refs.length > 0 && (
              <section aria-labelledby="refs-heading" className="space-y-2 rounded-xl border bg-muted/30 p-4">
                <h2 id="refs-heading" className="text-sm font-semibold">来源引用</h2>
                <ul className="space-y-1 text-sm">
                  {body.data.source_refs.map((ref) => (
                    <li key={ref.url}>
                      <a href={ref.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="inline-flex items-center gap-1 underline underline-offset-4">
                        {ref.title}
                        <ExternalLinkIcon className="size-3" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          {rendered && rendered.headings.length > 1 && (
            <aside className="hidden lg:block">
              <div className="sticky top-20">
                <TableOfContents headings={rendered.headings} />
              </div>
            </aside>
          )}
        </div>
      )}

      <Separator />
      <RelatedEntries entry={item} />
    </article>
  )
}
