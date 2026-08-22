import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowUpRightIcon, BotIcon, CheckCircle2Icon, Clock3Icon } from "lucide-react"

const metrics = [
  { label: "待判断选题", value: "12", badge: "+4 本周", detail: "3 个高优先级信号", icon: ArrowUpRightIcon },
  { label: "运行中任务", value: "08", badge: "4 Agents", detail: "当前执行队列正常", icon: BotIcon },
  { label: "待审核产物", value: "05", badge: "9 分钟", detail: "最早等待时间", icon: Clock3Icon },
  { label: "本周已完成", value: "27", badge: "84%", detail: "整体计划完成率", icon: CheckCircle2Icon },
]

export function SectionCards() {
  return <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">{metrics.map((metric) => <Card key={metric.label} className="@container/card"><CardHeader><CardDescription>{metric.label}</CardDescription><CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{metric.value}</CardTitle><CardAction><Badge variant="outline"><metric.icon />{metric.badge}</Badge></CardAction></CardHeader><CardFooter className="flex-col items-start gap-1.5 text-sm"><div className="font-medium">{metric.detail}</div><div className="text-muted-foreground">较昨日状态稳定</div></CardFooter></Card>)}</div>
}
