import { MessageSquareTextIcon, RefreshCwIcon } from "lucide-react"
import { Link } from "react-router"

import { PageHeader } from "@/components/page-header"
import { RunnerNodesCard } from "@/components/runner-nodes/runner-nodes-card"
import { RuntimeNodeGroups } from "@/components/runtime-catalog/runtime-node-groups"
import { useRuntimeCatalog } from "@/components/runtime-catalog/use-runtime-catalog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { filterCatalogByKind } from "@/modules/chat/services/runtime-catalog-service"

/**
 * Local Agent CLIs (ACP runtimes, id `acp:<cliKey>`) reported by execution nodes
 * (runner_nodes.capabilities, docs/modules/chat.md 3.4). The browser never spawns or probes CLIs.
 */
export function CliAgentsPage() {
  const { workspace, organizationId, catalog } = useRuntimeCatalog()
  const nodes = filterCatalogByKind(catalog.data ?? [], "acp")

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Local Agent CLI"
        title="本地 CLI 接入"
        description="这里展示各执行节点上报的本机 Agent CLI（ACP）。CLI 的安装、登录与启用都在运行 workers/agent 的机器上完成，控制台只读展示。"
        actions={
          <>
            <Button variant="outline" disabled={catalog.isFetching} onClick={() => void catalog.refetch()}>
              <RefreshCwIcon />
              刷新
            </Button>
            <Button nativeButton={false} render={<Link to="/chat" />}>
              <MessageSquareTextIcon />
              打开智能对话台测试
            </Button>
          </>
        }
      />

      {organizationId && (
        <RunnerNodesCard organizationId={organizationId} canManage={Boolean(workspace.data?.canManageOrganization)} />
      )}

      <Alert>
        <AlertTitle>如何启用本机 CLI</AlertTitle>
        <AlertDescription>
          在节点所在机器上安装并登录对应 CLI（及其 ACP 适配器），设置{" "}
          <code className="font-mono">SENSE_ACP_CLIS</code>（逗号分隔，如 <code className="font-mono">opencode,codex</code>），
          需要时用 <code className="font-mono">SENSE_ACP_&lt;KEY&gt;_COMMAND</code> / <code className="font-mono">_ARGS</code>{" "}
          覆盖启动命令，然后重启节点。本机 CLI 节点只配合本地启动的控制台使用。
        </AlertDescription>
      </Alert>

      <RuntimeNodeGroups
        kind="acp"
        nodes={nodes}
        isLoading={catalog.isPending}
        error={catalog.error}
        emptyTitle="还没有节点上报本机 CLI"
        emptyGuidance={
          <ol className="list-decimal space-y-1 pl-5">
            <li>在上方「执行节点」新建节点，把令牌写进 worker 机器的环境文件。</li>
            <li>
              在该机器上设置 <code className="font-mono">SENSE_ACP_CLIS</code>，并确认 CLI 已安装、已登录。
            </li>
            <li>
              启动节点（<code className="font-mono">npm run worker:agent</code>），刷新本页。说明见{" "}
              <code className="font-mono">workers/agent/README.md</code>「运行时目录」与 <code className="font-mono">docs/ACP-info.md</code>。
            </li>
          </ol>
        }
      />
    </div>
  )
}
