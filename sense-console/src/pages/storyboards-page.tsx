import { ClapperboardIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { StoryScopeSelect } from "@/components/video-production/story-scope-select"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { shotStatusLabels } from "@/contracts/story-production"
import { chapters, shots } from "@/data/story-production-mock"
import { usePagination } from "@/hooks/use-pagination"
import { useStoryScope } from "@/hooks/use-story-scope"

const CHAPTERS_PER_PAGE = 3

export function StoryboardsPage() {
  const { storyId, story } = useStoryScope()
  const storyChapters = chapters.filter((chapter) => chapter.storyId === storyId)
  const shotsByChapter = new Map(storyChapters.map((chapter) => [chapter.id, shots.filter((shot) => shot.chapterId === chapter.id)]))
  const totalShots = [...shotsByChapter.values()].reduce((sum, list) => sum + list.length, 0)
  const { page, pageCount, pageItems, setPage } = usePagination(storyChapters, CHAPTERS_PER_PAGE)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Shot list"
        title="分镜设置"
        description="按章节查看每一段分镜的镜号、景别、时长与描述，切换上方剧本即可查看对应内容。"
      />

      <StoryScopeSelect />

      {!story ? (
        <Empty className="min-h-72 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClapperboardIcon />
            </EmptyMedia>
            <EmptyTitle>请先在剧本构造中创建剧本</EmptyTitle>
            <EmptyDescription>暂无可用剧本，分镜内容需要挂在一个具体剧本下。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            共 {storyChapters.length} 章 · {totalShots} 个镜头
          </p>

          <div className="space-y-6">
            {pageItems.map((chapter) => {
              const chapterShots = shotsByChapter.get(chapter.id) ?? []
              return (
                <Card key={chapter.id} id={chapter.id} className="scroll-mt-20">
                  <CardContent>
                    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b pb-4">
                      <h2 className="text-base font-semibold">{chapter.title}</h2>
                      <p className="text-sm text-muted-foreground">{chapter.hook}</p>
                    </div>

                    {chapterShots.length === 0 ? (
                      <p className="text-sm text-muted-foreground">本章还没有生成分镜。</p>
                    ) : (
                      <ul className="space-y-4">
                        {chapterShots.map((shot) => (
                          <li key={shot.id} className="flex flex-col gap-4 sm:flex-row sm:items-start">
                            <div className="flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50 sm:w-48">
                              <ClapperboardIcon className="size-6 text-muted-foreground" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium">镜 {chapter.index}-{shot.index}</span>
                                <Badge variant="outline">{shot.shotType}</Badge>
                                <span className="text-xs text-muted-foreground">{shot.duration}</span>
                                <Badge variant={shot.status === "approved" ? "secondary" : "outline"}>
                                  {shotStatusLabels[shot.status]}
                                </Badge>
                              </div>
                              <p className="mt-2 text-sm text-muted-foreground">{shot.description}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <PaginationBar page={page} pageCount={pageCount} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
