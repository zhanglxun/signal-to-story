import { useParams } from "react-router"
import { PauseIcon, RotateCcwIcon } from "lucide-react"

import { DetailLayout } from "@/components/detail-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { tasks } from "@/data/mock-data"

export function TaskDetailPage() {
  const { taskId } = useParams()
  const task = tasks.find((item) => item.id === taskId) || tasks[0]
  const logs = [
    { time: "11:42:06", text: "完成公开信息交叉验证", done: true },
    { time: "11:39:18", text: "提取 16 条人物经历事实", done: true },
    { time: "执行中", text: "合并访谈材料与冲突标记", done: false },
  ]

  return <DetailLayout backTo="/tasks" backLabel="返回任务" eyebrow={task.id} title={task.name} status={task.status} description={`由 ${task.agent} 异步执行。控制台只管理指令、状态和结果引用，Agent 在独立运行环境完成实际工作。`} actions={<><Button variant="outline"><PauseIcon />暂停</Button><Button><RotateCcwIcon />重新执行</Button></>} facts={[{ label: "执行 Agent", value: task.agent }, { label: "整体进度", value: `${task.progress}%` }, { label: "关联选题", value: task.topic }, { label: "更新时间", value: task.updatedAt }]}>
    <Card><CardHeader className="border-b"><CardTitle>执行进度</CardTitle></CardHeader><CardContent><div className="mb-3 flex justify-between text-sm"><span>当前阶段：归纳事实卡</span><span className="font-semibold tabular-nums">{task.progress}%</span></div><Progress value={task.progress} /><div className="mt-6 space-y-5 border-l pl-5">{logs.map((log) => <div key={log.text} className="relative"><span className={`absolute top-1.5 -left-[25px] size-2 rounded-full ${log.done ? "bg-primary" : "animate-pulse bg-muted-foreground"}`} /><p className="text-sm font-medium">{log.text}</p><p className="mt-1 text-xs text-muted-foreground">{log.time}</p></div>)}</div></CardContent></Card>
    <Card><CardHeader className="border-b"><CardTitle>本次输入</CardTitle></CardHeader><CardContent><pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-6 text-muted-foreground">{`goal: 建立可用于故事规划的事实卡\nsources: approved_signal_set\noutput: research/facts-v1.json\nconstraints: 事实与推断必须分离`}</pre></CardContent></Card>
  </DetailLayout>
}
