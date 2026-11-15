import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2Icon,
  CopyIcon,
  MessageSquareTextIcon,
  PlayIcon,
  RefreshCwIcon,
  TerminalSquareIcon,
} from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { LocalAgentCliKey } from "@/contracts/agent-harness"
import { LOCAL_AGENT_CLI_DRIVERS } from "@/services/agent-harness-service"
import {
  CLI_INSTALL_GUIDES,
  getLocalBridgeStatus,
  sendBridgeChat,
} from "@/services/local-bridge-service"

export function CliAgentsPage() {
  const queryClient = useQueryClient()
  const bridgeQuery = useQuery({
    queryKey: ["local-bridge-status"],
    queryFn: getLocalBridgeStatus,
  })

  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [testResults, setTestResults] = useState<
    Record<
      string,
      { loading: boolean; ok?: boolean; text?: string; durationMs?: number }
    >
  >({})

  async function handleRefreshScan() {
    await queryClient.invalidateQueries({ queryKey: ["local-bridge-status"] })
    toast.success("已重新扫描本机 Agent CLI 安装状态")
  }

  function copyCommand(cmd: string) {
    void navigator.clipboard?.writeText(cmd)
    toast.success(`已复制命令: ${cmd}`)
  }

  async function handleTestCli(cliKey: LocalAgentCliKey) {
    const promptText =
      (prompts[cliKey] ?? "").trim() ||
      "请用一句话确认星火工厂本地 Agent CLI 调用正常。"

    setTestResults((prev) => ({
      ...prev,
      [cliKey]: { loading: true },
    }))

    try {
      const res = await sendBridgeChat({
        driverMode: "local_cli",
        cliKey,
        prompt: promptText,
      })
      if (res.ok) {
        setTestResults((prev) => ({
          ...prev,
          [cliKey]: {
            loading: false,
            ok: true,
            text: res.reply,
            durationMs: res.durationMs,
          },
        }))
        toast.success(`${cliKey} 调用测试完成`)
      } else {
        setTestResults((prev) => ({
          ...prev,
          [cliKey]: {
            loading: false,
            ok: false,
            text: res.error || "调用失败",
          },
        }))
        toast.error(res.error || "CLI 调用失败")
      }
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [cliKey]: {
          loading: false,
          ok: false,
          text: err instanceof Error ? err.message : "调用异常",
        },
      }))
    }
  }

  const cliStatusMap = new Map(
    (bridgeQuery.data?.cliDrivers ?? []).map((item) => [item.key, item])
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Local Agent CLI"
        title="本地 CLI 接入"
        description="检测、安装并验证本机已订阅的 Codex CLI、Antigravity (agy) CLI、Pi 与 OpenCode。无需额外部署即可将本地 Agent 能力接入星火工厂。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={bridgeQuery.isFetching}
              onClick={() => void handleRefreshScan()}
            >
              <RefreshCwIcon />
              重新扫描本机 CLI
            </Button>
            <Button nativeButton={false} render={<Link to="/chat" />}>
              <MessageSquareTextIcon />
              打开智能对话台测试
            </Button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {LOCAL_AGENT_CLI_DRIVERS.map((driver) => {
          const live = cliStatusMap.get(driver.key)
          const guide = CLI_INSTALL_GUIDES[driver.key]
          const installed = Boolean(live?.installed)
          const testResult = testResults[driver.key]
          const promptValue =
            prompts[driver.key] ??
            "请用一句话确认星火工厂本地 Agent CLI 调用正常。"

          return (
            <Card key={driver.key}>
              <CardHeader className="border-b">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <TerminalSquareIcon className="size-5 text-primary" />
                    <CardTitle>{driver.name}</CardTitle>
                  </div>
                  <Badge variant={installed ? "default" : "outline"}>
                    {installed
                      ? `已安装 (${live?.version ?? driver.binary})`
                      : "未检测到安装"}
                  </Badge>
                </div>
                <CardDescription>
                  命令标识: <code className="font-mono">{driver.binary}</code> ·{" "}
                  {driver.notes}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 pt-5 text-sm">
                {installed && live?.binaryPath && (
                  <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                    <div className="font-medium text-foreground">
                      已识别本机可执行路径：
                    </div>
                    <code className="mt-1 block break-all text-muted-foreground">
                      {live.binaryPath}
                    </code>
                  </div>
                )}

                <div className="space-y-2 rounded-lg border p-3.5 text-xs">
                  <div className="font-semibold text-foreground">
                    {installed
                      ? "订阅登录与命令参考："
                      : "未检测到该 CLI，按以下 3 步快速安装与授权："}
                  </div>
                  <p className="text-muted-foreground">{guide.docsHint}</p>

                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between gap-2 rounded bg-muted px-2.5 py-1.5 font-mono">
                      <span className="truncate">1. {guide.installCommand}</span>
                      <button
                        type="button"
                        onClick={() => copyCommand(guide.installCommand)}
                        className="shrink-0 text-primary hover:underline"
                      >
                        <CopyIcon className="size-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded bg-muted px-2.5 py-1.5 font-mono">
                      <span className="truncate">2. {guide.authCommand}</span>
                      <button
                        type="button"
                        onClick={() => copyCommand(guide.authCommand)}
                        className="shrink-0 text-primary hover:underline"
                      >
                        <CopyIcon className="size-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded bg-muted px-2.5 py-1.5 font-mono">
                      <span className="truncate">3. {guide.verifyCommand}</span>
                      <button
                        type="button"
                        onClick={() => copyCommand(guide.verifyCommand)}
                        className="shrink-0 text-primary hover:underline"
                      >
                        <CopyIcon className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <label className="block space-y-1.5">
                    <span className="font-medium">快速调用测试指令</span>
                    <div className="flex gap-2">
                      <Input
                        value={promptValue}
                        onChange={(e) =>
                          setPrompts((prev) => ({
                            ...prev,
                            [driver.key]: e.target.value,
                          }))
                        }
                        placeholder="输入测试提示词…"
                      />
                      <Button
                        disabled={Boolean(testResult?.loading)}
                        onClick={() => void handleTestCli(driver.key)}
                      >
                        <PlayIcon />
                        {testResult?.loading ? "调用中…" : "测试调用"}
                      </Button>
                    </div>
                  </label>
                </div>

                {testResult && !testResult.loading && (
                  <div
                    className={`rounded-lg border p-3 text-xs ${
                      testResult.ok
                        ? "border-primary/40 bg-primary/5"
                        : "border-destructive/40 bg-destructive/5 text-destructive"
                    }`}
                  >
                    <div className="flex items-center justify-between font-medium">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2Icon className="size-4" />
                        {testResult.ok ? "CLI 调用成功" : "CLI 调用未通过"}
                      </span>
                      {testResult.durationMs !== undefined && (
                        <span>耗时 {testResult.durationMs} ms</span>
                      )}
                    </div>
                    <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs">
                      {testResult.text}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
