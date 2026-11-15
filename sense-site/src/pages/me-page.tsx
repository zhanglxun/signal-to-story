import { LogOutIcon } from "lucide-react"
import { useMemo } from "react"
import { Link, Navigate, useNavigate } from "react-router"

import { EntryGrid } from "@/components/site/entry-card"
import { CardGridSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/site/states"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useReaderAuth } from "@/features/auth/reader-auth"
import { useBookmarks, useCategories } from "@/features/site-queries"
import { usePageTitle } from "@/hooks/use-page-title"

export function MePage() {
  usePageTitle("我的")
  const { session, ready, auth } = useReaderAuth()
  const navigate = useNavigate()
  const bookmarks = useBookmarks(session)
  const categories = useCategories()
  const names = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data])
  if (!ready) return <LoadingState />
  if (!session) return <Navigate to="/login?redirect=%2Fme" replace />
  const signOut = async () => {
    await auth.signOut()
    navigate("/", { replace: true })
  }
  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">{session.displayName}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {session.email}
            <Badge variant={session.verified ? "secondary" : "outline"}>{session.verified ? "邮箱已验证" : "邮箱待验证"}</Badge>
          </p>
        </div>
        <Button variant="outline" onClick={() => void signOut()}>
          <LogOutIcon />
          退出登录
        </Button>
      </header>
      {!session.verified && (
        <Alert><AlertDescription>请打开注册邮件中的确认链接。验证完成前只能阅读公开内容。</AlertDescription></Alert>
      )}
      <section aria-labelledby="bookmarks-heading" className="space-y-4">
        <h2 id="bookmarks-heading" className="text-lg font-semibold">我的收藏</h2>
        {bookmarks.isPending ? (
          <CardGridSkeleton count={3} />
        ) : bookmarks.isError ? (
          <ErrorState message={bookmarks.error.message} onRetry={() => void bookmarks.refetch()} />
        ) : bookmarks.data.length === 0 ? (
          <EmptyState title="还没有收藏">在文章页点击“收藏”，内容会出现在这里。<Link to="/explore" className="ml-1 underline">去探索</Link></EmptyState>
        ) : (
          <EntryGrid entries={bookmarks.data} categories={names} />
        )}
      </section>
    </div>
  )
}
