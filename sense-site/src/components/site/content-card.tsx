import { LockIcon } from "lucide-react"
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
          {entry.accessLevel !== "public" ? <Badge>{accessLabel[entry.accessLevel]}</Badge> : null}
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

export function LockedContentCard({
  entry,
  reason,
}: {
  entry: EntryCard
  reason: "registered" | "member"
}) {
  return (
    <Card className="h-full border-dashed opacity-95">
      <CardHeader>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{entry.categoryName}</Badge>
          <Badge>
            <LockIcon className="size-3" />
            {reason === "member" ? "会员预告" : "注册可读"}
          </Badge>
        </div>
        <CardTitle className="text-lg">{entry.title}</CardTitle>
        <CardDescription>{entry.summary}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {reason === "member" ? (
          <span>会员专享正文尚未开放支付与授权。</span>
        ) : (
          <Link to="/login" className="underline underline-offset-4">
            登录并验证邮箱后阅读全文
          </Link>
        )}
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
