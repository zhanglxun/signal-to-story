import { useState } from "react"
import { Grid2X2Icon, ListIcon, UserRoundIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { StoryScopeSelect } from "@/components/video-production/story-scope-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { characterWeightLabels, type CharacterWeight } from "@/contracts/story-production"
import { characters } from "@/data/story-production-mock"
import { usePagination } from "@/hooks/use-pagination"
import { useStoryScope } from "@/hooks/use-story-scope"

type ViewMode = "list" | "grid"
const PAGE_SIZE = 8

function WeightBadge({ weight }: { weight: CharacterWeight }) {
  return <Badge variant={weight === "protagonist" ? "default" : "outline"}>{characterWeightLabels[weight]}</Badge>
}

export function CharactersPage() {
  const { storyId, story } = useStoryScope()
  const [viewMode, setViewMode] = useState<ViewMode>("list")
  const storyCharacters = characters.filter((character) => character.storyId === storyId)
  const { page, pageCount, pageItems, setPage, totalCount } = usePagination(storyCharacters, PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Cast"
        title="角色设定"
        description="维护剧本中的人物阵容：分量、一句话简介与音色，切换上方剧本即可查看对应角色。"
        actions={
          <div className="flex rounded-lg border p-1">
            <Button size="icon-sm" variant={viewMode === "list" ? "secondary" : "ghost"} aria-label="列表显示" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}>
              <ListIcon />
            </Button>
            <Button size="icon-sm" variant={viewMode === "grid" ? "secondary" : "ghost"} aria-label="网格显示" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}>
              <Grid2X2Icon />
            </Button>
          </div>
        }
      />

      <StoryScopeSelect />

      {!story ? (
        <Empty className="min-h-72 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRoundIcon />
            </EmptyMedia>
            <EmptyTitle>请先在剧本构造中创建剧本</EmptyTitle>
            <EmptyDescription>暂无可用剧本，角色需要挂在一个具体剧本下。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : storyCharacters.length === 0 ? (
        <Empty className="min-h-72 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRoundIcon />
            </EmptyMedia>
            <EmptyTitle>该剧本还没有角色</EmptyTitle>
            <EmptyDescription>从大纲和剧本中拆分出人物后，在这里登记角色设定。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {viewMode === "list" ? (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>姓名</TableHead>
                      <TableHead className="hidden sm:table-cell">别名</TableHead>
                      <TableHead>分量</TableHead>
                      <TableHead>一句话</TableHead>
                      <TableHead className="hidden lg:table-cell">音色</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((character) => (
                      <TableRow key={character.id}>
                        <TableCell className="font-medium">{character.name}</TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">{character.alias}</TableCell>
                        <TableCell>
                          <WeightBadge weight={character.weight} />
                        </TableCell>
                        <TableCell className="max-w-md text-muted-foreground">{character.logline}</TableCell>
                        <TableCell className="hidden text-muted-foreground lg:table-cell">{character.voice}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <section className="grid gap-4 sm:grid-cols-2 @5xl/main:grid-cols-3">
              {pageItems.map((character) => (
                <Card key={character.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-muted/50">
                          <UserRoundIcon className="size-5 text-muted-foreground" />
                        </div>
                        <div>
                          <CardTitle>{character.name}</CardTitle>
                          <p className="text-xs text-muted-foreground">{character.alias}</p>
                        </div>
                      </div>
                      <WeightBadge weight={character.weight} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="line-clamp-3 min-h-16 text-sm text-muted-foreground">{character.logline}</p>
                  </CardContent>
                  <CardFooter className="text-xs text-muted-foreground">音色 · {character.voice}</CardFooter>
                </Card>
              ))}
            </section>
          )}
          <PaginationBar page={page} pageCount={pageCount} totalCount={totalCount} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
