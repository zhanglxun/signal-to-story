import { AlertCircleIcon, InboxIcon, SearchXIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export function LoadingState({ label = "正在加载" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 py-6">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  )
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <span className="sr-only">正在加载内容</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border p-4">
          <Skeleton className="aspect-[16/9] w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  )
}

function StateFrame({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</span>
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
      {action}
    </div>
  )
}

export function EmptyState({ title = "暂无内容", children }: { title?: string; children?: ReactNode }) {
  return <StateFrame icon={<InboxIcon className="size-5" />} title={title}>{children}</StateFrame>
}

export function NoResultsState({ children }: { children?: ReactNode }) {
  return <StateFrame icon={<SearchXIcon className="size-5" />} title="没有找到匹配的内容">{children}</StateFrame>
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert">
      <StateFrame
        icon={<AlertCircleIcon className="size-5" />}
        title="内容暂时无法加载"
        action={onRetry && <Button variant="outline" onClick={onRetry}>重试</Button>}
      >
        {message ?? "请检查网络后重试。"}
      </StateFrame>
    </div>
  )
}

export function RouteError() {
  return (
    <div className="mx-auto max-w-xl p-8">
      <ErrorState message="页面出现异常，请刷新重试。" onRetry={() => window.location.reload()} />
    </div>
  )
}
