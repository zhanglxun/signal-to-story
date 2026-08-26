import { Link } from "react-router"
import { ArrowUpRight } from "lucide-react"
import { ListToolbar } from "@/components/list-toolbar"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { tasks } from "@/data/mock-data"

export function TasksPage() { return <div className="space-y-6"><PageHeader eyebrow="Agent operations" title="任务调度" description="查看异步 Agent 的执行状态、输入输出和异常，并在关键节点下达指令。" /><ListToolbar placeholder="搜索任务、Agent 或关联选题" action="编排任务" /><Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>任务</TableHead><TableHead className="hidden md:table-cell">执行者</TableHead><TableHead>进度</TableHead><TableHead>状态</TableHead><TableHead className="hidden lg:table-cell">最近更新</TableHead><TableHead /></TableRow></TableHeader><TableBody>{tasks.map((task) => <TableRow key={task.id}><TableCell><Link className="font-medium hover:text-primary" to={`/tasks/${task.id}`}>{task.name}</Link><p className="mt-1 max-w-sm truncate text-xs text-muted-foreground">{task.topic}</p></TableCell><TableCell className="hidden text-muted-foreground md:table-cell">{task.agent}</TableCell><TableCell><div className="flex min-w-24 items-center gap-2"><Progress value={task.progress} className="h-1.5" /><span className="text-xs tabular-nums text-muted-foreground">{task.progress}%</span></div></TableCell><TableCell><StatusBadge status={task.status} /></TableCell><TableCell className="hidden text-muted-foreground lg:table-cell">{task.updatedAt}</TableCell><TableCell><Link to={`/tasks/${task.id}`} aria-label="查看任务"><ArrowUpRight className="size-4 text-muted-foreground" /></Link></TableCell></TableRow>)}</TableBody></Table></CardContent></Card></div> }
