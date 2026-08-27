import { PlusIcon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { storySourceLabels, storyStatusLabels } from "@/contracts/story-production"
import { stories } from "@/data/story-production-mock"
import { usePagination } from "@/hooks/use-pagination"

const PAGE_SIZE = 10

export function ScriptsPage() {
  const { page, pageCount, pageItems, setPage, totalCount } = usePagination(stories, PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Story production"
        title="剧本构造"
        description="每个剧本都是一个独立的生产主体，拥有唯一 ID；集数与章节在这里维护，分镜、角色、场景和画布都按剧本 ID 切分内容。"
        actions={
          <Button onClick={() => toast.info("剧本创建流程即将上线")}>
            <PlusIcon />
            新建剧本
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>剧本</TableHead>
                <TableHead className="hidden md:table-cell">来源</TableHead>
                <TableHead className="hidden lg:table-cell">集数 · 爽点</TableHead>
                <TableHead className="hidden lg:table-cell">场次 · 节拍</TableHead>
                <TableHead>分镜进度</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="hidden sm:table-cell">更新</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((story) => (
                <TableRow key={story.id}>
                  <TableCell>
                    <Link className="font-medium hover:text-primary" to={`/video/scripts/${story.id}`}>
                      {story.title}
                    </Link>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">{story.logline}</p>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {storySourceLabels[story.source]}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {story.chapterCount} 集 · {story.hookCount} 个爽点
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {story.sceneSlotCount} 场 · {story.beatCount} 节拍
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {story.segmentCount} 段 · {story.shotCount} 个镜头
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={storyStatusLabels[story.status]} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{story.updatedAt}</TableCell>
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
