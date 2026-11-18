import { Link, useParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, CheckIcon, FileTextIcon, RotateCcwIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { DraftEvaluationReport } from "@/contracts/agent-harness"
import type { AgentJobStep } from "@/contracts/agent-job"
import { groupStepsByRound, isTerminalJob, JOB_STATUS_LABEL, JOB_STATUS_VARIANT, stepTokens } from "@/lib/task-center"
import { cancelAgentJob, getAgentJob, listAgentJobSteps, resumeAgentJob } from "@/services/agent-job-service"
import { getJobTargets } from "@/services/task-center-service"

const STEP_LABEL: Record<string, string> = { context: "上下文", fetch: "抓取链接", generate: "生成", precheck: "确定性预检", evaluate: "独立评估", persist: "保存提案" }

function Checklist({ report }: { report: DraftEvaluationReport }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {report.criteria.map((c) => (
        <li key={c.criterionKey} className="flex gap-2 text-sm">
          {c.passed ? <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-label="通过" /> : <XIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="未通过" />}
          <span><span className="font-medium">{c.criterionKey}</span>{c.feedback && <span className="text-muted-foreground"> · {c.feedback}</span>}</span>
        </li>
      ))}
      {report.parseError && <li className="text-sm text-destructive">评估输出无效：{report.parseError}</li>}
    </ul>
  )
}

function StepRow({ step }: { step: AgentJobStep }) {
  const report = step.evaluation as DraftEvaluationReport | null
  const tokens = stepTokens(step)
  const meta = [step.model, tokens ? `${tokens} tokens` : null, step.costCents ? `${step.costCents} 分` : null, step.durationMs != null ? `${step.durationMs} ms` : null].filter(Boolean).join(" · ")
  return (
    <div className="border-l pl-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{STEP_LABEL[step.stepKind] ?? step.stepKind}</span>
        <Badge variant={step.status === "succeeded" ? "secondary" : "destructive"}>{step.status === "succeeded" ? "通过" : "未通过"}</Badge>
        {report && typeof report.score === "number" && <span className="text-xs tabular-nums text-muted-foreground">得分 {report.score}</span>}
      </div>
      {meta && <p className="mt-1 text-xs text-muted-foreground">{meta}</p>}
      {step.error && <p className="mt-1 text-xs text-destructive">{step.error}</p>}
      {report?.criteria && <Checklist report={report} />}
      {report?.revisionInstruction && <p className="mt-2 rounded-md bg-muted p-2 text-xs leading-5">反馈：{report.revisionInstruction}</p>}
    </div>
  )
}

export function TaskDetailPage() {
  const { taskId = "" } = useParams()
  const queryClient = useQueryClient()
  const job = useQuery({
    queryKey: ["agent-jobs", "detail", taskId],
    queryFn: () => getAgentJob(taskId),
    refetchInterval: (q) => (q.state.data && !isTerminalJob(q.state.data.status) && q.state.data.status !== "pending_review" ? 5000 : false),
  })
  const steps = useQuery({ queryKey: ["agent-jobs", "steps", taskId], queryFn: () => listAgentJobSteps(taskId), refetchInterval: job.data?.status === "running" ? 5000 : false })
  const target = useQuery({ queryKey: ["agent-jobs", "target", taskId], queryFn: () => getJobTargets(job.data ? [job.data] : []), enabled: Boolean(job.data?.targetId) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["agent-jobs"] })
  const cancel = useMutation({ mutationFn: () => cancelAgentJob(taskId), onSuccess: () => { toast.success("已请求取消"); void refresh() }, onError: (e) => toast.error((e as Error).message) })
  const resume = useMutation({ mutationFn: () => resumeAgentJob(taskId, { extraRounds: 1 }), onSuccess: () => { toast.success("已追加一轮并重新排队"); void refresh() }, onError: (e) => toast.error((e as Error).message) })

  const back = <Link to="/tasks" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />返回任务中心</Link>
  if (job.isError) return <div className="space-y-6">{back}<Alert variant="destructive"><AlertTitle>无法读取任务</AlertTitle><AlertDescription>{(job.error as Error).message}</AlertDescription></Alert></div>
  if (job.isPending) return <div className="space-y-6">{back}<Skeleton className="h-48 w-full" /></div>
  if (!job.data) return <div className="space-y-6">{back}<Alert><AlertTitle>任务不存在</AlertTitle><AlertDescription>任务可能属于其他组织，或已被删除。</AlertDescription></Alert></div>

  const j = job.data
  const doc = j.targetId ? target.data?.[j.targetId] : undefined
  const proposalId = typeof j.result?.proposal_id === "string" ? j.result.proposal_id : null
  const rounds = groupStepsByRound(steps.data ?? [])
  const evaluatedRounds = new Set((steps.data ?? []).filter((s) => s.stepKind === "evaluate" || s.stepKind === "precheck").map((s) => s.round)).size

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        eyebrow={`${j.jobType} · ${j.id.slice(0, 8)}`}
        title={doc?.title ?? "Agent 任务"}
        description={String(j.payload.instruction ?? "")}
        actions={
          <>
            {j.status === "blocked_needs_human" && <Button disabled={resume.isPending} onClick={() => resume.mutate()}><RotateCcwIcon />追加一轮继续</Button>}
            {!isTerminalJob(j.status) && !j.cancelRequestedAt && <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}><XIcon />取消</Button>}
            {doc?.workItemId && <Button variant="outline" nativeButton={false} render={<Link to={`/work-items/${doc.workItemId}`} />}><FileTextIcon />{proposalId ? "查看稿件提案" : "打开稿件"}</Button>}
          </>
        }
      />
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant={JOB_STATUS_VARIANT[j.status]}>{j.cancelRequestedAt && j.status === "running" ? "取消中" : JOB_STATUS_LABEL[j.status]}</Badge>
        <span className="text-muted-foreground">轮次 {j.rounds}/{j.maxRounds} · 评估 {evaluatedRounds} 轮 · 跳数 {j.hopsUsed}/{j.maxHops} · Tokens {j.tokensUsed} · 成本 {j.costCents}/{j.budgetCents} 分 · 尝试 {j.attempts}/{j.maxAttempts}{j.model ? ` · ${j.driver ?? ""} ${j.model}` : ""}</span>
      </div>
      {j.error && <Alert variant={j.status === "failed" ? "destructive" : "default"}><AlertTitle>{j.status === "pending_review" ? "说明" : "停止原因"}{j.errorCode ? ` (${j.errorCode})` : ""}</AlertTitle><AlertDescription>{j.error}</AlertDescription></Alert>}
      {typeof j.result?.termination_reason === "string" && j.status === "pending_review" && <Alert><AlertTitle>结果</AlertTitle><AlertDescription>{j.result.termination_reason}</AlertDescription></Alert>}

      <Card>
        <CardHeader className="border-b"><CardTitle>执行记录</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {steps.isError && <p className="text-sm text-destructive">步骤读取失败。</p>}
          {!rounds.length && !steps.isPending && <p className="text-sm text-muted-foreground">尚未开始执行。</p>}
          {rounds.map((r) => (
            <section key={r.round} aria-label={r.round === 0 ? "准备" : `第 ${r.round} 轮`}>
              <h3 className="mb-3 text-sm font-semibold">{r.round === 0 ? "准备" : `第 ${r.round} 轮`}</h3>
              <div className="space-y-4">{r.steps.map((s) => <StepRow key={s.id} step={s} />)}</div>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
