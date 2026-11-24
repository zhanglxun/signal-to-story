import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BookOpenCheckIcon, BotIcon, CloudCogIcon, LockKeyholeIcon, ServerCogIcon, TerminalSquareIcon } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { storageProviderDefinitions } from "@/config/storage-providers"
import { getSupabaseEndpointHostname, isSupabaseConfigured } from "@/lib/supabase"
import {
  CLOUD_MODEL_PROVIDERS,
  DEFAULT_HARNESS_LOOP_CONFIG,
  LOCAL_AGENT_CLI_DRIVERS,
} from "@/config/agent-runtimes"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { BUILTIN_KNOWLEDGE_BASE_ENTRIES } from "@/services/knowledge-base-service"
import { getStorageProviderConfigs, setDefaultStorageProvider } from "@/services/storage-provider-service"

export function SettingsPage() {
  const queryClient = useQueryClient(), workspace = useQuery({ queryKey: ["content-workspace"], queryFn: getContentWorkspace }), organizationId = workspace.data?.organization?.id
  const configs = useQuery({ queryKey: ["storage-provider-configs", organizationId], queryFn: () => getStorageProviderConfigs(organizationId!), enabled: Boolean(organizationId) })
  const changeDefault = useMutation({ mutationFn: (provider: typeof storageProviderDefinitions[number]["key"]) => setDefaultStorageProvider(organizationId!, provider), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["storage-provider-configs"] }); toast.success("默认存储已切换；新上传文件将使用该提供商。") }, onError: (error) => toast.error(error instanceof Error ? error.message : "切换失败。") })
  const active = configs.data?.find((config) => config.isDefault), endpointHostname = getSupabaseEndpointHostname()
  return <div className="space-y-6"><PageHeader eyebrow="Workspace" title="系统设置" description="管理外部服务连接、国内大模型与本地 Agent CLI 驱动、内建知识库及素材对象存储路由。密钥仅保存在服务端。" />
    <div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader className="border-b"><div className="flex justify-between"><CardTitle>Supabase</CardTitle><Badge variant={isSupabaseConfigured ? "default" : "outline"}>{isSupabaseConfigured ? "已连接" : "未配置"}</Badge></div><CardDescription>认证、业务数据、关系与审计</CardDescription></CardHeader><CardContent className="space-y-3 pt-5 text-sm"><Line label="项目端点" value={endpointHostname ?? "未配置"} /><Line label="浏览器密钥" value={isSupabaseConfigured ? "Publishable Key 已配置" : "未配置"} /></CardContent></Card><Card><CardHeader className="border-b"><div className="flex justify-between"><CardTitle>当前默认资产存储</CardTitle><Badge variant={active?.status === "ready" ? "default" : "outline"}>{active?.status === "ready" ? "已启用" : "加载中"}</Badge></div><CardDescription>切换后只影响新上传的对象</CardDescription></CardHeader><CardContent className="pt-5"><div className="flex items-center gap-3"><CloudCogIcon className="size-7 text-primary" /><div><p className="font-medium">{storageProviderDefinitions.find((item) => item.key === active?.provider)?.name ?? "读取中…"}</p><p className="mt-1 text-sm text-muted-foreground">{active ? `${active.bucket}/${active.objectPrefix}` : ""}</p></div></div></CardContent></Card></div>
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><BotIcon className="size-5 text-primary" /><CardTitle>云端大模型 API 驱动池</CardTitle></div>
            <Badge variant="default">OpenAI 兼容直连</Badge>
          </div>
          <CardDescription>原生支持国内主流大模型厂家 API 直连，用于母稿、分镜拆解与只读评估</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {CLOUD_MODEL_PROVIDERS.map((provider) => (
            <div key={provider.key} className="px-6 py-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{provider.name}</span>
                <Badge variant="outline">{provider.recommendedModels[0]}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{provider.notes}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><TerminalSquareIcon className="size-5 text-primary" /><CardTitle>本地 / 容器 Agent CLI 驱动桥接</CardTitle></div>
            <Badge variant="outline">Headless JSON</Badge>
          </div>
          <CardDescription>支持通过受控子进程或本地算力节点调用外部 Agent CLI</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {LOCAL_AGENT_CLI_DRIVERS.map((driver) => (
            <div key={driver.key} className="px-6 py-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{driver.name}</span>
                <Badge variant="outline">{driver.binary} {driver.headlessArgsTemplate.slice(0, 2).join(" ")}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{driver.notes}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><BookOpenCheckIcon className="size-5 text-primary" /><CardTitle>Agent Harness 自循环与内建知识库 (去 Obsidian 化)</CardTitle></div>
          <Badge variant="default">已启用护栏</Badge>
        </div>
        <CardDescription>
          生成↔只读评估最多 {DEFAULT_HARNESS_LOOP_CONFIG.maxEvaluationRounds} 轮 · 最大跳数熔断 {DEFAULT_HARNESS_LOOP_CONFIG.maxAgentHops} 跳 · 外部信源强制沙箱隔离 · 已挂载 {BUILTIN_KNOWLEDGE_BASE_ENTRIES.length} 份项目核心 SOP 知识库
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-5 md:grid-cols-3">
        {BUILTIN_KNOWLEDGE_BASE_ENTRIES.map((entry) => (
          <div key={entry.slug} className="rounded-lg border p-3.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{entry.title}</span>
              <Badge variant="outline">{entry.category}</Badge>
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{entry.content}</p>
          </div>
        ))}
      </CardContent>
    </Card>
    <Card><CardHeader className="border-b"><div className="flex items-center gap-2"><ServerCogIcon className="size-5" /><CardTitle>对象存储提供商</CardTitle></div><CardDescription>选择的提供商会成为新上传对象的写入目标；旧对象仍按其原位置保留。</CardDescription></CardHeader><CardContent className="divide-y p-0">{storageProviderDefinitions.map((provider) => { const config = configs.data?.find((item) => item.provider === provider.key), defaulted = config?.isDefault; return <div key={provider.key} className="grid gap-4 px-6 py-5 md:grid-cols-[1fr_auto]"><div><div className="flex items-center gap-2"><p className="font-medium">{provider.name}</p><Badge variant={defaulted ? "default" : "outline"}>{defaulted ? "当前默认" : config?.status === "ready" ? "已验证" : "待配置"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{config ? `${config.bucket}/${config.objectPrefix}` : provider.requiredConfiguration.join(" · ")}</p><p className="mt-1 text-xs text-muted-foreground">{provider.notes}</p></div>{workspace.data?.canManage && <Button variant={defaulted ? "outline" : "default"} disabled={defaulted || config?.status !== "ready" || changeDefault.isPending} onClick={() => changeDefault.mutate(provider.key)}>{defaulted ? "正在使用" : "设为默认"}</Button>}</div> })}</CardContent></Card>
    <Card><CardHeader className="border-b"><div className="flex items-center gap-2"><LockKeyholeIcon className="size-5" /><CardTitle>安全路由</CardTitle></div></CardHeader><CardContent className="pt-5 text-sm leading-6 text-muted-foreground">七牛上传通过已部署的 Edge Function 签发 5 分钟有效、限定单个对象键的 UploadToken。AK/SK 不会返回浏览器；后续接入 OSS、COS 或 R2 也复用同一个对象存储路由。</CardContent></Card>
  </div>
}
function Line({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div> }
