import { useParams } from "react-router"
import { Check, Play } from "lucide-react"
import { DetailLayout } from "@/components/detail-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { topics } from "@/data/mock-data"

export function TopicDetailPage() { const { topicId } = useParams(); const topic = topics.find((item) => item.id === topicId) || topics[0]; return <DetailLayout backTo="/topics" backLabel="返回选题" eyebrow={topic.id} title={topic.title} status={topic.status} description="从公开讨论与行业变化中识别出的叙事机会，当前结论等待主理人确认。" actions={<><Button variant="outline"><Check />批准方向</Button><Button><Play />创建研究任务</Button></>} facts={[{label:"价值评分",value:`${topic.score}/100`},{label:"信号来源",value:topic.signal},{label:"负责人",value:topic.owner},{label:"更新时间",value:topic.updatedAt}]}><Card><CardHeader className="border-b"><CardTitle>判断摘要</CardTitle></CardHeader><CardContent className="space-y-4 text-sm leading-7 text-muted-foreground"><p>夜间消费正在从单一餐饮场景转向带有社群、手作和本地文化属性的复合体验。微型创业者既是经济参与者，也是城市生活方式的叙事入口。</p><p>建议以三位不同阶段的摊主为人物支点，避免宏观政策解读，重点呈现选择、压力与互助关系。</p></CardContent></Card><Card><CardHeader className="border-b"><CardTitle>信号证据</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{["社交平台相关讨论 7 日增长 38%","三个城市发布夜间街区扶持计划","本地生活搜索出现新职业关键词","同类内容平均完播率高于基线"].map((text, i) => <div key={text} className="rounded-xl border bg-muted/30 p-4"><span className="text-xs font-semibold text-primary">0{i+1}</span><p className="mt-2 text-sm">{text}</p></div>)}</CardContent></Card></DetailLayout> }
