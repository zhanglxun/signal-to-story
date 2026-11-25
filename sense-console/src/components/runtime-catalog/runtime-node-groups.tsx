import type { ReactNode } from "react"
import { ServerIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { RuntimeEntry, RuntimeNodeCatalog } from "@/modules/chat/types"

type NodeState = NonNullable<RuntimeNodeCatalog["state"]>

const nodeStateLabel: Record<NodeState, string> = {
  online: "在线",
  offline: "离线",
  never: "未连接过",
  revoked: "已吊销",
}
const nodeStateVariant: Record<NodeState, "default" | "secondary" | "outline" | "destructive"> = {
  online: "default",
  offline: "secondary",
  never: "outline",
  revoked: "destructive",
}
const runtimeStatusLabel: Record<RuntimeEntry["status"], string> = {
  ready: "可用",
  unavailable: "不可用",
  unverified: "未验证",
}
const runtimeStatusVariant: Record<RuntimeEntry["status"], "default" | "secondary" | "outline"> = {
  ready: "default",
  unavailable: "secondary",
  unverified: "outline",
}

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—"
}

function formatTokens(value: number | undefined) {
  if (!value) return "—"
  return value >= 1024 ? `${Math.round(value / 1024)}K` : String(value)
}

function resolveState(node: RuntimeNodeCatalog): NodeState {
  return node.state ?? (node.online ? "online" : "offline")
}

export interface RuntimeNodeGroupsProps {
  kind: "api" | "acp"
  /** Already filtered to `kind` (see filterCatalogByKind). */
  nodes: RuntimeNodeCatalog[]
  isLoading?: boolean
  error?: unknown
  emptyTitle: string
  emptyGuidance: ReactNode
}

/**
 * Read-only view of runner_nodes.capabilities.runtimes grouped by node (docs/modules/chat.md 3.4).
 * Keys never reach the browser: the catalog only carries redacted metadata.
 */
export function RuntimeNodeGroups({ kind, nodes, isLoading, error, emptyTitle, emptyGuidance }: RuntimeNodeGroupsProps) {
  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        节点能力目录读取失败：{error instanceof Error ? error.message : "请刷新重试"}
      </p>
    )
  }
  if (nodes.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ServerIcon />
          </EmptyMedia>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>还没有节点上报这一类运行时。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-2xl text-left text-sm text-muted-foreground">{emptyGuidance}</EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="space-y-4">
      {nodes.map((node) => {
        const state = resolveState(node)
        const inactive = state !== "online"
        return (
          <Card
            key={node.nodeId}
            data-testid="runtime-node-group"
            data-node-state={state}
            aria-disabled={inactive || undefined}
            className={cn(inactive && "opacity-60")}
          >
            <CardHeader className="border-b">
              <div className="flex flex-wrap items-center gap-2">
                <ServerIcon className="size-4 text-muted-foreground" />
                <CardTitle>{node.nodeName}</CardTitle>
                <Badge variant={nodeStateVariant[state]}>{nodeStateLabel[state]}</Badge>
              </div>
              <CardDescription>
                最近上报 {formatTime(node.capabilitiesUpdatedAt ?? node.lastSeenAt)} · 最近活动 {formatTime(node.lastSeenAt)}
                {node.httpEndpointHint ? ` · ${node.httpEndpointHint}` : ""}
                {inactive ? " · 节点不在线，以下运行时暂不可选" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>{kind === "api" ? "厂商" : "CLI"}</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>上下文</TableHead>
                    {kind === "api" ? <TableHead>计价</TableHead> : <TableHead>会话</TableHead>}
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {node.runtimes.map((runtime) => (
                    <TableRow key={runtime.id}>
                      <TableCell>
                        <div className="font-medium">{runtime.label}</div>
                        <code className="text-xs text-muted-foreground">{runtime.id}</code>
                      </TableCell>
                      <TableCell>{runtime.provider || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{runtime.model || "—"}</TableCell>
                      <TableCell>{formatTokens(runtime.contextWindow)}</TableCell>
                      {kind === "api" ? (
                        <TableCell>{runtime.priced ? "已配单价" : "未计价"}</TableCell>
                      ) : (
                        <TableCell>{runtime.capabilities.sessions ? "支持" : "—"}</TableCell>
                      )}
                      <TableCell>
                        <Badge variant={runtimeStatusVariant[runtime.status]}>{runtimeStatusLabel[runtime.status]}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
