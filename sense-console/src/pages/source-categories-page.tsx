import { ListToolbar } from "@/components/list-toolbar"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { sourceCategories } from "@/data/mock-data"

export function SourceCategoriesPage() { return <div className="space-y-6"><PageHeader eyebrow="Source taxonomy" title="分类管理" description="维护信息源的分类体系，决定新线索进入待处理信息后如何归类和路由。" /><ListToolbar placeholder="搜索分类名称或说明" action="新建分类" /><Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>分类</TableHead><TableHead className="hidden md:table-cell">说明</TableHead><TableHead>信源数</TableHead><TableHead>状态</TableHead><TableHead className="hidden sm:table-cell">更新时间</TableHead></TableRow></TableHeader><TableBody>{sourceCategories.map((category) => <TableRow key={category.id}><TableCell><p className="font-medium">{category.name}</p><p className="mt-1 text-xs text-muted-foreground md:hidden">{category.description}</p></TableCell><TableCell className="hidden text-muted-foreground md:table-cell">{category.description}</TableCell><TableCell className="font-semibold tabular-nums">{category.sourceCount}</TableCell><TableCell><StatusBadge status={category.status} /></TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{category.updatedAt}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></div> }
