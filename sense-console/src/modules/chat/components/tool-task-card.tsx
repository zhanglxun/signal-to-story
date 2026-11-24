import { useState } from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  WrenchIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { StackTraceBlock } from "@/modules/chat/components/stack-trace-block"

export interface ToolTaskCardProps {
  callId: string
  name: string
  state: "running" | "succeeded" | "failed"
  inputSummary?: string
  outputSummary?: string
  error?: string
  stackTrace?: string
  defaultOpen?: boolean
  className?: string
}

const TOOL_STATE_META: Record<
  ToolTaskCardProps["state"],
  {
    label: string
    badgeVariant: "secondary" | "outline" | "destructive"
    borderClass: string
  }
> = {
  running: {
    label: "运行中",
    badgeVariant: "secondary",
    borderClass: "border-primary/30",
  },
  succeeded: {
    label: "已完成",
    badgeVariant: "outline",
    borderClass: "border-border",
  },
  failed: {
    label: "失败",
    badgeVariant: "destructive",
    borderClass: "border-destructive/40",
  },
}

export function ToolTaskCard({
  callId,
  name,
  state,
  inputSummary,
  outputSummary,
  error,
  stackTrace,
  defaultOpen = false,
  className,
}: ToolTaskCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const meta = TOOL_STATE_META[state] ?? TOOL_STATE_META.running
  const hasInput = Boolean(inputSummary && inputSummary.trim())
  const hasOutput = Boolean(outputSummary && outputSummary.trim())
  const hasDetails = hasInput || hasOutput

  return (
    <div
      data-tool-call-id={callId}
      data-tool-state={state}
      className={cn("rounded-lg border bg-card p-3 text-xs", meta.borderClass, className)}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {state === "running" ? (
              <Spinner className="size-3.5 shrink-0 text-primary" />
            ) : state === "succeeded" ? (
              <CheckCircle2Icon className="size-3.5 shrink-0 text-primary" />
            ) : (
              <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
            )}

            <WrenchIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-xs font-medium text-foreground">
              {name}
            </span>

            <Badge variant={meta.badgeVariant} className="h-4 shrink-0 px-1.5 text-[10px]">
              {meta.label}
            </Badge>
          </div>

          {hasDetails && (
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-6 shrink-0 gap-1 px-2 text-[11px] text-muted-foreground"
                />
              }
            >
              <span>{open ? "收起详情" : "详情"}</span>
              <ChevronDownIcon
                className={cn("size-3 transition-transform", open && "rotate-180")}
              />
            </CollapsibleTrigger>
          )}
        </div>

        {hasDetails && (
          <CollapsibleContent className="mt-2.5 space-y-2 border-t pt-2.5">
            {hasInput && (
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">输入摘要</div>
                <div className="rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-foreground">
                  {inputSummary}
                </div>
              </div>
            )}
            {hasOutput && (
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">输出摘要</div>
                <div className="rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-foreground">
                  {outputSummary}
                </div>
              </div>
            )}
          </CollapsibleContent>
        )}
      </Collapsible>

      {state === "failed" && error && error.trim() && (
        <div
          role="alert"
          className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {stackTrace && stackTrace.trim() && (
        <StackTraceBlock
          stack={stackTrace}
          label="工具错误调用栈 (Stack Trace)"
          className="mt-2"
        />
      )}
    </div>
  )
}
