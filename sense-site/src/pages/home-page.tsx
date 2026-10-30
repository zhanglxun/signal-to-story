import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { ContentGrid, LockedContentCard } from "@/components/site/content-card"
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/site/page-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { canReadRegistered, type EntryCard } from "@/contracts/site"
import { useAuth } from "@/features/auth/auth-context"
import { usePageTitle } from "@/lib/use-page-title"
import { useCatalog } from "@/services/catalog"

function groupByCategory(entries: EntryCard[]) {
  const map = new Map<string, { name: string; items: EntryCard[] }>()
  for (const entry of entries) {
    const bucket = map.get(entry.categorySlug) ?? { name: entry.categoryName, items: [] }
    if (bucket.items.length < 3) bucket.items.push(entry)
    map.set(entry.categorySlug, bucket)
  }
  return [...map.entries()].map(([slug, value]) => ({ slug, ...value }))
}

export function HomePage() {
  usePageTitle("首页")
  const catalog = useCatalog()
  const { session } = useAuth()
  const reader = {
    userId: session?.userId ?? null,
    emailVerified: session?.emailVerified ?? false,
  }
  const verified = canReadRegistered(reader)
  const connected = catalog.source !== "disconnected"

  const entries = useQuery({
    queryKey: ["home-entries", catalog.source],
    queryFn: () => catalog.listEntries({ limit: 48 }),
    enabled: connected,
  })
  const topics = useQuery({
    queryKey: ["topics", catalog.source],
    queryFn: () => catalog.listTopics(),
    enabled: connected,
  })

  if (!connected) {
    return (
      <EmptyBlock
        title="未连接数据库"
        description="请配置 VITE_SUPABASE_URL 与 anon / publishable key 后重启开发服务。不会用占位数据冒充已发布内容。"
      />
    )
  }

  if (entries.isPending || topics.isPending) return <LoadingBlock />
  if (entries.isError || topics.isError) {
    return (
      <ErrorBlock
        onRetry={() => {
          void entries.refetch()
          void topics.refetch()
        }}
      />
    )
  }

  const all = entries.data?.items ?? []
  const featuredAll = all.filter((entry) => entry.featured)
  const featured = verified
    ? featuredAll.filter((entry) => entry.accessLevel !== "member")
    : featuredAll.filter((entry) => entry.accessLevel === "public")

  const latestPool = verified
    ? all.filter((entry) => entry.accessLevel !== "member")
    : all.filter((entry) => entry.accessLevel === "public")
  const featuredIds = new Set(featured.map((entry) => entry.id))
  const latest = latestPool.filter((entry) => !featuredIds.has(entry.id)).slice(0, 6)

  const channelEntries = verified
    ? all.filter((entry) => entry.accessLevel !== "member")
    : all.filter((entry) => entry.accessLevel === "public")
  const channels = groupByCategory(channelEntries)

  const memberEntries = all.filter((entry) => entry.accessLevel === "member").slice(0, 3)
  const lockedRegistered = !verified
    ? all.filter((entry) => entry.accessLevel === "registered").slice(0, 3)
    : []

  return (
    <div className="grid gap-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm text-muted-foreground">科技行业信息聚合与分享</p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">
            把值得读的信号，整理成可核对的故事
          </h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            公开内容随时可读；注册后解锁进阶栏目。会员专享仅作预告，本期不开放支付。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {session ? (
            <Button nativeButton={false} render={<Link to="/me" />}>
              我的
            </Button>
          ) : (
            <>
              <Button nativeButton={false} render={<Link to="/login" />}>
                登录
              </Button>
              <Button variant="outline" nativeButton={false} render={<Link to="/register" />}>
                注册
              </Button>
            </>
          )}
        </div>
      </header>

      {featured.length > 0 ? (
        <section className="grid gap-4">
          <h2 className="text-xl font-medium">今日精选</h2>
          <ContentGrid entries={featured} />
        </section>
      ) : null}

      <section className="grid gap-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-medium">最新发布</h2>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/explore" />}>
            去探索
          </Button>
        </div>
        {latest.length === 0 ? (
          <EmptyBlock title="还没有已发布内容" description="运营在控制台发布并上线后，会出现在这里。" />
        ) : (
          <ContentGrid entries={latest} />
        )}
      </section>

      {channels.length > 0 ? (
        <section className="grid gap-4">
          <h2 className="text-xl font-medium">频道速览</h2>
          <div className="grid gap-6">
            {channels.map((channel) => (
              <div key={channel.slug} className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-medium">{channel.name}</h3>
                  <Badge variant="outline" render={<Link to={`/explore?category=${channel.slug}`} />}>
                    查看分类
                  </Badge>
                </div>
                <ContentGrid entries={channel.items} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!verified && lockedRegistered.length > 0 ? (
        <section className="grid gap-4">
          <h2 className="text-xl font-medium">注册专享</h2>
          <p className="text-sm text-muted-foreground">登录并完成邮箱验证后可读全文。这里只展示摘要。</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {lockedRegistered.map((entry) => (
              <LockedContentCard key={entry.id} entry={entry} reason="registered" />
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-medium">专题</h2>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/topics" />}>
            全部专题
          </Button>
        </div>
        {(topics.data ?? []).length === 0 ? (
          <EmptyBlock title="还没有专题" description="专题用来把几篇内容按学习顺序串起来。" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(topics.data ?? []).map((topic) => (
              <Card key={topic.slug}>
                <CardHeader>
                  <CardTitle>
                    <Link
                      to={`/topics/${topic.slug}`}
                      className="rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {topic.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>{topic.description}</CardDescription>
                  <p className="text-sm text-muted-foreground">{topic.itemCount} 篇</p>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </section>

      {memberEntries.length > 0 ? (
        <section className="grid gap-4">
          <h2 className="text-xl font-medium">会员栏目预告</h2>
          <p className="text-sm text-muted-foreground">
            会员正文本期未开放。卡片仅作预告，不会返回全文。
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {memberEntries.map((entry) => (
              <LockedContentCard key={entry.id} entry={entry} reason="member" />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
