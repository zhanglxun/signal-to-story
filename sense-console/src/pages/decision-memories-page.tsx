import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PencilIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { DecisionMemoryDialog } from "@/components/decision-memory/decision-memory-dialog"
import { ContentState } from "@/components/content/content-common"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { NativeSelect } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { DecisionMemoryKind } from "@/contracts/agent-harness"
import { decisionMemoryKindLabels, decisionMemoryKinds, decisionMemorySourceLabels, memoryPlatformKeys, memoryPlatformLabels } from "@/contracts/decision-memory"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { listDecisionMemories, memoryStatus, setDecisionMemoryActive, type MemoryStatusFilter } from "@/services/decision-memory-service"

const statusLabels = { active: "生效中", inactive: "已停用", expired: "已过期" } as const

export function DecisionMemoriesPage() {
  const queryClient = useQueryClient()
  const workspace = useQuery({ queryKey: ["content-workspace"], queryFn: getContentWorkspace })
  const org = workspace.data?.organization?.id
  const canManage = Boolean(workspace.data?.canManage)
  const [kind, setKind] = useState<"all" | DecisionMemoryKind>("all")
  const [status, setStatus] = useState<MemoryStatusFilter>("all")
  const [scope, setScope] = useState("all")

  const memories = useQuery({
    queryKey: ["decision-memories", org, kind, status, scope],
    enabled: Boolean(org),
    queryFn: async () => {
      const rows = await listDecisionMemories(org!, {
        kind: kind === "all" ? undefined : kind,
        status,
        scope: scope === "all" || scope === "global" ? undefined : { platform: scope },
      })
      return scope === "global" ? rows.filter((m) => !m.platform) : rows
    },
  })

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setDecisionMemoryActive(id, active),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["decision-memories"] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "操作失败"),
  })

  if (workspace.isLoading || workspace.error || !org) return <ContentState loading={workspace.isLoading} error={workspace.error} hasOrg={Boolean(org)} />
  const rows = memories.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="决定记忆"
        description="审核退回、复盘或手动记下的长期创作偏好。启用且未过期的记忆会在每次 Agent 出稿时注入系统指令区（有条数上限）。Agent 只读，不能修改。"
        actions={canManage ? <DecisionMemoryDialog organizationId={org} trigger={<Button><PlusIcon />新增记忆</Button>} /> : undefined}
      />
      {!canManage && <p className="text-sm text-muted-foreground">当前为只读视图。管理决定记忆需要 content.manage 权限。</p>}
      <div className="flex flex-wrap gap-3">
        <NativeSelect aria-label="类型" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">全部类型</option>
          {decisionMemoryKinds.map((k) => <option key={k} value={k}>{decisionMemoryKindLabels[k]}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="状态" value={status} onChange={(e) => setStatus(e.target.value as MemoryStatusFilter)}>
          <option value="all">全部状态</option>
          <option value="active">生效中</option>
          <option value="inactive">已停用</option>
          <option value="expired">已过期</option>
        </NativeSelect>
        <NativeSelect aria-label="作用域" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">全部作用域</option>
          <option value="global">仅全局</option>
          {memoryPlatformKeys.map((p) => <option key={p} value={p}>适用于{memoryPlatformLabels[p]}（含全局）</option>)}
        </NativeSelect>
      </div>
      <Card>
        <CardContent className="p-0">
          {memories.isLoading ? <p role="status" className="p-6 text-sm">正在读取…</p> : memories.error ? <p className="p-6 text-sm text-destructive">{memories.error.message}</p> : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">暂无记录。在审核退回或复盘时勾选「记入长期创作偏好」，或点击右上角手动新增。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>类型</TableHead><TableHead>摘要</TableHead><TableHead>人工原话</TableHead><TableHead>作用域</TableHead>
                  <TableHead>来源</TableHead><TableHead>状态</TableHead><TableHead>过期时间</TableHead>{canManage && <TableHead className="text-right">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => {
                  const st = memoryStatus(m)
                  return (
                    <TableRow key={m.id}>
                      <TableCell><Badge variant="outline">{decisionMemoryKindLabels[m.kind]}</Badge></TableCell>
                      <TableCell className="max-w-xs whitespace-normal">{m.summary}</TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-muted-foreground">{m.humanQuote || "—"}</TableCell>
                      <TableCell>{m.platform ? memoryPlatformLabels[m.platform] ?? m.platform : "全局"}</TableCell>
                      <TableCell>{decisionMemorySourceLabels[m.source]}</TableCell>
                      <TableCell><Badge variant={st === "active" ? "secondary" : "outline"}>{statusLabels[st]}</Badge></TableCell>
                      <TableCell>{m.expiresAt ? new Date(m.expiresAt).toLocaleDateString() : "长期"}</TableCell>
                      {canManage && (
                        <TableCell className="space-x-1 text-right whitespace-nowrap">
                          <DecisionMemoryDialog organizationId={org} memory={m} trigger={<Button variant="ghost" size="icon-sm" aria-label="编辑记忆"><PencilIcon /></Button>} />
                          <Button variant="outline" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: m.id, active: !m.active })}>{m.active ? "停用" : "启用"}</Button>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
