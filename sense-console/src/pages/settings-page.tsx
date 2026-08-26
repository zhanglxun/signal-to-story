import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { isSupabaseConfigured } from "@/lib/supabase"

export function SettingsPage() { return <div className="space-y-6"><PageHeader eyebrow="Workspace" title="系统设置" description="检查运行环境和外部服务连接。敏感密钥不会显示在浏览器界面。" /><div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader className="border-b"><div className="flex items-center justify-between"><CardTitle>Supabase</CardTitle><Badge variant={isSupabaseConfigured ? "default" : "outline"}>{isSupabaseConfigured ? "已连接" : "未配置"}</Badge></div></CardHeader><CardContent><p className="text-sm leading-6 text-muted-foreground">提供账号密码认证、业务元数据持久化和后续实时状态更新。浏览器仅使用 Publishable Key。</p><Button variant="outline" className="mt-5" disabled>测试连接</Button></CardContent></Card><Card><CardHeader className="border-b"><div className="flex items-center justify-between"><CardTitle>资产存储</CardTitle><Badge variant="outline">待设计</Badge></div></CardHeader><CardContent><p className="text-sm leading-6 text-muted-foreground">可连接本地目录、Supabase Storage 或云端 OSS。数据库只保存地址、元数据、版本和关系。</p><Button variant="outline" className="mt-5" disabled>添加存储</Button></CardContent></Card></div></div> }
