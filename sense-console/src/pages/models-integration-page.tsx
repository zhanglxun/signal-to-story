import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BotIcon,
  CheckCircle2Icon,
  CopyIcon,
  MessageSquareTextIcon,
  PlayIcon,
  SaveIcon,
  SparklesIcon,
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
import type { CloudModelProviderKey } from "@/contracts/agent-harness"
import { CLOUD_MODEL_PROVIDERS } from "@/config/agent-runtimes"
import {
  formatEnvLocalSnippet,
  getLocalBridgeStatus,
  saveProviderEnvConfig,
  sendBridgeChat,
} from "@/services/local-bridge-service"

export function ModelsIntegrationPage() {
  const queryClient = useQueryClient()
  const bridgeQuery = useQuery({
    queryKey: ["local-bridge-status"],
    queryFn: getLocalBridgeStatus,
  })

  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({})
  const [draftUrls, setDraftUrls] = useState<Record<string, string>>({})
  const [draftModels, setDraftModels] = useState<Record<string, string>>({})
  const [testResults, setTestResults] = useState<
    Record<
      string,
      { loading: boolean; ok?: boolean; text?: string; durationMs?: number }
    >
  >({})

  const saveMutation = useMutation({
    mutationFn: saveProviderEnvConfig,
    onSuccess: async (_res, vars) => {
      setDraftKeys((prev) => ({ ...prev, [vars.providerKey]: "" }))
      await queryClient.invalidateQueries({ queryKey: ["local-bridge-status"] })
      toast.success(
        `已将 ${vars.providerKey} 配置写入本地 sense-console/.env.local`
      )
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  async function handlePingTest(
    providerKey: CloudModelProviderKey,
    baseUrl: string,
    model: string
  ) {
    setTestResults((prev) => ({
      ...prev,
      [providerKey]: { loading: true },
    }))
    try {
      const res = await sendBridgeChat({
        driverMode: "cloud_api",
        providerKey,
        baseUrl,
        model,
        prompt: "请回复：星火工厂模型连通正常（不超过20字）。",
      })
      if (res.ok) {
        setTestResults((prev) => ({
          ...prev,
          [providerKey]: {
            loading: false,
            ok: true,
            text: res.reply,
            durationMs: res.durationMs,
          },
        }))
        toast.success(`${providerKey} (${model}) 连通测试成功`)
      } else {
        setTestResults((prev) => ({
          ...prev,
          [providerKey]: {
            loading: false,
            ok: false,
            text: res.error || "调用未通过",
          },
        }))
        toast.error(res.error || "连通测试失败")
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "网络请求异常"
      setTestResults((prev) => ({
        ...prev,
        [providerKey]: {
          loading: false,
          ok: false,
          text: message,
        },
      }))
    }
  }

  function handleCopyEnvSnippet(
    providerKey: CloudModelProviderKey,
    baseUrl: string,
    model: string
  ) {
    const snippet = formatEnvLocalSnippet({
      providerKey,
      apiKey: draftKeys[providerKey] || "",
      baseUrl,
      model,
      setAsDefault: true,
    })
    void navigator.clipboard?.writeText(snippet)
    toast.success("已复制 .env.local 环境变量片段到剪贴板")
  }

  const statusMap = new Map(
    (bridgeQuery.data?.providers ?? []).map((p) => [p.key, p])
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Model Providers"
        title="国内大模型接入"
        description="统一配置通义千问 (Qwen)、Kimi、DeepSeek、智谱 GLM、MiniMax 等模型 API Key，直接保存到本地 .env.local 并支持一键连通性测试。"
        actions={
          <Button nativeButton={false} render={<Link to="/chat" />}>
            <MessageSquareTextIcon />
            打开智能对话台验证
          </Button>
        }
      />

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <SparklesIcon className="size-5 text-primary" />
              <CardTitle>本地环境变量文件 (.env.local) 桥接状态</CardTitle>
            </div>
            <Badge
              variant={bridgeQuery.data?.bridgeOnline ? "default" : "outline"}
            >
              {bridgeQuery.data?.bridgeOnline
                ? "本地桥接已就绪 · 支持直写 .env.local"
                : "静态/离线预览模式 · 支持复制 .env.local"}
            </Badge>
          </div>
          <CardDescription>
            密钥仅保存在服务端或本地 <code className="font-mono">sense-console/.env.local</code>{" "}
            中（已被 Git 忽略，绝不打入前端公开静态包）。设为默认的模型会同步写入{" "}
            <code className="font-mono">CONTENT_AI_*</code> 供全链路生成与审查使用。
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {CLOUD_MODEL_PROVIDERS.map((provider) => {
          const live = statusMap.get(provider.key)
          const currentUrl =
            draftUrls[provider.key] ?? live?.baseUrl ?? provider.defaultBaseUrl
          const currentModel =
            draftModels[provider.key] ??
            live?.model ??
            provider.recommendedModels[0]
          const apiKeyInput = draftKeys[provider.key] ?? ""
          const testResult = testResults[provider.key]

          return (
            <Card key={provider.key}>
              <CardHeader className="border-b">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BotIcon className="size-5 text-primary" />
                    <CardTitle>{provider.name}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    {live?.isDefault && (
                      <Badge variant="default">当前默认驱动</Badge>
                    )}
                    <Badge variant={live?.configured ? "default" : "outline"}>
                      {live?.configured
                        ? `已配置 (${live.maskedKey})`
                        : "未配置 Key"}
                    </Badge>
                  </div>
                </div>
                <CardDescription>
                  {provider.vendor} · {provider.notes}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 pt-5 text-sm">
                <label className="block space-y-1.5">
                  <span className="font-medium">
                    API Key{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      (留空保存则保留已有密钥)
                    </span>
                  </span>
                  <Input
                    type="password"
                    placeholder={
                      live?.configured
                        ? `已保存 ${live.maskedKey}，输入新 Key 可覆盖`
                        : `输入 ${provider.name} API Key (如 sk-...)`
                    }
                    value={apiKeyInput}
                    onChange={(e) =>
                      setDraftKeys((prev) => ({
                        ...prev,
                        [provider.key]: e.target.value,
                      }))
                    }
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="font-medium">默认模型名称</span>
                    <Input
                      value={currentModel}
                      onChange={(e) =>
                        setDraftModels((prev) => ({
                          ...prev,
                          [provider.key]: e.target.value,
                        }))
                      }
                    />
                    <div className="flex flex-wrap gap-1 pt-1">
                      {provider.recommendedModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() =>
                            setDraftModels((prev) => ({
                              ...prev,
                              [provider.key]: m,
                            }))
                          }
                          className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </label>

                  <label className="block space-y-1.5">
                    <span className="font-medium">API Base URL</span>
                    <Input
                      value={currentUrl}
                      onChange={(e) =>
                        setDraftUrls((prev) => ({
                          ...prev,
                          [provider.key]: e.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button
                    disabled={saveMutation.isPending}
                    onClick={() =>
                      saveMutation.mutate({
                        providerKey: provider.key,
                        apiKey: apiKeyInput,
                        baseUrl: currentUrl,
                        model: currentModel,
                        setAsDefault: true,
                      })
                    }
                  >
                    <SaveIcon />
                    保存到 .env.local 并设为默认
                  </Button>
                  <Button
                    variant="outline"
                    disabled={saveMutation.isPending}
                    onClick={() =>
                      saveMutation.mutate({
                        providerKey: provider.key,
                        apiKey: apiKeyInput,
                        baseUrl: currentUrl,
                        model: currentModel,
                        setAsDefault: false,
                      })
                    }
                  >
                    仅保存配置
                  </Button>
                  <Button
                    variant="outline"
                    disabled={Boolean(testResult?.loading)}
                    onClick={() =>
                      void handlePingTest(provider.key, currentUrl, currentModel)
                    }
                  >
                    <PlayIcon />
                    {testResult?.loading ? "测试中…" : "连通测试"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      handleCopyEnvSnippet(
                        provider.key,
                        currentUrl,
                        currentModel
                      )
                    }
                  >
                    <CopyIcon />
                    复制环境变量
                  </Button>
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
                        {testResult.ok ? "模型响应正常" : "连通失败"}
                      </span>
                      {testResult.durationMs !== undefined && (
                        <span>耗时 {testResult.durationMs} ms</span>
                      )}
                    </div>
                    <p className="mt-1 break-words whitespace-pre-wrap">
                      {testResult.text}
                    </p>
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
