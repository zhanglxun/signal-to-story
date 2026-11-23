import { ArrowRightIcon } from "lucide-react"
import { useMemo } from "react"
import { Link } from "react-router"

import { EntryGrid } from "@/components/site/entry-card"
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/site/states"
import { Button } from "@/components/ui/button"
import { brandConfig } from "@/config/brand"
import { useEntries, useSiteInfo } from "@/features/site-queries"
import { usePageTitle } from "@/hooks/use-page-title"

export function HomePage() {
  usePageTitle()
  const site = useSiteInfo()
  const latest = useEntries({ limit: 6 })
  const entries = useMemo(() => latest.data?.pages.flatMap((page) => page.items) ?? [], [latest.data])

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
        </div>
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
          <EntryGrid entries={entries} />
        )}
      </section>

    </div>
  )
}
