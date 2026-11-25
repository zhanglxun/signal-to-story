import { PlayCircleIcon } from "lucide-react"
import { Link } from "react-router"

import { EntryBadges } from "@/components/site/entry-meta"
import type { SiteEntry } from "@/contracts/site"
import { formatDate } from "@/lib/format"
import { isSafeMediaUrl } from "@/lib/markdown"

export function EntryCover({ entry, className = "" }: { entry: SiteEntry; className?: string }) {
  if (entry.cover_url && isSafeMediaUrl(entry.cover_url))
    return <img src={entry.cover_url} alt={entry.cover_alt} loading="lazy" referrerPolicy="no-referrer" className={`aspect-[16/9] w-full object-cover ${className}`} />
  return (
    <div aria-hidden className={`relative grid aspect-[16/9] w-full place-items-center overflow-hidden bg-gradient-to-br from-muted to-secondary ${className}`}>
      <span className="px-6 text-center text-sm font-medium text-muted-foreground/80 line-clamp-2">{entry.title}</span>
      {entry.format === "video" && <PlayCircleIcon className="absolute right-3 bottom-3 size-6 text-foreground/60" />}
    </div>
  )
}

export function EntryCard({ entry }: { entry: SiteEntry }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-foreground/25">
      <EntryCover entry={entry} />
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <EntryBadges entry={entry} />
        <h3 className="text-base leading-snug font-semibold">
          <Link to={`/content/${entry.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {entry.title}
          </Link>
        </h3>
        <p className="line-clamp-3 text-sm text-muted-foreground">{entry.summary}</p>
        <time dateTime={entry.published_at} className="mt-auto pt-1 text-xs text-muted-foreground">
          {formatDate(entry.published_at)}
        </time>
      </div>
    </article>
  )
}

export function EntryGrid({ entries }: { entries: SiteEntry[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  )
}
