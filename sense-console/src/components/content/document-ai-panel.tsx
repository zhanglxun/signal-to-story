import { useId, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router"
import { SparklesIcon } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { summarizeJobUsage } from "@/contracts/agent-job"
import type { ContentDocument } from "@/contracts/content"
import { useContentAction } from "@/hooks/use-content-action"
import { useDocumentDraftJobs } from "@/hooks/use-document-draft-jobs"
import { JOB_STATUS_LABEL, JOB_STATUS_VARIANT } from "@/lib/task-center"
import {
  enqueueContentDraftJob,
  listJobUsage,
} from "@/services/agent-job-service"
import { listRunnerNodes, nodeState } from "@/services/runner-node-service"

export function DocumentAiPanel({
  document,
  canEdit,
  blocked = false,
  embedded = false,
}: {
  document: ContentDocument
  canEdit: boolean
  blocked?: boolean
  embedded?: boolean
}) {
  const queryClient = useQueryClient()
  const instructionId = useId()
  const [instruction, setInstruction] = useState(
    "根据项目 Brief 和当前稿件完善一份可审核的内容草案。"
  )
  const [queuedJobId, setQueuedJobId] = useState<string | null>(null)
  const { busy, run } = useContentAction()

  const draftJobs = useDocumentDraftJobs(document, queuedJobId)

  const jobUsage = useQuery({
    queryKey: [
      "agent-jobs",
      "document-usage",
      document.id,
      draftJobs.data?.map((j) => `${j.id}:${j.updatedAt}`).join(",") ?? "",
    ],
    queryFn: () => listJobUsage((draftJobs.data ?? []).map((j) => j.id)),
    enabled: Boolean(draftJobs.data?.length),
  })

  const nodes = useQuery({
    queryKey: ["runner-nodes", document.organization_id],
    queryFn: () => listRunnerNodes(document.organization_id),
    enabled: canEdit,
    refetchInterval: 30_000,
  })

  const hasActiveJob = Boolean(
    draftJobs.data?.some((j) => j.status === "queued" || j.status === "running")
  )
  const hasOnlineNode = nodes.data ? nodes.data.some((n) => nodeState(n) === "online") : true
  const trackedJob = queuedJobId
    ? draftJobs.data?.find((j) => j.id === queuedJobId)
    : undefined
  const waitingTracked = Boolean(
    queuedJobId &&
      (!trackedJob ||
        trackedJob.status === "queued" ||
        trackedJob.status === "running")
  )

  const body = (
    <div className="space-y-4">
      {!hasOnlineNode && (
        <Alert>
          <AlertDescription>
            当前没有在线执行节点，出稿任务会保持排队，直到本机 worker 启动。
            <Link className="ml-2 underline" to="/system/cli-agents">
              管理执行节点
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {canEdit && (
        <Field>
          <FieldLabel htmlFor={instructionId}>创作要求</FieldLabel>
          <Textarea
            id={instructionId}
            value={instruction}
            maxLength={4000}
            rows={4}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <FieldDescription>
            通过预检与独立评估后会直接写入新版本草稿，保留未保存修改不被覆盖。
          </FieldDescription>
        </Field>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={embedded ? "default" : "outline"}
            disabled={busy || blocked || hasActiveJob || !instruction.trim()}
            onClick={() =>
              void run(async () => {
                const job = await enqueueContentDraftJob({
                  documentId: document.id,
                  instruction,
                })
                setQueuedJobId(job.jobId)
                await queryClient.invalidateQueries({
                  queryKey: ["agent-jobs", "document", document.id],
                })
              }, "已交给 Agent 出稿，通过评估后会直接写入新草稿")
            }
          >
            {hasActiveJob ? (
              <>
                <Spinner className="size-4" />
                出稿中…
              </>
            ) : (
              <>
                <SparklesIcon className="size-4" />
                交给 Agent 出稿
              </>
            )}
          </Button>
          {blocked && (
            <span className="text-xs text-muted-foreground">
              请先保存或放弃当前未保存修改
            </span>
          )}
        </div>
      )}

      {queuedJobId && (
        <p className="text-sm">
          {waitingTracked
            ? "Agent 出稿中（生成 → 预检 → 评估），"
            : "本次出稿任务已更新，"}
          <Link className="underline" to={`/tasks/${queuedJobId}`}>
            查看任务进度
          </Link>
        </p>
      )}

      {draftJobs.error && (
        <p role="alert" className="text-sm text-destructive">
          出稿任务读取失败。
        </p>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">最近出稿记录</p>
        {!draftJobs.isLoading && !(draftJobs.data?.length ?? 0) && (
          <Empty className="border py-6">
            <EmptyHeader>
              <EmptyTitle>还没有出稿任务</EmptyTitle>
              <EmptyDescription>
                点击上方「交给 Agent 出稿」开始第一轮生成与评估。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {draftJobs.data?.map((j) => {
          const usage = jobUsage.data?.[j.id] ?? summarizeJobUsage([])
          const writtenRev =
            typeof j.result?.written_revision === "number"
              ? j.result.written_revision
              : null
          const meta = [
            usage.rounds > 0 ? `生成 ${usage.rounds} 轮` : null,
            usage.tokens > 0 ? `${usage.tokens} tokens` : null,
            usage.model,
          ]
            .filter(Boolean)
            .join(" · ")
          return (
            <div className="space-y-1.5 rounded-lg border p-3 text-sm" key={j.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={JOB_STATUS_VARIANT[j.status]}>
                  {j.cancelRequestedAt && j.status === "running"
                    ? "取消中"
                    : JOB_STATUS_LABEL[j.status]}
                </Badge>
                {writtenRev != null && (
                  <Badge variant="outline">已写入 v{writtenRev}</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(j.createdAt).toLocaleString()}
                </span>
                <Link
                  className="ml-auto text-xs underline underline-offset-2"
                  to={`/tasks/${j.id}`}
                >
                  查看执行记录
                </Link>
              </div>
              {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
              {j.error && <p className="text-xs text-destructive">{j.error}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )

  if (embedded) return body

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 出稿</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
