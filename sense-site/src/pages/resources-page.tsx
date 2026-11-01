import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/site/page-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { accessLabel, anonymousReader } from "@/contracts/site"
import { useAuth } from "@/features/auth/auth-context"
import { usePageTitle } from "@/lib/use-page-title"
import { useCatalog } from "@/services/catalog"

export function ResourcesPage() {
  usePageTitle("资源库")
  const catalog = useCatalog()
  const { session } = useAuth()
  const reader = session
    ? { userId: session.userId, emailVerified: session.emailVerified }
    : anonymousReader
  const resources = useQuery({
    queryKey: ["resources"],
    queryFn: () => catalog.listResources(),
  })
  const access = useQuery({
    queryKey: ["resource-access", reader.userId, reader.emailVerified],
    enabled: Boolean(resources.data),
    queryFn: async () => {
      const entries = await Promise.all(
        (resources.data ?? []).map(async (resource) => [resource.id, await catalog.getResourceAccess(resource.id, reader)] as const)
      )
      return Object.fromEntries(entries)
    },
  })

  return (
    <div className="grid gap-6">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-medium tracking-tight">资源库</h1>
        <p className="mt-3 text-muted-foreground">这里只展示资源说明和权限。文件留在对象存储里，授权后才签发短时地址。</p>
      </header>
      {resources.isPending || access.isLoading ? <LoadingBlock /> : null}
      {resources.isError || access.isError ? (
        <ErrorBlock
          onRetry={() => {
            void resources.refetch()
            void access.refetch()
          }}
        />
      ) : null}
      {resources.data && resources.data.length === 0 ? (
        <EmptyBlock title="还没有资源" description="发布并授权的下载会列在这里。" />
      ) : null}
      {resources.data && access.data ? (
        <div className="grid gap-4">
          {resources.data.map((resource) => {
            const state = access.data?.[resource.id]
            return (
              <Card key={resource.id}>
                <CardHeader>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{accessLabel[resource.accessLevel]}</Badge>
                    {resource.status === "revoked" ? <Badge variant="destructive">已失效</Badge> : null}
                  </div>
                  <CardTitle>{resource.title}</CardTitle>
                  <CardDescription>{resource.description}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm text-muted-foreground">
                  {state?.status === "revoked" ? <p>这份资源已失效，不能下载。</p> : null}
                  {state?.status === "forbidden" ? (
                    <p>
                      登录并完成验证后才能申请下载。
                      <Link className="ml-2 underline underline-offset-4" to="/login?next=%2Fresources">
                        去登录
                      </Link>
                    </p>
                  ) : null}
                  {state?.status === "not_issued" ? <p>对象存储还没接入，当前不能签发下载地址。</p> : null}
                  {state?.status === "not_found" ? <p>找不到这份资源。</p> : null}
                  <Button type="button" variant="outline" disabled>
                    下载
                  </Button>
                  {resource.entrySlug ? (
                    <Link className="underline underline-offset-4" to={`/content/${resource.entrySlug}`}>
                      查看相关内容
                    </Link>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
