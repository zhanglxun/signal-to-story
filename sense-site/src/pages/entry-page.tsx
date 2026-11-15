import { ArrowLeftIcon, BookmarkCheckIcon, BookmarkIcon, ExternalLinkIcon } from "lucide-react"
import { useMemo } from "react"
import { Link, useLocation, useParams } from "react-router"

import { EntryCard, EntryCover } from "@/components/site/entry-card"
import { EntryBadges } from "@/components/site/entry-meta"
import { MarkdownView, TableOfContents } from "@/components/site/markdown-view"
import { ErrorState, LoadingState, LockedState } from "@/components/site/states"
import { VideoPlayer } from "@/components/site/video-player"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { ReaderSession, SiteEntry } from "@/contracts/site"
import { useReaderAuth } from "@/features/auth/reader-auth"
import { useCategories, useEntries, useEntry, useEntryBody, useIsBookmarked, useToggleBookmark } from "@/features/site-queries"
import { usePageTitle } from "@/hooks/use-page-title"
import { formatDate } from "@/lib/format"
import { renderMarkdown } from "@/lib/markdown"
import { NotFoundPage } from "@/pages/not-found-page"

function BookmarkButton({ entry, session }: { entry: SiteEntry; session: ReaderSession | null }) {
  const location = useLocation()
  const bookmarked = useIsBookmarked(session, entry.id)
  const toggle = useToggleBookmark(session)
  if (!session)
    return (
      <Button variant="outline" size="sm" nativeButton={false} render={<Link to={`/login?redirect=${encodeURIComponent(location.pathname)}`} />}>
        <BookmarkIcon />
        登录后收藏
      </Button>
    )
  const active = Boolean(bookmarked.data)
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant={active ? "secondary" : "outline"}
        size="sm"
        aria-pressed={active}
        disabled={bookmarked.isPending || toggle.isPending || !session.verified}
        onClick={() => toggle.mutate({ entryId: entry.id, bookmarked: active })}
      >
        {active ? <BookmarkCheckIcon /> : <BookmarkIcon />}
        {active ? "已收藏" : "收藏"}
      </Button>
      {!session.verified && <span className="text-xs text-muted-foreground">完成邮箱验证后可收藏</span>}
      {toggle.isError && <span role="alert" className="text-xs text-destructive">{toggle.error.message}</span>}
    </div>
  )
}

function RelatedEntries({ entry, categorySlug, names }: { entry: SiteEntry; categorySlug?: string; names: Map<string, string> }) {
  const related = useEntries({ category: categorySlug, limit: 4 })
  const items = (related.data?.pages[0]?.items ?? []).filter((e) => e.id !== entry.id).slice(0, 3)
  if (!categorySlug || items.length === 0) return null
  return (
    <section aria-labelledby="related-heading" className="space-y-4">
      <h2 id="related-heading" className="text-lg font-semibold">相关内容</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {items.map((e) => (
          <EntryCard key={e.id} entry={e} categoryName={e.category_id ? names.get(e.category_id) : undefined} />
        ))}
      </div>
    </section>
  )
}

export function EntryPage() {
  const { slug = "" } = useParams()
  const location = useLocation()
  const { session, ready } = useReaderAuth()
  const entry = useEntry(slug)
  const categories = useCategories()
  const body = useEntryBody(entry.data, session, ready)
  const names = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data])
  const category = categories.data?.find((c) => c.id === entry.data?.category_id)
  const rendered = useMemo(
    () => (body.data?.state === "readable" ? renderMarkdown(body.data.body.markdown) : null),
    [body.data]
  )
  usePageTitle(entry.data?.title)

  if (entry.isPending) return <LoadingState label="正在加载内容" />
  if (entry.isError) return <ErrorState message={entry.error.message} onRetry={() => void entry.refetch()} />
  if (!entry.data) return <NotFoundPage message="内容不存在或已下线。" />

  const item = entry.data
  const redirect = encodeURIComponent(location.pathname)
  const video = body.data?.state === "readable" ? body.data.body.media.find((m) => m.kind === "video") : undefined
  const updated = item.updated_at.slice(0, 10) !== item.published_at.slice(0, 10)

  return (
    <article className="mx-auto max-w-5xl space-y-10">
      <div className="space-y-5">
        <Link to="/explore" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" />
          返回探索
        </Link>
        <EntryBadges entry={item} categoryName={category?.name} />
        <h1 className="max-w-3xl text-3xl leading-tight font-semibold tracking-tight text-balance">{item.title}</h1>
        <p className="max-w-3xl text-base text-muted-foreground">{item.summary}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            发布于 <time dateTime={item.published_at}>{formatDate(item.published_at)}</time>
            {updated && (
              <>
                {" · "}更新于 <time dateTime={item.updated_at}>{formatDate(item.updated_at)}</time>
              </>
            )}
          </p>
          <BookmarkButton entry={item} session={session} />
        </div>
      </div>

      {item.cover_url && item.format !== "video" && <EntryCover entry={item} className="rounded-xl border" />}

      {!ready || body.isPending ? (
        <LoadingState label="正在加载正文" />
      ) : body.isError ? (
        <ErrorState message={body.error.message} onRetry={() => void body.refetch()} />
      ) : body.data.state === "locked" ? (
        <LockedState
          title={body.data.reason === "login_required" ? "注册读者可阅读全文" : "完成邮箱验证后可阅读全文"}
          action={
            body.data.reason === "login_required" ? (
              <div className="flex gap-2">
                <Button nativeButton={false} render={<Link to={`/login?redirect=${redirect}`} />}>登录</Button>
                <Button variant="outline" nativeButton={false} render={<Link to={`/register?redirect=${redirect}`} />}>免费注册</Button>
              </div>
            ) : undefined
          }
        >
          {body.data.reason === "login_required"
            ? "以上为人工摘要。登录或免费注册后即可阅读全文，并会回到本页。"
            : "请打开注册邮件中的确认链接，完成后重新登录即可阅读。"}
        </LockedState>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="min-w-0 space-y-8">
            {video && <VideoPlayer media={video} />}
            {rendered && <MarkdownView html={rendered.html} />}
            {body.data.body.source_refs.length > 0 && (
              <section aria-labelledby="refs-heading" className="space-y-2 rounded-xl border bg-muted/30 p-4">
                <h2 id="refs-heading" className="text-sm font-semibold">来源引用</h2>
                <ul className="space-y-1 text-sm">
                  {body.data.body.source_refs.map((ref) => (
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

      {body.data?.state === "readable" && item.access_level === "registered" && (
        <Alert>
          <AlertDescription>本文为注册读者内容，请勿公开转载全文。</AlertDescription>
        </Alert>
      )}

      <Separator />
      <RelatedEntries entry={item} categorySlug={category?.slug} names={names} />
    </article>
  )
}
