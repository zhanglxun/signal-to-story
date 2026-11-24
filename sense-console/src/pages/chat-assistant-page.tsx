import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BotIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  InboxIcon,
  SendIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SparklesIcon,
  TerminalSquareIcon,
  Trash2Icon,
} from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"

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
import type {
  CloudModelProviderKey,
  DraftEvaluationReport,
  ExecutionDriverMode,
  LocalAgentCliKey,
} from "@/contracts/agent-harness"
import { CLOUD_MODEL_PROVIDERS, LOCAL_AGENT_CLI_DRIVERS } from "@/config/agent-runtimes"
import {
  getLocalBridgeStatus,
  sendBridgeChat,
} from "@/services/local-bridge-service"

type AssistantWorkMode = "chat_test" | "quick_capture"

interface ChatMessageItem {
  id: string
  role: "user" | "assistant"
  mode: AssistantWorkMode
  engineLabel: string
  content: string
  createdAt: string
  durationMs?: number
  evaluations?: DraftEvaluationReport[]
  sanitizedWarnings?: string[]
  error?: boolean
}

const QUICK_PROMPTS: Array<{
  label: string
  mode: AssistantWorkMode
  text: string
}> = [
  {
    label: "⚡ 连通性自检",
    mode: "chat_test",
    text: "请用一句话介绍你当前运行的模型或 CLI 版本，并确认与星火工厂连接正常。",
  },
  {
    label: "📥 极简速记：收录 AI 趋势线索",
    mode: "quick_capture",
    text: "https://story.susense.cn/demo 看到一篇关于多模态 Agent Harness 自动化的案例，想从个人创作者降本增效的角度切入做一期选题。",
  },
]

let messageSeq = 1

export function ChatAssistantPage({
  standaloneH5 = false,
}: {
  standaloneH5?: boolean
}) {
  const bridgeQuery = useQuery({
    queryKey: ["local-bridge-status"],
    queryFn: getLocalBridgeStatus,
  })

  const [driverMode, setDriverMode] = useState<ExecutionDriverMode>("cloud_api")
  const [providerKey, setProviderKey] = useState<CloudModelProviderKey>("qwen")
  const [cliKey, setCliKey] = useState<LocalAgentCliKey>("codex-cli")
  const [workMode, setWorkMode] = useState<AssistantWorkMode>("chat_test")
  const [inputText, setInputText] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [messages, setMessages] = useState<ChatMessageItem[]>([
    {
      id: "welcome-msg",
      role: "assistant",
      mode: "chat_test",
      engineLabel: "Sense Agent Harness",
      content:
        "你好！这里是 **星火工厂智能对话与速记台**。\n\n你可以在上方自由切换：\n1. **国内大模型 API**（通义千问 Qwen、Kimi、DeepSeek、智谱 GLM、MiniMax）\n2. **本地 Agent CLI**（Codex CLI、Antigravity agy CLI、Pi CLI、OpenCode CLI）\n\n支持 **自由对话测试**、**极简速记收录** 与 **Harness 自循环出稿（自动挂载项目内建知识库 + 只读评估审查）**。",
      createdAt: "刚刚",
    },
  ])

  const activeProviderStatus = bridgeQuery.data?.providers.find(
    (p) => p.key === providerKey
  )
  const activeCliStatus = bridgeQuery.data?.cliDrivers.find(
    (c) => c.key === cliKey
  )

  async function handleSend(customPrompt?: string, customMode?: AssistantWorkMode) {
    const text = (customPrompt ?? inputText).trim()
    const activeMode = customMode ?? workMode
    if (!text || isSending) return

    if (!customPrompt) {
      setInputText("")
    }
    if (customMode) {
      setWorkMode(customMode)
    }

    const currentEngineLabel =
      driverMode === "cloud_api"
        ? `${providerKey} (${activeProviderStatus?.model ?? "default"})`
        : `${cliKey} (${activeCliStatus?.binary ?? "cli"})`

    const nowTime = new Date().toLocaleTimeString()
    const userMsg: ChatMessageItem = {
      id: `user-${++messageSeq}`,
      role: "user",
      mode: activeMode,
      engineLabel: currentEngineLabel,
      content: text,
      createdAt: nowTime,
    }
    setMessages((prev) => [...prev, userMsg])
    setIsSending(true)

    try {
      if (activeMode === "quick_capture") {
        const captureSystemPrompt =
          "你是星火工厂的极简速记解析助手。请从用户输入中提取：1. 候选选题标题；2. 核心链接（如有）；3. 建议切入角度；4. 推荐发布平台（X / 公众号 / 视频号）。以简洁要点输出。"
        const res = await sendBridgeChat({
          driverMode,
          providerKey,
          cliKey,
          systemPrompt: captureSystemPrompt,
          prompt: text,
        })

        if (!res.ok) {
          throw new Error(res.error || "极简速记解析未完成")
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `ai-${++messageSeq}`,
            role: "assistant",
            mode: activeMode,
            engineLabel: res.engine || currentEngineLabel,
            content: `📥 **已解析速记线索卡片**：\n\n${res.reply}`,
            createdAt: new Date().toLocaleTimeString(),
            durationMs: res.durationMs,
          },
        ])
      } else {
        // 标准自由对话与连通测试
        const res = await sendBridgeChat({
          driverMode,
          providerKey,
          cliKey,
          prompt: text,
        })
        if (!res.ok) {
          throw new Error(res.error || "模型或 CLI 调用失败")
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `ai-${++messageSeq}`,
            role: "assistant",
            mode: activeMode,
            engineLabel: res.engine || currentEngineLabel,
            content: res.reply || "",
            createdAt: new Date().toLocaleTimeString(),
            durationMs: res.durationMs,
          },
        ])
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "调用发生未知错误"
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${++messageSeq}`,
          role: "assistant",
          mode: activeMode,
          engineLabel: currentEngineLabel,
          content: `⚠️ **调用未通过**：${errMsg}\n\n提示：如果是国内大模型 API，请先在「系统管理 → 大模型接入」配置 Key 并保存到 \`.env.local\`；如果是本地 CLI，请在「系统管理 → 本地 CLI 接入」确认已安装对应命令。`,
          createdAt: new Date().toLocaleTimeString(),
          error: true,
        },
      ])
      toast.error(errMsg)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div
      className={
        standaloneH5
          ? "mx-auto flex min-h-screen max-w-2xl flex-col bg-background p-3 sm:p-5"
          : "space-y-5"
      }
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="default">
              {standaloneH5 ? "H5 移动速记与对话端" : "Workspace Chat & Test"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              支持云端大模型 API & 本地 Agent CLI 实时切换
            </span>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight">
            星火智能对话与极简速记台
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {standaloneH5 ? (
            <Button nativeButton={false} variant="outline" size="sm" render={<Link to="/chat" />}>
              返回管理后台视图
            </Button>
          ) : (
            <>
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={<Link to="/system/models" />}
              >
                <Settings2Icon />
                配置大模型 Key
              </Button>
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={<Link to="/system/cli-agents" />}
              >
                <TerminalSquareIcon />
                管理本地 CLI
              </Button>
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={<Link to="/h5/chat" target="_blank" />}
              >
                <SmartphoneIcon />
                打开独立 H5 版
                <ExternalLinkIcon className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Control Bar: Driver Switch + Engine Selector + Work Mode */}
      <Card>
        <CardContent className="grid gap-3 pt-4 md:grid-cols-3">
          {/* 1. 驱动方式切换 */}
          <div className="space-y-1.5 text-xs">
            <span className="font-semibold text-muted-foreground">
              1. 选择底层驱动通道
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setDriverMode("cloud_api")}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 font-medium transition ${
                  driverMode === "cloud_api"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:border-primary/50"
                }`}
              >
                <BotIcon className="size-3.5" />
                国内大模型 API
              </button>
              <button
                type="button"
                onClick={() => setDriverMode("local_cli")}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 font-medium transition ${
                  driverMode === "local_cli"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:border-primary/50"
                }`}
              >
                <TerminalSquareIcon className="size-3.5" />
                本地 Agent CLI
              </button>
            </div>
          </div>

          {/* 2. 具体模型或 CLI 选择 */}
          <div className="space-y-1.5 text-xs">
            <span className="font-semibold text-muted-foreground">
              2. {driverMode === "cloud_api" ? "选择大模型厂家" : "选择本机 CLI 工具"}
            </span>
            {driverMode === "cloud_api" ? (
              <select
                aria-label="选择大模型厂家"
                value={providerKey}
                onChange={(e) =>
                  setProviderKey(e.target.value as CloudModelProviderKey)
                }
                className="w-full rounded-lg border bg-background px-3 py-2 text-xs font-medium"
              >
                {CLOUD_MODEL_PROVIDERS.map((p) => {
                  const st = bridgeQuery.data?.providers.find(
                    (item) => item.key === p.key
                  )
                  return (
                    <option key={p.key} value={p.key}>
                      {p.name} ({st?.model ?? p.recommendedModels[0]}){" "}
                      {st?.configured ? "✅ 已配Key" : "⚠️ 待配Key"}
                    </option>
                  )
                })}
              </select>
            ) : (
              <select
                aria-label="选择本机 CLI 工具"
                value={cliKey}
                onChange={(e) => setCliKey(e.target.value as LocalAgentCliKey)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-xs font-medium"
              >
                {LOCAL_AGENT_CLI_DRIVERS.map((d) => {
                  const st = bridgeQuery.data?.cliDrivers.find(
                    (item) => item.key === d.key
                  )
                  return (
                    <option key={d.key} value={d.key}>
                      {d.name} ({d.binary}){" "}
                      {st?.installed ? "✅ 已安装" : "⚠️ 未安装"}
                    </option>
                  )
                })}
              </select>
            )}
          </div>

          {/* 3. 对话与任务模式 */}
          <div className="space-y-1.5 text-xs">
            <span className="font-semibold text-muted-foreground">
              3. 选择工作模式
            </span>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setWorkMode("chat_test")}
                className={`rounded-lg border px-2 py-2 font-medium transition ${
                  workMode === "chat_test"
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:border-primary/40"
                }`}
              >
                💬 对话测试
              </button>
              <button
                type="button"
                onClick={() => setWorkMode("quick_capture")}
                className={`rounded-lg border px-2 py-2 font-medium transition ${
                  workMode === "quick_capture"
                    ? "border-primary bg-primary/10 text-primary"
                    : "hover:border-primary/40"
                }`}
              >
                📥 极简速记
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Chat Box */}
      <Card className="flex flex-1 flex-col">
        <CardHeader className="border-b py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <SparklesIcon className="size-4 text-primary" />
              <CardTitle className="text-sm">
                当前驱动：
                {driverMode === "cloud_api"
                  ? `${providerKey.toUpperCase()} (${activeProviderStatus?.model ?? "qwen3.7-max"})`
                  : `${cliKey} (${activeCliStatus?.binary ?? "cli"})`}
              </CardTitle>
              <Badge
                variant={
                  driverMode === "cloud_api"
                    ? activeProviderStatus?.configured
                      ? "default"
                      : "outline"
                    : activeCliStatus?.installed
                      ? "default"
                      : "outline"
                }
              >
                {driverMode === "cloud_api"
                  ? activeProviderStatus?.configured
                    ? `Key 已就绪 (${activeProviderStatus.maskedKey})`
                    : "未配置 Key"
                  : activeCliStatus?.installed
                    ? `本机已安装 (${activeCliStatus.version})`
                    : "本机未检测到"}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMessages((prev) => prev.slice(0, 1))}
            >
              <Trash2Icon className="size-3.5" />
              清空对话
            </Button>
          </div>
          <CardDescription className="text-xs">
            点击下方快捷指令可立即验证模型连通性、极简速记解析或 Agent Harness 3 轮自循环出稿。
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col space-y-4 pt-4">
          {/* Quick Prompts */}
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q.label}
                type="button"
                disabled={isSending}
                onClick={() => void handleSend(q.text, q.mode)}
                className="rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-foreground disabled:opacity-50"
              >
                {q.label}
              </button>
            ))}
          </div>

          {/* Messages Stream */}
          <div className="max-h-[480px] min-h-[320px] space-y-3 overflow-y-auto rounded-xl border bg-muted/20 p-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${
                  m.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium">
                    {m.role === "user" ? "你" : m.engineLabel}
                  </span>
                  <span>{m.createdAt}</span>
                  {m.durationMs !== undefined && (
                    <span>· {m.durationMs} ms</span>
                  )}
                </div>

                <div
                  className={`max-w-[90%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : m.error
                        ? "border border-destructive/40 bg-destructive/10 text-destructive"
                        : "border bg-card text-card-foreground"
                  }`}
                >
                  <div className="break-words whitespace-pre-wrap">
                    {m.content}
                  </div>

                  {/* Harness Evaluations Trace */}
                  {m.evaluations && m.evaluations.length > 0 && (
                    <div className="mt-3 space-y-2 border-t pt-2.5 text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-primary">
                        <ShieldCheckIcon className="size-4" />
                        只读评估器 (Read-Only Evaluator) 审查轨迹：
                      </div>
                      {m.evaluations.map((ev) => (
                        <div
                          key={ev.round}
                          className="rounded border bg-muted/40 p-2"
                        >
                          <div className="flex items-center justify-between font-medium">
                            <span>第 {ev.round} 轮审查</span>
                            <Badge
                              variant={ev.passedAll ? "default" : "outline"}
                            >
                              得分 {ev.score} ·{" "}
                              {ev.passedAll ? "全部通过" : "打回重改"}
                            </Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-muted-foreground">
                            {ev.criteria.map((c) => (
                              <span
                                key={c.criterionKey}
                                className="inline-flex items-center gap-1"
                              >
                                <CheckCircle2Icon className="size-3 text-primary" />
                                {c.criterionKey}: {c.passed ? "通过" : c.feedback}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isSending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <BotIcon className="size-4 animate-pulse text-primary" />
                正在调用{" "}
                {driverMode === "cloud_api" ? providerKey : cliKey}{" "}
                执行任务，请稍候…
              </div>
            )}
          </div>

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void handleSend()
            }}
            className="flex gap-2"
          >
            <Input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isSending}
              placeholder={
                workMode === "quick_capture"
                  ? "粘贴文章链接或输入一句话灵感，回车即刻解析收录…"
                  : "输入消息测试当前大模型 API 或本地 Agent CLI…"
              }
              className="flex-1"
            />
            <Button type="submit" disabled={!inputText.trim() || isSending}>
              <SendIcon />
              {isSending ? "执行中…" : "发送"}
            </Button>
          </form>

          {!standaloneH5 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <InboxIcon className="size-3.5" />
                提示：所有通过「极简速记」与「外部接入」收录的内容统一进入收件箱。
              </span>
              <div className="flex gap-3">
                <Link to="/intake" className="text-primary hover:underline">
                  查看收件箱 →
                </Link>
                <Link to="/work-items" className="text-primary hover:underline">
                  查看事项 →
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
