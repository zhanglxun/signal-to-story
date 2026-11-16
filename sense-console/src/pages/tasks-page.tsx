import { Link } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, InboxIcon, NotebookPenIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { platforms as platformLabels } from "@/contracts/content"
import { attentionCount, groupTasks, JOB_STATUS_LABEL, JOB_STATUS_VARIANT } from "@/lib/task-center"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { getTaskCenter } from "@/services/task-center-service"

const timeFormat = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })

export function TasksPage() {
  const workspace = useQuery({ queryKey: ["content-workspace"], queryFn: getContentWorkspace })
  const organizationId = workspace.data?.organization?.id
  const query = useQuery({
    queryKey: ["agent-jobs", "task-center", organizationId],
    queryFn: () => getTaskCenter(organizationId!),
    enabled: Boolean(organizationId),
    refetchInterval: 10_000,
  })

  const header = (
    <PageHeader
      eyebrow="Agent operations"
      title="任务中心"
      description="以“待我处理”为中心：先看等你审核与拍板的，再看异常与进行中的 Agent 任务。"
      actions={<Button nativeButton={false} render={<Link to="/capture" />}><NotebookPenIcon />速记</Button>}
    />
  )

  if (workspace.isSuccess && !organizationId) return <div className="space-y-6">{header}<Alert><AlertTitle>账号尚未加入组织</AlertTitle><AlertDescription>请先完成组织初始化。</AlertDescription></Alert></div>
  if (query.isError) return <div className="space-y-6">{header}<Alert variant="destructive"><AlertTitle>无法读取任务</AlertTitle><AlertDescription>{(query.error as Error).message}</AlertDescription></Alert></div>
  if (!query.data) return <div className="space-y-6">{header}<Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>

  const { jobs, approvals, targets } = query.data
  const groups = groupTasks(jobs, approvals)
  if (!jobs.length && !approvals.length) {
    return <div className="space-y-6">{header}<Empty><EmptyHeader><EmptyMedia variant="icon"><InboxIcon /></EmptyMedia><EmptyTitle>还没有 Agent 任务</EmptyTitle><EmptyDescription>用顶栏速记（⌘/Ctrl + K）选择“自动出稿到待审”，任务会出现在这里。</EmptyDescription></EmptyHeader></Empty></div>
  }

  return (
    <div className="space-y-6">
      {header}
      <p className="text-sm text-muted-foreground">待我处理 <span className="font-semibold text-foreground tabular-nums">{attentionCount(groups)}</span> 项</p>
      {groups.filter((g) => g.jobs.length || g.approvals.length).map((group) => (
        <Card key={group.key} aria-labelledby={`group-${group.key}`}>
          <CardHeader className="border-b">
            <CardTitle id={`group-${group.key}`} className="flex items-center gap-2">{group.label}<Badge variant="outline" className="tabular-nums">{group.jobs.length + group.approvals.length}</Badge></CardTitle>
            <CardDescription>{group.description}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="hidden md:table-cell">轮次</TableHead>
                  <TableHead className="hidden lg:table-cell">更新</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.approvals.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell><p className="font-medium">待批准：{a.action}</p><p className="mt-1 max-w-sm truncate text-xs text-muted-foreground">{a.summary || `${a.targetType} ${a.targetId}`}</p></TableCell>
                    <TableCell><Badge>待批准</Badge></TableCell>
                    <TableCell className="hidden md:table-cell">-</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{timeFormat.format(new Date(a.createdAt))}</TableCell>
                    <TableCell>{a.requestedByJob && <Link to={`/tasks/${a.requestedByJob}`} aria-label="查看关联任务"><ArrowUpRight className="size-4 text-muted-foreground" /></Link>}</TableCell>
                  </TableRow>
                ))}
                {group.jobs.map((job) => {
                  const target = job.targetId ? targets[job.targetId] : undefined
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <Link className="font-medium hover:text-primary" to={`/tasks/${job.id}`}>{target ? `${target.title}` : job.jobType}</Link>
                        <p className="mt-1 max-w-sm truncate text-xs text-muted-foreground">
                          {job.jobType === "content_draft" ? "出稿" : job.jobType}
                          {target && ` · ${target.platform === "master" ? "母稿" : platformLabels[target.platform as keyof typeof platformLabels] ?? target.platform}`}
                          {job.error && ` · ${job.error}`}
                        </p>
                      </TableCell>
                      <TableCell><Badge variant={JOB_STATUS_VARIANT[job.status]}>{job.cancelRequestedAt && job.status === "running" ? "取消中" : JOB_STATUS_LABEL[job.status]}</Badge></TableCell>
                      <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">{job.rounds}/{job.maxRounds}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{timeFormat.format(new Date(job.updatedAt))}</TableCell>
                      <TableCell><Link to={`/tasks/${job.id}`} aria-label="查看任务"><ArrowUpRight className="size-4 text-muted-foreground" /></Link></TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
