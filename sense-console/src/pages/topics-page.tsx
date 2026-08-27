import { Link } from "react-router"
import { ArrowUpRight } from "lucide-react"

import { ListToolbar } from "@/components/list-toolbar"
import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { StatusBadge } from "@/components/status-badge"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { topics } from "@/data/mock-data"
import { usePagination } from "@/hooks/use-pagination"

const PAGE_SIZE = 10

export function TopicsPage() {
  const { page, pageCount, pageItems, setPage, totalCount } = usePagination(topics, PAGE_SIZE)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Editorial intelligence"
        title="选题"
        description="集中判断外部信号的叙事价值，并把通过的方向推进到研究与故事生产。"
      />
      <ListToolbar placeholder="搜索标题、信号来源或负责人" action="新建选题" />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>选题</TableHead>
                <TableHead className="hidden md:table-cell">信号来源</TableHead>
                <TableHead>价值分</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="hidden lg:table-cell">负责人</TableHead>
                <TableHead className="hidden sm:table-cell">更新</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((topic) => (
                <TableRow key={topic.id}>
                  <TableCell>
                    <Link className="font-medium hover:text-primary" to={`/topics/${topic.id}`}>
                      {topic.title}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground md:hidden">{topic.signal}</p>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{topic.signal}</TableCell>
                  <TableCell>
                    <span className="font-semibold tabular-nums">{topic.score}</span>
                    <span className="text-muted-foreground">/100</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={topic.status} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{topic.owner}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{topic.updatedAt}</TableCell>
                  <TableCell>
                    <Link to={`/topics/${topic.id}`} aria-label="查看选题">
                      <ArrowUpRight className="size-4 text-muted-foreground" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <PaginationBar page={page} pageCount={pageCount} totalCount={totalCount} onPageChange={setPage} />
    </div>
  )
}
