import { MessageSquareTextIcon, RefreshCwIcon } from "lucide-react"
import { Link } from "react-router"

import { PageHeader } from "@/components/page-header"
import { RuntimeNodeGroups } from "@/components/runtime-catalog/runtime-node-groups"
import { useRuntimeCatalog } from "@/components/runtime-catalog/use-runtime-catalog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { CLOUD_MODEL_PROVIDERS } from "@/config/agent-runtimes"
import { filterCatalogByKind } from "@/modules/chat/services/runtime-catalog-service"

/**
 * Cloud API runtimes reported by execution nodes (runner_nodes.capabilities, docs/modules/chat.md 3.4).
 * Read-only: keys live only in the environment of the machine running workers/agent.
 */
export function ModelsIntegrationPage() {
  const { catalog } = useRuntimeCatalog()
  const nodes = filterCatalogByKind(catalog.data ?? [], "api")

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Model Providers"
        title="国内大模型接入"
        description="这里展示各执行节点上报的云端 API 模型（脱敏目录）。模型与 Key 在运行 workers/agent 的机器上用环境变量配置，浏览器里不显示、也不填写任何 Key。"
        actions={
          <>
            <Button variant="outline" disabled={catalog.isFetching} onClick={() => void catalog.refetch()}>
              <RefreshCwIcon />
              刷新
            </Button>
            <Button nativeButton={false} render={<Link to="/chat" />}>
              <MessageSquareTextIcon />
              打开智能对话台验证
            </Button>
          </>
        }
      />

      <Alert>
        <AlertTitle>如何新增或修改模型</AlertTitle>
        <AlertDescription>
          在运行 workers/agent 的机器上设置 <code className="font-mono">SENSE_API_RUNTIMES</code> 与{" "}
          <code className="font-mono">SENSE_RUNTIME_&lt;PROFILE&gt;_*</code>，重启节点后它会自动上报目录（约 2 分钟内无心跳视为离线）。
          详见 <code className="font-mono">workers/agent/README.md</code>「运行时目录」。
        </AlertDescription>
      </Alert>

      <RuntimeNodeGroups
        kind="api"
        nodes={nodes}
        isLoading={catalog.isPending}
        error={catalog.error}
        emptyTitle="还没有节点上报云端模型"
        emptyGuidance={
          <ol className="list-decimal space-y-1 pl-5">
            <li>在「系统管理 → 本地 CLI 接入」的「执行节点」里新建节点，拿到节点令牌。</li>
            <li>
              在运行 workers/agent 的机器上配置 <code className="font-mono">SENSE_API_RUNTIMES</code> 与{" "}
              <code className="font-mono">SENSE_RUNTIME_&lt;PROFILE&gt;_PROVIDER / _MODEL / _API_KEY</code> 等变量。
            </li>
            <li>
              启动节点（<code className="font-mono">npm run worker:agent</code>），刷新本页。变量说明见{" "}
              <code className="font-mono">workers/agent/README.md</code>「运行时目录」。
            </li>
          </ol>
        }
      />

      <p className="text-xs text-muted-foreground">
        <code className="font-mono">_PROVIDER</code> 可选值：
        {CLOUD_MODEL_PROVIDERS.map((p) => `${p.key}（${p.name}）`).join("、")}。
      </p>
    </div>
  )
}
