import { useState } from "react"
import { CheckIcon, ShieldAlertIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { PermissionOption } from "@/modules/chat/types"

const DEFAULT_PERMISSION_OPTIONS: PermissionOption[] = [
  { id: "allow", label: "允许", kind: "allow" },
  { id: "deny", label: "拒绝", kind: "deny" },
]

export interface PermissionQuestionnaireCardProps {
  requestId: string
  action: string
  summary: string
  options?: PermissionOption[]
  decision?: "allow" | "deny" | "timeout"
  onAnswer?: (requestId: string, decision: "allow" | "deny") => void | Promise<void>
  className?: string
}

const DECISION_BADGE: Record<
  "allow" | "deny" | "timeout",
  { label: string; variant: "default" | "outline" | "destructive" }
> = {
  allow: { label: "已允许", variant: "default" },
  deny: { label: "已拒绝", variant: "outline" },
  timeout: { label: "已超时（按拒绝处理）", variant: "destructive" },
}

export function PermissionQuestionnaireCard({
  requestId,
  action,
  summary,
  options,
  decision,
  onAnswer,
  className,
}: PermissionQuestionnaireCardProps) {
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const resolvedOptions =
    options && options.length > 0 ? options : DEFAULT_PERMISSION_OPTIONS
  const decisionBadge = decision ? DECISION_BADGE[decision] : null

  async function handleSelect(kind: "allow" | "deny") {
    if (!onAnswer || submitting || decision) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onAnswer(requestId, kind)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "提交确认结果失败，请重试")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card size="sm" className={cn("bg-card", className)}>
      <CardHeader className="items-center border-b">
        <CardTitle className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <ShieldAlertIcon className="size-3.5 shrink-0 text-primary" />
          <span>需要人类确认</span>
          <Badge variant="secondary" className="h-4 px-1.5 font-mono text-[10px]">
            {action}
          </Badge>
        </CardTitle>

        {decisionBadge && (
          <CardAction>
            <Badge variant={decisionBadge.variant} className="h-5 px-2 text-[10px]">
              {decisionBadge.label}
            </Badge>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="space-y-2.5 text-xs">
        <p className="text-foreground/90">{summary}</p>

        {!decision && onAnswer && (
          <div className="flex flex-wrap items-center gap-2">
            {resolvedOptions.map((opt) => (
              <Button
                key={opt.id}
                type="button"
                size="xs"
                variant={opt.kind === "allow" ? "default" : "outline"}
                disabled={submitting}
                onClick={() => void handleSelect(opt.kind)}
              >
                {opt.kind === "allow" ? (
                  <CheckIcon className="size-3" />
                ) : (
                  <XIcon className="size-3" />
                )}
                {opt.label}
              </Button>
            ))}
          </div>
        )}

        {submitError && (
          <p role="alert" className="text-xs text-destructive">
            {submitError}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
