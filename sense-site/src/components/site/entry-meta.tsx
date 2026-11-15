import { LockIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { entryColumns, entryFormats, type SiteEntry } from "@/contracts/site"

export function AccessBadge({ level }: { level: SiteEntry["access_level"] }) {
  if (level === "public") return null
  return (
    <Badge variant="outline" className="gap-1">
      <LockIcon aria-hidden />
      注册可读
    </Badge>
  )
}

export function EntryBadges({ entry, categoryName }: { entry: SiteEntry; categoryName?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary">{entryFormats[entry.format]}</Badge>
      {categoryName && <Badge variant="outline">{categoryName}</Badge>}
      {entry.column_key && <Badge variant="ghost" className="px-1 text-muted-foreground">{entryColumns[entry.column_key]}</Badge>}
      <AccessBadge level={entry.access_level} />
    </div>
  )
}
