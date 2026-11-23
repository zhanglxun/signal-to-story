import { useState } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CircleHelpIcon,
  CircleSlashIcon,
  ClapperboardIcon,
  ClockIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileTextIcon,
  InboxIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AgentJob, AgentJobStatus } from "@/contracts/agent-job"
import { platforms as platformLabels } from "@/contracts/content"
import { usePagination } from "@/hooks/use-pagination"
import {
  APPROVAL_ACTION_LABEL,
  attentionCount,
  buildRetryMap,
  canRetryJob,
  getJobDisplayTitle,
  getJobKindLabel,
  groupTasks,
  isTerminalJob,
  JOB_STATUS_LABEL,
  JOB_STATUS_VARIANT,
  matchesStatusTab,
  resolveInitialStatusTab,
  retriedFromJobId,
  TASK_STATUS_TABS,
  type TaskStatusTab,
} from "@/lib/task-center"
import { cn } from "@/lib/utils"
import { cancelAgentJob, resumeAgentJob, retryAgentJob } from "@/services/agent-job-service"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { listRunnerNodes, nodeState } from "@/services/runner-node-service"
import { getTaskCenter, type JobTargetInfo } from "@/services/task-center-service"

const PAGE_SIZE = 20

const DEFAULT_FILTER_KINDS = [
  "content_draft",
  "video_storyboard",
  "video_tts_preview",
  "video_shot_render",
  "video_compose",
  "publish_site",
  "publish_external",
] as const

const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function renderStatusIcon(status: AgentJobStatus) {
  switch (status) {
    case "running":
      return <Spinner className="size-3" />
    case "queued":
      return <ClockIcon className="size-3" />
    case "pending_review":
      return <EyeIcon className="size-3" />
    case "blocked_needs_human":
      return <CircleHelpIcon className="size-3" />
    case "failed":
      return <AlertCircleIcon className="size-3" />
    case "succeeded":
      return <CheckCircle2Icon className="size-3" />
    case "cancelled":
      return <CircleSlashIcon className="size-3" />
  }
}

function formatTargetPlatform(target?: JobTargetInfo): string | null {
  if (!target?.platform) return null
  if (target.targetType === "video_plan") return target.platform
  if (target.platform === "master") return "母稿"
  return platformLabels[target.platform as keyof typeof platformLabels] ?? target.platform
}

export function TasksPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState("")
  const [kindFilter, setKindFilter] = useState<string>("all")
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)

  const statusTab = resolveInitialStatusTab(location.hash, searchParams.get("status"))
  const setStatusTab = (nextTab: TaskStatusTab) => {
    const nextParams = new URLSearchParams(searchParams)
    if (nextTab === "all") {
      nextParams.delete("status")
    } else {
      nextParams.set("status", nextTab)
    }
    const nextSearch = nextParams.toString()
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
        hash: "",
      },
      { replace: true },
    )
  }

  const workspace = useQuery({ queryKey: ["content-workspace"], queryFn: getContentWorkspace })
  const organizationId = workspace.data?.organization?.id
  const canDispatch = workspace.data?.canDispatch ?? Boolean(workspace.data?.canManage)

  const query = useQuery({
    queryKey: ["agent-jobs", "task-center", organizationId],
    queryFn: () => getTaskCenter(organizationId!),
    enabled: Boolean(organizationId),
    refetchInterval: 10_000,
  })

  const nodesQuery = useQuery({
    queryKey: ["runner-nodes", organizationId],
    queryFn: () => listRunnerNodes(organizationId!),
    enabled: Boolean(organizationId),
    refetchInterval: 30_000,
  })

  const invalidateRelated = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["agent-jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["content-data"] }),
      queryClient.invalidateQueries({ queryKey: ["work-item"] }),
    ])
  }

  const retryMutation = useMutation({
    mutationFn: (job: AgentJob) => retryAgentJob(job),
    onMutate: (job) => setPendingJobId(job.id),
    onSettled: () => setPendingJobId(null),
    onSuccess: () => {
      toast.success("已重新提交任务进入队列")
      void invalidateRelated()
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const resumeMutation = useMutation({
    mutationFn: (job: AgentJob) => resumeAgentJob(job.id, { extraRounds: 1 }),
    onMutate: (job) => setPendingJobId(job.id),
    onSettled: () => setPendingJobId(null),
    onSuccess: () => {
      toast.success("已追加一轮并重新排队")
      void invalidateRelated()
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const cancelMutation = useMutation({
    mutationFn: (job: AgentJob) => cancelAgentJob(job.id),
    onMutate: (job) => setPendingJobId(job.id),
    onSettled: () => setPendingJobId(null),
    onSuccess: () => {
      toast.success("已请求取消任务")
      void invalidateRelated()
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const jobs = query.data?.jobs ?? []
  const approvals = query.data?.approvals ?? []
  const targets = query.data?.targets ?? {}
  const usage = query.data?.usage ?? {}

  const keyword = search.trim().toLowerCase()
  const filteredJobs = jobs
    .filter((job) => matchesStatusTab(job, statusTab))
    .filter((job) => (kindFilter === "all" ? true : job.kind === kindFilter))
    .filter((job) => {
      if (!keyword) return true
      const target = job.target ? targets[job.target.id] : undefined
      const title = getJobDisplayTitle(job, target).toLowerCase()
      const kindLabel = getJobKindLabel(job.kind).toLowerCase()
      const instruction = typeof job.payload.instruction === "string" ? job.payload.instruction.toLowerCase() : ""
      const outline = typeof job.payload.outline === "string" ? job.payload.outline.toLowerCase() : ""
      return (
        title.includes(keyword) ||
        job.id.toLowerCase().includes(keyword) ||
        job.kind.toLowerCase().includes(keyword) ||
        kindLabel.includes(keyword) ||
        (job.error ?? "").toLowerCase().includes(keyword) ||
        (job.errorCode ?? "").toLowerCase().includes(keyword) ||
        instruction.includes(keyword) ||
        outline.includes(keyword)
      )
    })

  const { page, pageCount, pageItems, setPage, totalCount } = usePagination(filteredJobs, PAGE_SIZE)

  const header = (
    <PageHeader
      title="任务中心"
      description="按状态查看与管理 Agent 执行任务，支持失败重试、人工继续与取消调度。"
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!organizationId || query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCwIcon className={cn("size-4", query.isFetching && "animate-spin")} />
            刷新
          </Button>
          <Button nativeButton={false} render={<Link to="/capture" />}>
            <NotebookPenIcon className="size-4" />
            速记
          </Button>
        </>
      }
    />
  )

  if (workspace.isSuccess && !organizationId) {
    return (
      <div className="space-y-4">
        {header}
        <Alert>
          <AlertTitle>账号尚未加入组织</AlertTitle>
          <AlertDescription>请先完成组织初始化。</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="space-y-4">
        {header}
        <Alert variant="destructive">
          <AlertTitle>无法读取任务</AlertTitle>
          <AlertDescription>{(query.error as Error).message}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!query.data) {
    return (
      <div className="space-y-4">
        {header}
        <Skeleton className="h-9 w-full max-w-xl" />
        <Skeleton className="h-8 w-full max-w-md" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  const availableKinds = [...DEFAULT_FILTER_KINDS] as string[]
  for (const job of jobs) {
    if (!availableKinds.includes(job.kind)) availableKinds.push(job.kind)
  }
  const kindFilterItems: Record<string, string> = {
    all: "全部类型",
    ...Object.fromEntries(availableKinds.map((k) => [k, getJobKindLabel(k)])),
  }

  const retryMap = buildRetryMap(jobs)
  const attentionTotal = attentionCount(groupTasks(jobs, approvals))
  const hasFilters = Boolean(keyword) || kindFilter !== "all"
  const hasQueuedJobs = jobs.some((j) => j.status === "queued")
  const hasOnlineNode = nodesQuery.data ? nodesQuery.data.some((n) => nodeState(n) === "online") : true
  const showApprovalsCard = approvals.length > 0 && (statusTab === "all" || statusTab === "blocked_needs_human")

  return (
    <div className="space-y-4">
      {header}

      {hasQueuedJobs && !hasOnlineNode && (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>当前没有在线执行节点</AlertTitle>
          <AlertDescription>
            排队中的任务会等待本机 worker 启动后继续执行。
            <Link className="ml-2 underline" to="/system/cli-agents">
              管理执行节点
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {showApprovalsCard && (
        <Card size="sm">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span>待批准的高风险动作</span>
              <Badge variant="outline" className="tabular-nums">
                {approvals.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {approvals.map((approval) => {
              const targetLink = approval.requestedByJob
                ? `/tasks/${approval.requestedByJob}`
                : approval.targetType === "video_plan"
                  ? "/video/storyboards"
                  : null
              return (
                <div
                  key={approval.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{APPROVAL_ACTION_LABEL[approval.action] ?? approval.action}</Badge>
                      <span className="truncate font-medium text-foreground">
                        {approval.summary || `${approval.targetType} ${approval.targetId}`}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {timeFormat.format(new Date(approval.createdAt))}
                    </span>
                    {targetLink && (
                      <Button variant="outline" size="sm" nativeButton={false} render={<Link to={targetLink} />}>
                        去处理
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <Tabs
        value={statusTab}
        onValueChange={(value) => {
          if (typeof value === "string") setStatusTab(value as TaskStatusTab)
        }}
      >
        <TabsList className="h-auto flex-wrap">
          {TASK_STATUS_TABS.map((tab) => {
            const count = jobs.filter((job) => matchesStatusTab(job, tab.key)).length
            return (
              <TabsTrigger key={tab.key} value={tab.key} className="gap-1.5 px-2.5">
                <span>{tab.label}</span>
                <Badge
                  variant={tab.key === "failed" && count > 0 ? "destructive" : "secondary"}
                  className="h-5 min-w-5 rounded-full px-1.5 text-[11px] tabular-nums"
                >
                  {count}
                </Badge>
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      {/* 工具栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-8 w-full sm:w-64"
            aria-label="搜索任务"
            placeholder="搜索任务标题、报错或 ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            items={kindFilterItems}
            value={kindFilter}
            onValueChange={(value) => {
              if (typeof value === "string") setKindFilter(value)
            }}
          >
            <SelectTrigger size="sm" aria-label="按任务类型筛选" className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {availableKinds.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {getJobKindLabel(kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => {
                setSearch("")
                setKindFilter("all")
              }}
            >
              重置
              <XIcon className="size-3.5" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          待我处理 <span className="font-medium text-foreground">{attentionTotal}</span> 项
        </p>
      </div>

      {/* 标准数据表格 */}
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[240px]">任务</TableHead>
              <TableHead className="w-28">类型</TableHead>
              <TableHead className="w-28">状态</TableHead>
              <TableHead className="hidden w-36 md:table-cell">进度</TableHead>
              <TableHead className="hidden w-36 sm:table-cell">更新时间</TableHead>
              <TableHead className="w-40 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-44 whitespace-normal">
                  <Empty className="border-0 py-6">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <InboxIcon />
                      </EmptyMedia>
                      <EmptyTitle>
                        {jobs.length === 0 ? "还没有 Agent 任务" : "没有匹配的任务"}
                      </EmptyTitle>
                      <EmptyDescription>
                        {jobs.length === 0
                          ? "用顶栏速记（⌘/Ctrl + K）选择“自动出稿到待审”，任务会出现在这里。"
                          : "当前状态页签或筛选条件下没有任务，可切换页签或重置筛选。"}
                      </EmptyDescription>
                    </EmptyHeader>
                    {jobs.length > 0 && (hasFilters || statusTab !== "all") && (
                      <EmptyContent>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSearch("")
                            setKindFilter("all")
                            setStatusTab("all")
                          }}
                        >
                          清空筛选
                        </Button>
                      </EmptyContent>
                    )}
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((job) => {
                const target = job.target ? targets[job.target.id] : undefined
                const title = getJobDisplayTitle(job, target)
                const parentJobId = retriedFromJobId(job)
                const latestRetry = retryMap.get(job.id)
                const hasActiveRetry = Boolean(
                  latestRetry && (latestRetry.status === "queued" || latestRetry.status === "running"),
                )
                const jobUsage = usage[job.id]
                const rounds = jobUsage?.rounds ?? 0
                const tokens = jobUsage?.tokens ?? 0
                const writtenRev =
                  typeof job.result?.written_revision === "number" ? job.result.written_revision : null
                const isRowBusy = pendingJobId === job.id
                const platformLabel = formatTargetPlatform(target)
                const isMultiRound =
                  job.kind === "content_draft" || job.kind === "video_storyboard" || rounds > 0
                const statusLabel =
                  job.cancelRequestedAt && job.status === "running" ? "取消中" : JOB_STATUS_LABEL[job.status]

                return (
                  <TableRow key={job.id}>
                    <TableCell className="max-w-md whitespace-normal">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            to={`/tasks/${job.id}`}
                            className="line-clamp-1 font-medium text-foreground hover:underline"
                          >
                            {title}
                          </Link>
                          {parentJobId && (
                            <Badge variant="outline" className="text-[11px]">
                              重试
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          {platformLabel && <span>{platformLabel}</span>}
                          <span className="font-mono">#{job.id.slice(0, 8)}</span>
                          {writtenRev != null && <span>已写 v{writtenRev}</span>}
                        </div>
                        {job.error && (
                          <p
                            className={cn(
                              "line-clamp-1 text-xs",
                              job.status === "failed" ? "text-destructive" : "text-muted-foreground",
                            )}
                            title={job.error}
                          >
                            {job.error}
                          </p>
                        )}
                        {job.status === "failed" && latestRetry && (
                          <p className="text-xs text-muted-foreground">
                            已重试：
                            <Link
                              to={`/tasks/${latestRetry.id}`}
                              className="underline underline-offset-2 hover:text-foreground"
                            >
                              #{latestRetry.id.slice(0, 8)}（{JOB_STATUS_LABEL[latestRetry.status]}）
                            </Link>
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{getJobKindLabel(job.kind)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={JOB_STATUS_VARIANT[job.status]} className="gap-1">
                        {renderStatusIcon(job.status)}
                        {statusLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="space-y-0.5 text-xs tabular-nums">
                        <p className="text-foreground">
                          {isMultiRound
                            ? `第 ${rounds}/${job.limits.maxRounds} 轮`
                            : `尝试 ${job.attempts}/${job.maxAttempts}`}
                        </p>
                        {(isMultiRound || tokens > 0) && (
                          <p className="text-muted-foreground">
                            {[
                              isMultiRound ? `尝试 ${job.attempts}/${job.maxAttempts}` : null,
                              tokens > 0 ? `${tokens} tokens` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground tabular-nums sm:table-cell">
                      <span title={new Date(job.updatedAt).toLocaleString()}>
                        {timeFormat.format(new Date(job.updatedAt))}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        {job.status === "failed" ? (
                          hasActiveRetry && latestRetry ? (
                            <Link
                              to={`/tasks/${latestRetry.id}`}
                              className={buttonVariants({ variant: "outline", size: "sm" })}
                            >
                              查看重试
                            </Link>
                          ) : canDispatch ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isRowBusy}
                              onClick={() => retryMutation.mutate(job)}
                            >
                              {isRowBusy ? (
                                <Spinner className="size-3.5" />
                              ) : (
                                <RotateCcwIcon className="size-3.5" />
                              )}
                              {isRowBusy ? "重试中" : "重试"}
                            </Button>
                          ) : (
                            <Link
                              to={`/tasks/${job.id}`}
                              className={buttonVariants({ variant: "outline", size: "sm" })}
                            >
                              详情
                            </Link>
                          )
                        ) : job.status === "blocked_needs_human" && canDispatch ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isRowBusy}
                            onClick={() => resumeMutation.mutate(job)}
                          >
                            {isRowBusy ? (
                              <Spinner className="size-3.5" />
                            ) : (
                              <PlayIcon className="size-3.5" />
                            )}
                            继续
                          </Button>
                        ) : job.status === "pending_review" ? (
                          <Link
                            to={target?.workItemId ? `/work-items/${target.workItemId}` : `/tasks/${job.id}`}
                            className={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            去审核
                          </Link>
                        ) : (
                          <Link
                            to={`/tasks/${job.id}`}
                            className={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            详情
                          </Link>
                        )}

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`更多操作 ${title}`}
                                disabled={isRowBusy}
                              />
                            }
                          >
                            <MoreHorizontalIcon className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => navigate(`/tasks/${job.id}`)}>
                              <ExternalLinkIcon className="size-4" />
                              查看执行日志
                            </DropdownMenuItem>
                            {target?.workItemId && (
                              <DropdownMenuItem
                                onClick={() => navigate(`/work-items/${target.workItemId}`)}
                              >
                                <FileTextIcon className="size-4" />
                                打开所属事项
                              </DropdownMenuItem>
                            )}
                            {!target?.workItemId && target?.targetType === "video_plan" && (
                              <DropdownMenuItem onClick={() => navigate("/video/storyboards")}>
                                <ClapperboardIcon className="size-4" />
                                打开分镜工坊
                              </DropdownMenuItem>
                            )}
                            {canDispatch && canRetryJob(job) && !hasActiveRetry && (
                              <DropdownMenuItem onClick={() => retryMutation.mutate(job)}>
                                <RotateCcwIcon className="size-4" />
                                {job.status === "failed" ? "重试任务" : "重新发起"}
                              </DropdownMenuItem>
                            )}
                            {canDispatch && job.status === "blocked_needs_human" && (
                              <DropdownMenuItem onClick={() => resumeMutation.mutate(job)}>
                                <PlayIcon className="size-4" />
                                追加一轮继续
                              </DropdownMenuItem>
                            )}
                            {canDispatch && !isTerminalJob(job.status) && !job.cancelRequestedAt && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => cancelMutation.mutate(job)}
                                >
                                  <XIcon className="size-4" />
                                  取消任务
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <PaginationBar page={page} pageCount={pageCount} totalCount={totalCount} onPageChange={setPage} />
    </div>
  )
}
