import { Badge } from "@/components/ui/badge"
import { entryFormats, type SiteEntry } from "@/contracts/site"

export function EntryBadges({ entry }: { entry: SiteEntry }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary">{entryFormats[entry.format]}</Badge>
    </div>
  )
}
