import { FileQuestionIcon, RotateCcwIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

export function LoadingBlock({ label = "正在加载内容" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="grid gap-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    </div>
  )
}

export function ErrorBlock({
  title = "内容暂时没有加载出来",
  description = "请求失败时不会用样例冒充已发布内容。可以再试一次。",
  onRetry,
}: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      {onRetry ? (
        <div className="pt-3">
          <Button type="button" variant="outline" onClick={onRetry}>
            <RotateCcwIcon />
            重试
          </Button>
        </div>
      ) : null}
    </Alert>
  )
}

export function EmptyBlock({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <Empty className="border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestionIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

export function NotFoundState({
  title = "找不到这个页面",
  description = "链接可能写错了，或者内容还没有发布。",
}: {
  title?: string
  description?: string
}) {
  return (
    <Empty className="border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestionIcon />
        </EmptyMedia>
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button nativeButton={false} render={<Link to="/" />}>
          返回首页
        </Button>
      </EmptyContent>
    </Empty>
  )
}
