import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const projectUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, "") || "https://<project-ref>.supabase.co"

type Channel = {
  key: "feishu" | "wecom"
  title: string
  steps: string[]
  secrets: string[]
}

const CHANNELS: Channel[] = [
  {
    key: "feishu",
    title: "飞书机器人",
    steps: [
      "在飞书开放平台创建企业自建应用并启用机器人能力，授予接收消息与发送消息权限。",
      "在「事件与回调」订阅 im.message.receive_v1，请求地址填下方 Webhook 地址，并记录 Verification Token（建议同时设置 Encrypt Key）。",
      "在服务端 Secret 中配置下列变量后重新部署 im-webhook，再保存请求地址以完成 challenge 握手。",
      "把机器人加入群或与其私聊，发送链接或想法即收进收件箱；以「出稿」开头会建事项并自动出稿到待审核。",
    ],
    secrets: ["FEISHU_VERIFICATION_TOKEN", "FEISHU_ENCRYPT_KEY（可选）", "FEISHU_APP_ID", "FEISHU_APP_SECRET"],
  },
  {
    key: "wecom",
    title: "企业微信机器人",
    steps: [
      "在企业微信管理后台创建智能机器人并选择 API 模式，记录 Token 与 EncodingAESKey。",
      "回调 URL 填下方 Webhook 地址；保存时企业微信会发起 URL 验证（GET），需先配置 Secret 并部署。",
      "待审通知使用群机器人 Webhook：在目标群添加群机器人，把完整 Webhook 地址配置为 worker 的 Secret。",
      "私聊机器人，或在群里 @机器人 后发送链接即收进收件箱。",
    ],
    secrets: ["WECOM_BOT_TOKEN", "WECOM_ENCODING_AES_KEY", "WECOM_NOTIFY_WEBHOOK_URL（worker 使用）"],
  },
]

/** Static setup guide for IM channels. Lists secret NAMES only; values never belong in the browser. */
export function ImChannelGuide() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {CHANNELS.map((c) => (
        <Card key={c.key}>
          <CardHeader>
            <CardTitle>{c.title}</CardTitle>
            <CardDescription>
              在上方创建适配器为{c.title}的连接即可，不需要单独登记；Webhook 路径中的 connection_id 就是这个连接。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="text-muted-foreground mb-1">Webhook 地址模板</div>
              <code className="bg-muted block rounded px-2 py-1 break-all">
                {projectUrl}/functions/v1/im-webhook/{c.key}/&lt;connection_id&gt;
              </code>
            </div>
            <ol className="list-decimal space-y-1 pl-5">
              {c.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <div>
              <div className="text-muted-foreground mb-1">需要设置的服务端 Secret（仅名称）</div>
              <ul className="space-y-1">
                {c.secrets.map((s) => (
                  <li key={s}>
                    <code className="bg-muted rounded px-1.5 py-0.5">{s}</code>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-muted-foreground">
              待审卡片只含「查看并审核」「打开任务」链接；IM 内不能批准或发布，批准需在控制台由已登录成员对具体版本操作。
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
