import { useQuery } from "@tanstack/react-query"
import { ArrowRightIcon } from "lucide-react"
import { Link } from "react-router"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { groupTasks, type TaskGroupKey } from "@/lib/task-center"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { getTaskCenter } from "@/services/task-center-service"

const ATTENTION_KEYS: readonly TaskGroupKey[] = ["review", "decide", "failed"]

/** Dashboard summary: how many agent tasks wait on a human, linking into the matching /tasks group. */
export function TaskAttentionCard() {
  const workspace = useQuery({ queryKey: ["content-workspace"], queryFn: getContentWorkspace })
  const organizationId = workspace.data?.organization?.id
  const query = useQuery({
    queryKey: ["agent-jobs", "task-center", organizationId],
    queryFn: () => getTaskCenter(organizationId!),
    enabled: Boolean(organizationId),
    refetchInterval: 30_000,
  })
  const groups = query.data ? groupTasks(query.data.jobs, query.data.approvals).filter((g) => ATTENTION_KEYS.includes(g.key)) : []
  const total = groups.reduce((n, g) => n + g.jobs.length + g.approvals.length, 0)

  return (
    <Card aria-label="待我处理">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>待我处理</CardTitle>
          <CardDescription>{query.isError ? "任务数据暂时无法加载" : organizationId || workspace.isLoading ? `共 ${total} 项需要你介入` : "账号尚未加入组织"}</CardDescription>
        </div>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/tasks" />}>任务中心<ArrowRightIcon /></Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {ATTENTION_KEYS.map((key) => {
          const g = groups.find((x) => x.key === key)
          const count = g ? g.jobs.length + g.approvals.length : 0
          const label = key === "review" ? "等我审核" : key === "decide" ? "等我拍板" : "异常阻塞"
          return (
            <Button key={key} variant="ghost" className="h-auto w-full justify-between px-3 py-2" nativeButton={false} render={<Link to={`/tasks#group-${key}`} />}>
              <span className="text-sm font-medium">{label}</span>
              <Badge variant={key === "failed" && count > 0 ? "destructive" : "outline"} className="tabular-nums" data-testid={`attention-${key}`}>{count}</Badge>
            </Button>
          )
        })}
      </CardContent>
    </Card>
  )
}
