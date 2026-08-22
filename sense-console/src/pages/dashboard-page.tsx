import { Link } from "react-router"
import { ArrowRightIcon, CircleAlertIcon, PlusIcon, WandSparklesIcon } from "lucide-react"

import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { PageHeader } from "@/components/page-header"
import { SectionCards } from "@/components/section-cards"
import { StatusBadge } from "@/components/status-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { assets, tasks } from "@/data/mock-data"

export function DashboardPage() {
  return <div className="flex flex-col gap-6">
    <PageHeader eyebrow="工作台" title="内容生产驾驶舱" description="聚合重要信号、Agent 任务和待审核资产，把注意力放在需要决策的地方。" actions={<><Button variant="outline"><WandSparklesIcon />编排任务</Button><Button><PlusIcon />新建选题</Button></>} />
    <SectionCards />
    <div className="grid gap-4 @5xl/main:grid-cols-[minmax(0,1.5fr)_minmax(280px,.5fr)]">
      <ChartAreaInteractive />
      <Card><CardHeader><CardTitle>需要你处理</CardTitle><CardDescription>按影响和等待时间排序</CardDescription></CardHeader><CardContent className="space-y-2">{[
        ["审核《AI 与非遗》故事结构", "Story Agent · 等待 9 分钟"],
        ["确认夜市人物采访优先级", "Research Agent · 等待 21 分钟"],
        ["处理社区素材采集异常", "Asset Agent · 失败 2 次"],
      ].map(([title, meta]) => <Button key={title} variant="ghost" className="h-auto w-full justify-start gap-3 px-3 py-3 text-left"><CircleAlertIcon className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{meta}</span></span><ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" /></Button>)}</CardContent></Card>
    </div>
    <div className="grid gap-4 @5xl/main:grid-cols-2">
      <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>活跃任务</CardTitle><CardDescription>跨 Agent 的最近执行状态</CardDescription></div><Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/tasks" />}>查看全部<ArrowRightIcon /></Button></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>任务</TableHead><TableHead>状态</TableHead><TableHead className="w-32">进度</TableHead></TableRow></TableHeader><TableBody>{tasks.slice(0, 4).map((task) => <TableRow key={task.id}><TableCell><Link to={`/tasks/${task.id}`} className="font-medium hover:underline">{task.name}</Link><div className="mt-1 text-xs text-muted-foreground">{task.agent}</div></TableCell><TableCell><StatusBadge status={task.status} /></TableCell><TableCell><div className="flex items-center gap-2"><Progress value={task.progress} /><span className="text-xs tabular-nums text-muted-foreground">{task.progress}%</span></div></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>最新资产</CardTitle><CardDescription>最近生成或更新的制作物料</CardDescription></div><Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/assets" />}>查看全部<ArrowRightIcon /></Button></CardHeader><CardContent className="space-y-1">{assets.slice(0, 4).map((asset) => <Button key={asset.id} variant="ghost" className="h-auto w-full justify-start gap-3 px-2 py-2" nativeButton={false} render={<Link to={`/assets/${asset.id}`} />}><Avatar className="size-9 rounded-md"><AvatarFallback className="rounded-md text-xs">{asset.kind.slice(0, 2)}</AvatarFallback></Avatar><span className="min-w-0 flex-1 text-left"><span className="block truncate font-medium">{asset.name}</span><span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{asset.kind} · {asset.updatedAt}</span></span><StatusBadge status={asset.status} /></Button>)}</CardContent></Card>
    </div>
  </div>
}
