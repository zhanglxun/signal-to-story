import { DownloadIcon, FileIcon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"

import { AccessBadge } from "@/components/site/entry-meta"
import { EmptyState, ErrorState, LoadingState } from "@/components/site/states"
import { Button } from "@/components/ui/button"
import type { SiteResource } from "@/contracts/site"
import { useReaderAuth } from "@/features/auth/reader-auth"
import { useResources } from "@/features/site-queries"
import { usePageTitle } from "@/hooks/use-page-title"
import { formatBytes } from "@/lib/format"
import { getSiteService } from "@/services/site-service"

const deniedText = {
  login_required: "该资源仅向注册读者开放，请先登录或注册。",
  verification_required: "请先完成邮箱验证后再下载。",
  unavailable: "资源暂不可用或已下线。",
} as const

function ResourceRow({ resource }: { resource: SiteResource }) {
  const { session } = useReaderAuth()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const download = async () => {
    setPending(true)
    setMessage(null)
    try {
      const result = await (await getSiteService()).requestDownload(resource, session)
      if (result.state === "denied") return setMessage(deniedText[result.reason])
      // Short-lived signed URL; requested on click, never cached or prefetched.
      const link = document.createElement("a")
      link.href = result.url
      link.download = resource.file_name
      link.rel = "noopener"
      document.body.append(link)
      link.click()
      link.remove()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "下载未完成，请重试。")
    } finally {
      setPending(false)
    }
  }
  const locked = resource.access_level === "registered" && !session
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><FileIcon className="size-5" /></span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{resource.title}</h2>
          <AccessBadge level={resource.access_level} />
        </div>
        <p className="text-sm text-muted-foreground">{resource.description}</p>
        <p className="text-xs text-muted-foreground">{resource.file_name}{resource.size_bytes != null && ` · ${formatBytes(resource.size_bytes)}`}</p>
        {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      </div>
      {locked ? (
        <Button variant="outline" nativeButton={false} render={<Link to="/login?redirect=%2Fresources" />}>登录后下载</Button>
      ) : (
        <Button variant="outline" disabled={pending} onClick={() => void download()}>
          <DownloadIcon />
          {pending ? "正在授权…" : "下载"}
        </Button>
      )}
    </li>
  )
}

export function ResourcesPage() {
  usePageTitle("资源库")
  const resources = useResources()
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">资源库</h1>
        <p className="text-sm text-muted-foreground">模板、清单与配套资料。下载链接为短时授权地址，过期后需重新获取。</p>
      </header>
      {resources.isPending ? (
        <LoadingState label="正在加载资源" />
      ) : resources.isError ? (
        <ErrorState message={resources.error.message} onRetry={() => void resources.refetch()} />
      ) : resources.data.length === 0 ? (
        <EmptyState>暂无上线的资源。</EmptyState>
      ) : (
        <ul className="space-y-3">
          {resources.data.map((resource) => <ResourceRow key={resource.id} resource={resource} />)}
        </ul>
      )}
    </div>
  )
}
