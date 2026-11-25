import { FlaskConicalIcon } from "lucide-react"

import { siteEnv } from "@/lib/env"

export function DemoBanner() {
  if (!siteEnv.isDemo) return null
  return (
    <div role="note" data-testid="demo-banner" className="border-b border-dashed bg-muted/70 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-foreground/20 bg-background px-2 py-0.5 font-medium text-foreground">
          <FlaskConicalIcon className="size-3" aria-hidden />
          演示数据
        </span>
        <span className="truncate">本地演示模式：内容为内置示例快照，不代表真实发布；任意邮箱与 8 位以上密码即可模拟登录。</span>
      </div>
    </div>
  )
}
