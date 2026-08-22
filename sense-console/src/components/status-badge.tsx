import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const styles: Record<string, string> = {
  "执行中": "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "待审核": "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  "已完成": "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  "待处理": "bg-slate-500/12 text-slate-700 dark:text-slate-300",
  "异常": "bg-red-500/12 text-red-700 dark:text-red-300",
  "草稿": "bg-violet-500/10 text-violet-700 dark:text-violet-300",
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant="ghost" className={cn("border-0", styles[status] || "bg-muted text-muted-foreground")}>{status}</Badge>
}
