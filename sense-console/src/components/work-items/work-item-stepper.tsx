import { Link } from "react-router"
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PencilIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import type {
  WorkflowStepVisual,
  WorkItemWorkflowState,
} from "@/lib/work-item-workflow"
import { cn } from "@/lib/utils"

function stepContainerClass(visual: WorkflowStepVisual) {
  switch (visual) {
    case "done":
      return "border-border bg-muted/40 text-foreground"
    case "current":
      return "border-primary bg-primary/5 text-foreground"
    case "running":
      return "border-primary bg-primary/5 text-foreground"
    case "attention":
      return "border-destructive/50 bg-destructive/5 text-foreground"
    default:
      return "border-border/60 bg-background text-muted-foreground"
  }
}

function StepBadge({
  number,
  visual,
}: {
  number: number
  visual: WorkflowStepVisual
}) {
  if (visual === "done") {
    return (
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <CheckIcon className="size-3.5" />
      </span>
    )
  }
  if (visual === "running") {
    return (
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Spinner className="size-3.5" />
      </span>
    )
  }
  if (visual === "attention") {
    return (
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-destructive text-primary-foreground">
        <AlertCircleIcon className="size-3.5" />
      </span>
    )
  }
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
        visual === "current"
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-muted text-muted-foreground"
      )}
    >
      {number}
    </span>
  )
}

export function WorkItemStepper({
  workflow,
  canManage,
  canReview,
  busy,
  dirty,
  hasActiveDoc,
  onCreateMasterAndDraft,
  onCreateMaster,
  onTriggerAiDraft,
  onStartEditing,
  onApproveDirectly,
  onSubmitForReview,
  onOpenRejectDialog,
  onScrollToPublish,
  onCopyMarkdown,
  onExportMarkdown,
  onMarkDone,
  onReopenItem,
}: {
  workflow: WorkItemWorkflowState
  canManage: boolean
  canReview: boolean
  busy: boolean
  dirty: boolean
  hasActiveDoc: boolean
  onCreateMasterAndDraft: () => void
  onCreateMaster: () => void
  onTriggerAiDraft: () => void
  onStartEditing: () => void
  onApproveDirectly: () => void
  onSubmitForReview: () => void
  onOpenRejectDialog: () => void
  onScrollToPublish: () => void
  onCopyMarkdown: () => void
  onExportMarkdown: () => void
  onMarkDone: () => void
  onReopenItem: () => void
}) {
  const { substate, steps, activeJob, latestJob } = workflow

  return (
    <Card>
      <CardContent className="pt-4">
        <ol
          aria-label="创作流程进度"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {steps.map((step) => (
            <li
              key={step.number}
              aria-current={step.number === workflow.currentStep ? "step" : undefined}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                stepContainerClass(step.visual)
              )}
            >
              <StepBadge number={step.number} visual={step.visual} />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium leading-tight">
                  {step.number}. {step.title}
                </p>
                <p className="line-clamp-1 text-xs text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>

      <CardFooter className="flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                substate === "done_unapproved_mismatch" ||
                substate === "ai_failed" ||
                substate === "changes_requested"
                  ? "destructive"
                  : substate === "done_clean" ||
                      substate === "approved_ready_to_publish" ||
                      substate === "approved_published"
                    ? "secondary"
                    : "outline"
              }
            >
              第 {workflow.currentStep} / 4 步
            </Badge>
            <p className="text-sm font-medium">{workflow.headline}</p>
          </div>
          <p className="text-xs text-muted-foreground">{workflow.description}</p>
          {dirty && (
            <p className="text-xs font-medium text-destructive">
              当前有未保存修改，请先点击下方「保存新版本」后再推进。
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {substate === "no_master" && canManage && (
            <>
              <Button disabled={busy} onClick={onCreateMasterAndDraft}>
                <SparklesIcon className="size-4" />
                创建并让 AI 出稿
              </Button>
              <Button variant="outline" disabled={busy} onClick={onCreateMaster}>
                创建母稿
              </Button>
            </>
          )}

          {substate === "empty_doc" && canManage && (
            <>
              <Button disabled={busy || dirty} onClick={onTriggerAiDraft}>
                <SparklesIcon className="size-4" />
                交给 AI 出稿
              </Button>
              <Button variant="outline" disabled={busy} onClick={onStartEditing}>
                <PencilIcon className="size-4" />
                手动写作
              </Button>
            </>
          )}

          {substate === "ai_running" && activeJob && (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to={`/tasks/${activeJob.id}`} />}
            >
              查看任务进度
              <ExternalLinkIcon className="size-4" />
            </Button>
          )}

          {substate === "ai_failed" && (
            <>
              {canManage && (
                <Button disabled={busy || dirty} onClick={onTriggerAiDraft}>
                  <RotateCcwIcon className="size-4" />
                  重新交给 AI 出稿
                </Button>
              )}
              {latestJob && (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link to={`/tasks/${latestJob.id}`} />}
                >
                  查看失败日志
                  <ExternalLinkIcon className="size-4" />
                </Button>
              )}
            </>
          )}

          {(substate === "ai_ready_to_review" ||
            substate === "draft_ready" ||
            substate === "changes_requested") && (
            <>
              {canManage && canReview && (
                <Button disabled={busy || dirty} onClick={onApproveDirectly}>
                  <CheckCircle2Icon className="size-4" />
                  一键确认并定稿
                </Button>
              )}
              {canManage && !canReview && (
                <Button disabled={busy || dirty} onClick={onSubmitForReview}>
                  提交给审校人
                  <ArrowRightIcon className="size-4" />
                </Button>
              )}
              {canManage && (
                <Button variant="outline" disabled={busy} onClick={onStartEditing}>
                  <PencilIcon className="size-4" />
                  编辑正文
                </Button>
              )}
            </>
          )}

          {substate === "in_review" && canReview && (
            <>
              <Button disabled={busy || dirty} onClick={onApproveDirectly}>
                <CheckCircle2Icon className="size-4" />
                立即通过定稿
              </Button>
              <Button
                variant="outline"
                disabled={busy || dirty}
                onClick={onOpenRejectDialog}
              >
                退回修改…
              </Button>
            </>
          )}

          {substate === "approved_ready_to_publish" && (
            <>
              <Button onClick={onScrollToPublish}>
                前往发布
                <ArrowRightIcon className="size-4" />
              </Button>
              {hasActiveDoc && (
                <Button variant="outline" onClick={onCopyMarkdown}>
                  <CopyIcon className="size-4" />
                  复制 Markdown
                </Button>
              )}
              {canManage && (
                <Button variant="outline" disabled={busy} onClick={onMarkDone}>
                  标记事项完成
                </Button>
              )}
            </>
          )}

          {substate === "approved_published" && (
            <>
              {canManage && (
                <Button disabled={busy} onClick={onMarkDone}>
                  <CheckCircle2Icon className="size-4" />
                  标记事项完成
                </Button>
              )}
              {hasActiveDoc && (
                <Button variant="outline" onClick={onCopyMarkdown}>
                  <CopyIcon className="size-4" />
                  复制 Markdown
                </Button>
              )}
              {hasActiveDoc && (
                <Button variant="outline" onClick={onExportMarkdown}>
                  <DownloadIcon className="size-4" />
                  导出 Markdown
                </Button>
              )}
            </>
          )}

          {substate === "done_clean" && (
            <>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link to="/analytics" />}
              >
                查看数据与复盘
                <ArrowRightIcon className="size-4" />
              </Button>
              {canManage && (
                <Button variant="outline" disabled={busy} onClick={onReopenItem}>
                  <RotateCcwIcon className="size-4" />
                  重新打开
                </Button>
              )}
            </>
          )}

          {substate === "done_unapproved_mismatch" && (
            <>
              {canManage && canReview && hasActiveDoc && (
                <Button disabled={busy || dirty} onClick={onApproveDirectly}>
                  <CheckCircle2Icon className="size-4" />
                  补做定稿
                </Button>
              )}
              {canManage && (
                <Button variant="outline" disabled={busy} onClick={onReopenItem}>
                  <RotateCcwIcon className="size-4" />
                  切回待审核
                </Button>
              )}
            </>
          )}

          {substate === "dropped" && canManage && (
            <Button variant="outline" disabled={busy} onClick={onReopenItem}>
              <RotateCcwIcon className="size-4" />
              重新打开
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  )
}
