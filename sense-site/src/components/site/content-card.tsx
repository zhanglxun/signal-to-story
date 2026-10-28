import { Link } from "react-router"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { accessLabel, columnLabel, formLabel, type EntryCard } from "@/contracts/site"
import { formatDate } from "@/lib/format"

export function ContentCard({ entry }: { entry: EntryCard }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{entry.categoryName}</Badge>
          <Badge variant="secondary">{formLabel[entry.form]}</Badge>
          <Badge variant="secondary">{columnLabel[entry.column]}</Badge>
          {entry.accessLevel === "registered" ? <Badge>{accessLabel.registered}</Badge> : null}
        </div>
        <CardTitle className="text-lg">
          <Link
            to={`/content/${entry.slug}`}
            className="rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {entry.title}
          </Link>
        </CardTitle>
        <CardDescription>{entry.summary}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <time dateTime={entry.publishedAt}>发布于 {formatDate(entry.publishedAt)}</time>
      </CardContent>
    </Card>
  )
}

export function ContentGrid({ entries }: { entries: EntryCard[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {entries.map((entry) => (
        <ContentCard key={entry.id} entry={entry} />
      ))}
    </div>
  )
}
