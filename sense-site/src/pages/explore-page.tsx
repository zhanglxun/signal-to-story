import { SearchIcon } from "lucide-react"
import { useMemo, useState, type FormEvent } from "react"
import { useSearchParams } from "react-router"

import { EntryGrid } from "@/components/site/entry-card"
import { CardGridSkeleton, EmptyState, ErrorState, NoResultsState } from "@/components/site/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { entryFormats, normalizeKeyword, type EntryFormat } from "@/contracts/site"
import { useEntries } from "@/features/site-queries"
import { usePageTitle } from "@/hooks/use-page-title"
import { cn } from "@/lib/utils"

const isFormat = (v: string | null): v is EntryFormat => Boolean(v && v in entryFormats)

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        active ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

export function ExplorePage() {
  usePageTitle("探索")
  const [params, setParams] = useSearchParams()
  const format = isFormat(params.get("format")) ? (params.get("format") as EntryFormat) : undefined
  const keyword = normalizeKeyword(params.get("q") ?? "")
  const [draft, setDraft] = useState(keyword)
  const entries = useEntries({ format, keyword: keyword || undefined })
  const items = useMemo(() => entries.data?.pages.flatMap((p) => p.items) ?? [], [entries.data])
  const filtered = Boolean(format || keyword)

  // Filters live in the URL so the view is shareable and survives refresh.
  const update = (key: string, value?: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    update("q", normalizeKeyword(draft) || undefined)
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">探索</h1>
        <p className="text-sm text-muted-foreground">按内容形式筛选，或搜索标题与摘要。</p>
      </header>
      <form role="search" onSubmit={submit} className="flex max-w-xl gap-2">
        <label htmlFor="explore-search" className="sr-only">搜索标题或摘要</label>
        <Input id="explore-search" value={draft} maxLength={50} onChange={(e) => setDraft(e.target.value)} placeholder="搜索标题或摘要" />
        <Button type="submit"><SearchIcon />搜索</Button>
      </form>
      <div className="space-y-3">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">内容形式</legend>
          <Chip active={!format} onClick={() => update("format")}>全部形式</Chip>
          {(["article", "tutorial", "video", "resource"] as EntryFormat[]).map((f) => (
            <Chip key={f} active={format === f} onClick={() => update("format", f)}>{entryFormats[f]}</Chip>
          ))}
        </fieldset>
      </div>
      {entries.isPending ? (
        <CardGridSkeleton />
      ) : entries.isError ? (
        <ErrorState message={entries.error.message} onRetry={() => void entries.refetch()} />
      ) : items.length === 0 ? (
        filtered ? <NoResultsState>换个关键词或清除筛选条件试试。</NoResultsState> : <EmptyState>站点还没有上线的内容。</EmptyState>
      ) : (
        <>
          <EntryGrid entries={items} />
          {entries.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" disabled={entries.isFetchingNextPage} onClick={() => void entries.fetchNextPage()}>
                {entries.isFetchingNextPage ? "加载中…" : "加载更多"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
