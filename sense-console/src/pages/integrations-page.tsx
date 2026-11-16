import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { ImChannelGuide } from "@/components/intake/im-channel-guide"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getContentWorkspace } from "@/services/content-workspace-service"
import {
  createIntakeConnection,
  imWebhookEndpoint,
  intakeEndpoint,
  listIntakeConnections,
  listIntakeReceipts,
  revokeIntakeConnection,
  type IntakeAdapter,
} from "@/services/intake-gateway-service"

export function IntegrationsPage() {
  const queryClient = useQueryClient()
  const workspace = useQuery({
    queryKey: ["content-workspace"],
    queryFn: getContentWorkspace,
  })
  const org = workspace.data?.organization?.id
  const [name, setName] = useState("我的 Dot")
  const [adapter, setAdapter] = useState<IntakeAdapter>("dot")
  const [secret, setSecret] = useState<{
    org: string
    config: string
    webhookUrl?: string | null
  } | null>(null)
  const connections = useQuery({
    queryKey: ["intake-connections", org],
    queryFn: () => listIntakeConnections(org!),
    enabled: Boolean(org && workspace.data?.canManage),
  })
  const receipts = useQuery({
    queryKey: ["intake-receipts", org],
    queryFn: () => listIntakeReceipts(org!),
    enabled: Boolean(org),
    refetchInterval: 10000,
  })
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["intake-connections"] })
  }
  const create = useMutation({
    mutationFn: () => createIntakeConnection(org!, name, adapter),
    onSuccess: async (data) => {
      setSecret({
        org: org!,
        config: data.config,
        webhookUrl: data.webhookUrl,
      })
      await refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => revokeIntakeConnection(id, org!),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  })
  const error = workspace.error ?? connections.error ?? receipts.error
  const config = secret && secret.org === org ? secret.config : null
  function downloadConfig() {
    if (!config) return
    const url = URL.createObjectURL(
      new Blob([config], { type: "application/json" })
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "spark-intake-credentials.json"
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="外部接入"
        eyebrow="Connections"
        description="统一管理飞书机器人、企业微信机器人、Dot 助手、iOS 快捷指令等外部个人助手入口，自动保存信源并形成待评估选题。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button nativeButton={false} variant="outline" render={<Link to="/system/models" />}>
              国内大模型接入
            </Button>
            <Button nativeButton={false} variant="outline" render={<Link to="/system/cli-agents" />}>
              本地 CLI 接入
            </Button>
            <Button nativeButton={false} render={<Link to="/chat" />}>
              智能对话与速记台
            </Button>
          </div>
        }
      />
      {error && (
        <p role="alert" className="text-destructive">
          {error.message}
        </p>
      )}
      {workspace.isLoading && <p>正在读取接入权限…</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">TOP 0 · 网页与 H5 极简速记台</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>零外部资质依赖，直接在后台或手机 H5 打开即可对话、测试模型/CLI 并一键速记收录。</p>
            <div className="flex gap-2 pt-1">
              <Link className="font-medium text-primary underline" to="/chat">
                打开后台对话台
              </Link>
              <Link className="font-medium text-primary underline" to="/h5/chat" target="_blank">
                打开独立 H5 版
              </Link>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">TOP 1 · 飞书自建应用机器人 (推荐)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>个人免费创建企业即可开通，支持长连接收消息与交互式审核卡片回传，复用下方统一收录凭证。</p>
            <p className="font-mono text-foreground">adapter: &quot;generic&quot; (Feishu Bot)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">TOP 2 · 企业微信机器人 / iOS 快捷指令</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>支持企微智能机器人回调或手机系统分享菜单直调下方 HTTPS 收录网关，自动幂等防重。</p>
            <p className="font-mono text-foreground">POST /functions/v1/intake-gateway</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>统一收录入口</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="break-all">{intakeEndpoint()}</p>
          <p>
            POST · 每个连接每小时最多 100 条 ·
            同一消息重复投递不会重复创建选题。
          </p>
          <p>来源原文保留，链接暂不自动抓取。收录成功不代表事实已经核实。</p>
        </CardContent>
      </Card>
      {workspace.data?.canManage && (
        <Card>
          <CardHeader>
            <CardTitle>创建脚本接入凭证（需执行设备在线）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-2">
              <span>连接名称</span>
              <Input
                value={name}
                maxLength={64}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block space-y-2">
              <span>调用方</span>
              <select
                className="ml-3 rounded border bg-background p-2"
                value={adapter}
                onChange={(e) => setAdapter(e.target.value as IntakeAdapter)}
              >
                <option value="dot">Dot</option>
                <option value="feishu">飞书机器人</option>
                <option value="wecom">企业微信机器人</option>
                <option value="generic">其他助手 / 通用接口</option>
              </select>
            </label>
            <p className="text-sm text-muted-foreground">
              凭证只允许向当前组织收录选题，30
              天到期，可随时撤销。每个助手应使用独立凭证。
            </p>
            <Button
              disabled={!name.trim() || create.isPending || Boolean(config)}
              onClick={() => create.mutate()}
            >
              生成凭证
            </Button>
            {config && (
              <div className="space-y-3 rounded border p-4">
                {secret?.webhookUrl ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      IM Webhook 回调地址（填入飞书 / 企业微信开放平台）：
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 overflow-auto rounded bg-muted px-2 py-1 text-xs">
                        {secret.webhookUrl}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void navigator.clipboard?.writeText(
                            secret.webhookUrl!
                          )
                          toast.success("Webhook 地址已复制")
                        }}
                      >
                        复制地址
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p>
                    配置仅本次显示。保存到助手可访问的私密文件中，不要放入聊天、代码仓库或公开网页。
                  </p>
                )}
                <div className="flex gap-2">
                  <Button onClick={downloadConfig}>下载连接配置</Button>
                  <Button variant="outline" onClick={() => setSecret(null)}>
                    已保存，关闭
                  </Button>
                </div>
                <details>
                  <summary>查看配置（包含接入凭证）</summary>
                  <pre className="overflow-auto text-xs">{config}</pre>
                </details>
              </div>
            )}
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>
                配置仅供已经完成安全授权的可信执行环境使用。
              </li>
              <li>
                Dot 云端安全授权尚未完成；下载本机配置不代表手机端已连接。
              </li>
              <li>Dot 必须返回真实收录编号；在下方记录或选题列表核对结果。</li>
            </ol>
          </CardContent>
        </Card>
      )}
      {workspace.data?.canManage && (
        <Card>
          <CardHeader>
            <CardTitle>已配置连接</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {connections.isLoading ? (
              <p>读取中…</p>
            ) : !connections.data?.length ? (
              <p>尚未创建连接。</p>
            ) : (
              connections.data.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-4 rounded border p-3"
                >
                  <div>
                    <p>
                      {c.name} · {c.adapter}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {c.revoked_at
                        ? "已撤销"
                        : Date.parse(c.expires_at) <= connections.dataUpdatedAt
                          ? "已到期"
                          : "有效"}{" "}
                      · 到期 {new Date(c.expires_at).toLocaleString()}
                    </p>
                    {(c.adapter === "feishu" || c.adapter === "wecom") && (
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        Webhook: {imWebhookEndpoint(c.adapter, c.id)}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    disabled={Boolean(c.revoked_at) || revoke.isPending}
                    onClick={() => revoke.mutate(c.id)}
                  >
                    撤销
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
      <ImChannelGuide />
      <Card>
        <CardHeader>
          <CardTitle>最近收录（50 条）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {receipts.isLoading ? (
            <p>读取中…</p>
          ) : !receipts.data?.length ? (
            <p>等待第一条外部消息。成功记录每 10 秒刷新。</p>
          ) : (
            receipts.data.map((r) => (
              <div key={r.id} className="space-y-2 rounded border p-3">
                <Link
                  className="font-medium text-primary underline"
                  to={`/topics/${r.selection_id}`}
                >
                  {r.payload.title}
                </Link>
                <p className="text-sm break-words whitespace-pre-wrap">
                  {r.payload.text}
                </p>
                <p className="text-xs break-all text-muted-foreground">
                  回执 {r.id} · 消息 {r.external_id} ·{" "}
                  {new Date(r.created_at).toLocaleString()} · 待核实 / 待选定
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
