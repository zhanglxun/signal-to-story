import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CopyIcon, ServerIcon, ShieldOffIcon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { createRunnerNode, listRunnerNodes, nodeState, revokeRunnerNode, type NodeState } from "@/services/runner-node-service"

const stateLabel: Record<NodeState, string> = { online: "在线", offline: "离线", never: "未连接过", revoked: "已吊销" }
const stateVariant: Record<NodeState, "default" | "secondary" | "outline" | "destructive"> = { online: "default", offline: "secondary", never: "outline", revoked: "destructive" }

/**
 * Execution nodes (DB2c-2): each worker runs on its own revocable token instead of service_role.
 * The token is shown once on creation; the database stores only its hash.
 */
export function RunnerNodesCard({ organizationId, canManage }: { organizationId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null)
  const nodes = useQuery({ queryKey: ["runner-nodes", organizationId], queryFn: () => listRunnerNodes(organizationId), refetchInterval: 30_000 })
  const create = useMutation({
    mutationFn: () => createRunnerNode(organizationId, name),
    onSuccess: async (node) => {
      setCreated({ name: node.name, token: node.token })
      setName("")
      await queryClient.invalidateQueries({ queryKey: ["runner-nodes", organizationId] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "创建失败"),
  })
  const envLines = created ? `SUPABASE_PUBLISHABLE_KEY=<与控制台相同的公开 key>\nSENSE_NODE_TOKEN=${created.token}` : ""

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ServerIcon className="size-4" />执行节点</CardTitle>
        <CardDescription>每台运行 worker 的电脑或容器一个节点令牌。节点只能认领本组织的任务、只能写自己正在执行的任务；吊销后立即失效。worker 不再需要 service_role 密钥。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && (
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate() }}>
            <Input className="max-w-xs" maxLength={80} placeholder="节点名称，如 jarvis-mac" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={!name.trim() || create.isPending}>新建节点</Button>
          </form>
        )}
        {created && (
          <Alert>
            <AlertTitle>「{created.name}」的令牌只显示这一次</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>写进 worker 的环境文件（如 workers/agent/.env.local），不要提交、不要发到聊天里。丢了就吊销后重建。</p>
              <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{envLines}</pre>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(created.token); toast.success("已复制令牌") }}><CopyIcon />复制令牌</Button>
                <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>我已保存</Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {nodes.error && <p role="alert" className="text-sm text-destructive">节点列表读取失败，请刷新重试。</p>}
        {nodes.data?.length === 0 && <p className="text-sm text-muted-foreground">还没有执行节点。没有在线节点时，Agent 任务会一直排队。</p>}
        <ul className="divide-y rounded-md border">
          {nodes.data?.map((node) => {
            const state = nodeState(node)
            return (
              <li key={node.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="font-medium">{node.name}</span>
                <Badge variant={stateVariant[state]}>{stateLabel[state]}</Badge>
                <span className="text-muted-foreground">{node.last_seen_at ? `最近活动 ${new Date(node.last_seen_at).toLocaleString()}` : `创建于 ${new Date(node.created_at).toLocaleString()}`}</span>
                {canManage && state !== "revoked" && (
                  <span className="ml-auto">
                    <ConfirmDeleteDialog
                      trigger={<Button size="sm" variant="ghost"><ShieldOffIcon />吊销</Button>}
                      title={`吊销节点「${node.name}」？`}
                      description="吊销后该令牌立即失效：它不能再认领任务，正在执行的任务写不回来，租约过期后会重新排队给其他节点。不可撤销，需要时新建节点。"
                      mutationFn={() => revokeRunnerNode(node.id)}
                      invalidateKeys={[["runner-nodes", organizationId]]}
                      successMessage="节点已吊销"
                      confirmLabel="确认吊销"
                      pendingLabel="吊销中…"
                    />
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
