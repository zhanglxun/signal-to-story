import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "react-router"

import { ContentGrid } from "@/components/site/content-card"
import { MarkdownView, Toc } from "@/components/site/markdown-view"
import { EmptyBlock, ErrorBlock, LoadingBlock, NotFoundState } from "@/components/site/page-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { accessLabel, columnLabel, formLabel } from "@/contracts/site"
import { useAuth } from "@/features/auth/auth-context"
import { formatDate } from "@/lib/format"
import { usePageTitle } from "@/lib/use-page-title"
import { readerBookmarks } from "@/services/bookmarks"
import { useCatalog } from "@/services/catalog"

export function ContentPage() {
  const { slug = "" } = useParams()
  const catalog = useCatalog()
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const reader = {
    userId: session?.userId ?? null,
    emailVerified: session?.emailVerified ?? false,
  }
  const entry = useQuery({
    queryKey: ["entry", slug],
    queryFn: () => catalog.getEntry(slug),
  })
  const body = useQuery({
    queryKey: ["entry-body", slug, reader.userId, reader.emailVerified],
    enabled: Boolean(entry.data),
    queryFn: () => catalog.getEntryBody(slug, reader),
  })
  const related = useQuery({
    queryKey: ["related", entry.data?.categorySlug, slug],
    enabled: Boolean(entry.data),
    queryFn: () => catalog.listEntries({ category: entry.data?.categorySlug, limit: 4 }),
  })
  const bookmarked = useQuery({
    queryKey: ["bookmark-flag", reader.userId, slug],
    enabled: Boolean(reader.userId),
    queryFn: () => readerBookmarks.list(reader.userId ?? "").some((record) => record.slug === slug),
  })
  const toggleBookmark = useMutation({
    mutationFn: async () => {
      if (!reader.userId) return
      const exists = readerBookmarks.list(reader.userId).some((record) => record.slug === slug)
      if (exists) readerBookmarks.remove(reader.userId, slug)
      else readerBookmarks.add(reader.userId, slug)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bookmark-flag", reader.userId, slug] })
      await queryClient.invalidateQueries({ queryKey: ["bookmarks", reader.userId] })
    },
  })

  usePageTitle(entry.data?.title ?? "内容")

  if (entry.isPending) return <LoadingBlock />
  if (entry.isError) return <ErrorBlock onRetry={() => void entry.refetch()} />
  if (!entry.data) {
    return <NotFoundState title="这篇内容不存在" description="它可能还没发布，或者已经下线。" />
  }

  const next = `/content/${slug}`
  const relatedItems = (related.data?.items ?? []).filter((item) => item.slug !== slug).slice(0, 3)

  return (
    <article className="grid gap-8">
      <header className="max-w-3xl">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{entry.data.categoryName}</Badge>
          <Badge variant="secondary">{formLabel[entry.data.form]}</Badge>
          <Badge variant="secondary">{columnLabel[entry.data.column]}</Badge>
          <Badge variant={entry.data.accessLevel === "registered" ? "default" : "outline"}>
            {accessLabel[entry.data.accessLevel]}
          </Badge>
        </div>
        <h1 className="mt-4 text-3xl font-medium tracking-tight">{entry.data.title}</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">{entry.data.summary}</p>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            发布于 <time dateTime={entry.data.publishedAt}>{formatDate(entry.data.publishedAt)}</time>
          </span>
          <span>
            更新于 <time dateTime={entry.data.updatedAt}>{formatDate(entry.data.updatedAt)}</time>
          </span>
        </p>
        <div className="mt-4">
          {session ? (
            <Button type="button" variant="outline" disabled={toggleBookmark.isPending} onClick={() => toggleBookmark.mutate()}>
              {bookmarked.data ? "取消收藏" : "收藏"}
            </Button>
          ) : (
            <Button variant="outline" nativeButton={false} render={<Link to={`/login?next=${encodeURIComponent(next)}`} />}>
              登录后收藏
            </Button>
          )}
        </div>
      </header>

      {body.isPending ? <LoadingBlock label="正在加载正文" /> : null}
      {body.isError ? <ErrorBlock onRetry={() => void body.refetch()} /> : null}
      {body.data?.status === "not_found" ? (
        <EmptyBlock title="正文不可用" description="这篇内容没有可阅读的发布快照。" />
      ) : null}
      {body.data?.status === "locked" ? (
        <section className="max-w-3xl rounded-xl border bg-card p-5">
          <h2 className="text-lg font-medium">注册后阅读全文</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            未登录只能看人工摘要。登录并完成验证后，正文从数据接口返回，不会提前放进页面。
          </p>
          <p className="mt-4 text-base leading-7">{body.data.summary}</p>
          <Button className="mt-4" nativeButton={false} render={<Link to={`/login?next=${encodeURIComponent(next)}`} />}>
            登录后继续
          </Button>
        </section>
      ) : null}
      {body.data?.status === "visible" ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,42rem)_14rem] lg:items-start">
          <div className="grid min-w-0 gap-8">
            <details className="rounded-lg border bg-card p-3 lg:hidden">
              <summary className="cursor-pointer text-sm font-medium">目录</summary>
              <div className="pt-3">
                <Toc source={body.data.markdown} />
              </div>
            </details>
            <MarkdownView source={body.data.markdown} />
            {body.data.sources.length > 0 ? (
              <section>
                <h2 className="text-lg font-medium">来源</h2>
                <ul className="mt-3 grid gap-2 text-sm">
                  {body.data.sources.map((source) => (
                    <li key={source.url}>
                      <a className="underline underline-offset-4" href={source.url} target="_blank" rel="noreferrer noopener">
                        {source.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          <div className="sticky top-24 hidden lg:block">
            <Toc source={body.data.markdown} />
          </div>
        </div>
      ) : null}

      {relatedItems.length > 0 ? (
        <section className="grid gap-4">
          <h2 className="text-xl font-medium">相关内容</h2>
          <ContentGrid entries={relatedItems} />
        </section>
      ) : null}
    </article>
  )
}
