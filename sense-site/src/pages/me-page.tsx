import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router"

import { ContentCard } from "@/components/site/content-card"
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/site/page-state"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-context"
import { usePageTitle } from "@/lib/use-page-title"
import { readerBookmarks } from "@/services/bookmarks"
import { useCatalog } from "@/services/catalog"

export function MePage() {
  usePageTitle("我的")
  const { session, mode, signOut } = useAuth()
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const userId = session?.userId ?? ""
  const bookmarks = useQuery({
    queryKey: ["bookmarks", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const records = readerBookmarks.list(userId)
      const entries = await Promise.all(records.map((record) => catalog.getEntry(record.slug)))
      return entries.flatMap((entry) => (entry ? [entry] : []))
    },
  })

  return (
    <div className="grid max-w-3xl gap-6">
      <header>
        <h1 className="text-3xl font-medium tracking-tight">我的</h1>
        <p className="mt-3 text-muted-foreground">
          {session?.email} · {mode === "preview" ? "本地预览会话，没有后台权限" : "读者账号"}
        </p>
      </header>
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void signOut().then(() => {
              queryClient.clear()
            })
          }}
        >
          退出
        </Button>
      </div>
      <section className="grid gap-4">
        <h2 className="text-xl font-medium">收藏</h2>
        {bookmarks.isPending ? <LoadingBlock label="正在加载收藏" /> : null}
        {bookmarks.isError ? <ErrorBlock onRetry={() => void bookmarks.refetch()} /> : null}
        {bookmarks.data && bookmarks.data.length === 0 ? (
          <EmptyBlock
            title="还没有收藏"
            description="打开一篇内容后可以收进这里。退出后，这里不会留下上一个账号的收藏。"
            action={
              <Button variant="outline" nativeButton={false} render={<Link to="/explore" />}>
                去探索
              </Button>
            }
          />
        ) : null}
        {bookmarks.data && bookmarks.data.length > 0 ? (
          <div className="grid gap-4">
            {bookmarks.data.map((entry) => (
              <ContentCard key={entry.id} entry={entry} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}
