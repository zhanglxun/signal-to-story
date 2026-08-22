import { Link } from "react-router"
import { ArrowUpRight, CheckCircle2, CircleAlert, Clock3, MoreHorizontal, Play, Sparkles, WandSparkles } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { assets, tasks } from "@/data/mock-data"

const metrics = [
  { label: "待判断选题", value: "12", delta: "+4 本周", icon: Sparkles, accent: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  { label: "运行中任务", value: "08", delta: "4 个 Agent", icon: Play, accent: "bg-blue-500/12 text-blue-700 dark:text-blue-300" },
  { label: "待审核产物", value: "05", delta: "最早 9 分钟", icon: Clock3, accent: "bg-amber-500/12 text-amber-700 dark:text-amber-300" },
  { label: "本周已完成", value: "27", delta: "完成率 84%", icon: CheckCircle2, accent: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
]

const stages = [
  { label: "信号收集", value: 46, color: "bg-slate-400" }, { label: "研究分析", value: 32, color: "bg-blue-500" }, { label: "故事规划", value: 21, color: "bg-violet-500" }, { label: "资产制作", value: 18, color: "bg-amber-500" }, { label: "审核归档", value: 11, color: "bg-emerald-500" },
]

export function DashboardPage() {
  return <div className="space-y-8">
    <PageHeader eyebrow="Friday · 22 August" title="内容生产驾驶舱" description="聚合重要信号、Agent 任务和待审核资产，把注意力放在真正需要你决策的地方。" actions={<><Button variant="outline"><WandSparkles />编排任务</Button><Button><Sparkles />新建选题</Button></>} />
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((item) => <Card key={item.label} className="relative overflow-hidden"><CardContent className="flex items-start justify-between"><div><p className="text-xs font-medium text-muted-foreground">{item.label}</p><p className="mt-3 text-3xl font-semibold tracking-[-.05em]">{item.value}</p><p className="mt-2 text-xs text-muted-foreground">{item.delta}</p></div><div className={`grid size-9 place-items-center rounded-lg ${item.accent}`}><item.icon className="size-4" /></div></CardContent></Card>)}</section>
    <section className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <Card><CardHeader className="border-b"><div className="flex items-center justify-between"><div><CardTitle>生产流量</CardTitle><p className="mt-1 text-xs text-muted-foreground">过去 7 天的工作项推进分布</p></div><Badge variant="outline">实时视图</Badge></div></CardHeader><CardContent>
        <div className="mb-8 flex h-48 items-end gap-3 border-b pt-4 sm:gap-5">{[42,58,46,72,66,88,74].map((value, index) => <div key={index} className="group flex h-full flex-1 items-end"><div className="relative w-full rounded-t-md bg-primary/10 transition group-hover:bg-primary/15" style={{height:`${value}%`}}><div className="absolute inset-x-0 bottom-0 rounded-t-md bg-primary" style={{height:`${Math.max(value-22,18)}%`}} /></div></div>)}</div>
        <div className="grid grid-cols-5 gap-2">{stages.map((stage) => <div key={stage.label}><div className="mb-2 flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${stage.color}`} /><span className="truncate text-[11px] text-muted-foreground">{stage.label}</span></div><p className="text-lg font-semibold">{stage.value}</p></div>)}</div>
      </CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>需要你处理</CardTitle><p className="text-xs text-muted-foreground">按影响和等待时间排序</p></CardHeader><CardContent className="space-y-2">
        {[{title:"审核《AI 与非遗》故事结构",meta:"Story Agent · 等待 9 分钟",tone:"bg-amber-500"},{title:"确认夜市人物采访优先级",meta:"Research Agent · 等待 21 分钟",tone:"bg-blue-500"},{title:"处理社区素材采集异常",meta:"Asset Agent · 失败 2 次",tone:"bg-red-500"}].map((item) => <button key={item.title} className="flex w-full items-start gap-3 rounded-xl border bg-background p-3 text-left transition hover:border-primary/30 hover:bg-muted/40"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.tone}`} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs text-muted-foreground">{item.meta}</span></span><ArrowUpRight className="ml-auto size-4 shrink-0 text-muted-foreground" /></button>)}
      </CardContent></Card>
    </section>
    <section className="grid gap-5 xl:grid-cols-[1fr_.95fr]">
      <Card><CardHeader className="flex-row items-center justify-between border-b"><div><CardTitle>活跃任务</CardTitle><p className="mt-1 text-xs text-muted-foreground">跨 Agent 的最近执行状态</p></div><Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/tasks" />}>查看全部<ArrowUpRight /></Button></CardHeader><CardContent className="space-y-5">{tasks.slice(0,3).map((task) => <Link to={`/tasks/${task.id}`} key={task.id} className="block"><div className="mb-2 flex items-start gap-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{task.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{task.agent} · {task.topic}</p></div><StatusBadge status={task.status} /></div><Progress value={task.progress} className="h-1.5" /></Link>)}</CardContent></Card>
      <Card><CardHeader className="flex-row items-center justify-between border-b"><div><CardTitle>最新资产</CardTitle><p className="mt-1 text-xs text-muted-foreground">从故事关系中生成的制作物料</p></div><Button variant="ghost" size="icon-sm"><MoreHorizontal /></Button></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{assets.slice(0,4).map((asset) => <Link key={asset.id} to={`/assets/${asset.id}`} className="group flex items-center gap-3 rounded-xl border p-2.5 transition hover:border-primary/30"><div className={`grid size-12 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${asset.tone} text-white shadow-inner`}><span className="text-[10px] font-semibold uppercase">{asset.kind.slice(0,2)}</span></div><div className="min-w-0"><p className="truncate text-sm font-medium group-hover:text-primary">{asset.name}</p><p className="mt-1 text-xs text-muted-foreground">{asset.kind} · {asset.updatedAt}</p></div></Link>)}</CardContent></Card>
    </section>
    <Card className="border-red-500/15 bg-red-500/[.035]"><CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-600"><CircleAlert className="size-4" /></div><div className="flex-1"><p className="text-sm font-medium">1 项执行异常需要处理</p><p className="mt-1 text-xs text-muted-foreground">社区空间素材采集连续失败，Agent 已暂停自动重试。</p></div><Button variant="outline" size="sm">查看诊断</Button></CardContent></Card>
  </div>
}
