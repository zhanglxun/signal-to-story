import {
  CheckCircle2Icon,
  CircleIcon,
  ListChecksIcon,
  XCircleIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { PlanStepItem } from "@/modules/chat/types"

export interface PlanCardProps {
  steps: readonly PlanStepItem[]
  className?: string
}

const STEP_STATUS_META: Record<
  PlanStepItem["status"],
  {
    label: string
    badgeVariant: "outline" | "secondary" | "default" | "destructive"
    rowClass: string
  }
> = {
  pending: {
    label: "待执行",
    badgeVariant: "outline",
    rowClass: "border-border bg-background text-muted-foreground",
  },
  in_progress: {
    label: "进行中",
    badgeVariant: "secondary",
    rowClass: "border-primary/30 bg-primary/5 text-foreground font-medium",
  },
  completed: {
    label: "已完成",
    badgeVariant: "default",
    rowClass: "border-border bg-muted/40 text-foreground/85",
  },
  failed: {
    label: "失败",
    badgeVariant: "destructive",
    rowClass: "border-destructive/30 bg-destructive/10 text-destructive",
  },
}

function StepStatusIcon({ status }: { status: PlanStepItem["status"] }) {
  if (status === "in_progress") {
    return <Spinner className="size-3.5 shrink-0 text-primary" />
  }
  if (status === "completed") {
    return <CheckCircle2Icon className="size-3.5 shrink-0 text-primary" />
  }
  if (status === "failed") {
    return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />
  }
  return <CircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
}

export function PlanCard({ steps, className }: PlanCardProps) {
  if (steps.length === 0) return null

  const completedCount = steps.filter((s) => s.status === "completed").length

  return (
    <Card size="sm" className={cn("bg-card", className)}>
      <CardHeader className="items-center border-b">
        <CardTitle className="flex items-center gap-2 text-xs font-medium">
          <ListChecksIcon className="size-3.5 text-primary" />
          <span>执行计划</span>
        </CardTitle>
        <CardAction>
          <Badge variant="outline" className="h-5 px-2 text-[11px] tabular-nums">
            已完成 {completedCount} / {steps.length}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent>
        <ol className="space-y-1.5" aria-label="计划步骤">
          {steps.map((step) => {
            const meta = STEP_STATUS_META[step.status] ?? STEP_STATUS_META.pending
            return (
              <li
                key={step.id}
                data-step-status={step.status}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                  meta.rowClass
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <StepStatusIcon status={step.status} />
                  <span className="truncate">{step.title}</span>
                </span>
                <Badge variant={meta.badgeVariant} className="h-4 shrink-0 px-1.5 text-[10px]">
                  {meta.label}
                </Badge>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
