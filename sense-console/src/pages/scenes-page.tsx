import { useMemo, useState } from "react"
import { Grid2X2Icon, ListIcon, MountainIcon, PencilIcon, RefreshCwIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { StoryScopeSelect } from "@/components/video-production/story-scope-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { artAssetKindLabels, type ArtAssetKind } from "@/contracts/story-production"
import { artAssets } from "@/data/story-production-mock"
import { usePagination } from "@/hooks/use-pagination"
import { useStoryScope } from "@/hooks/use-story-scope"

type ViewMode = "list" | "grid"
type KindFilter = "all" | ArtAssetKind
const PAGE_SIZE = 8

export function ScenesPage() {
  const { storyId, story } = useStoryScope()
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [kindFilter, setKindFilter] = useState<KindFilter>("all")

  const storyArtAssets = useMemo(() => artAssets.filter((asset) => asset.storyId === storyId), [storyId])
  const sceneCount = storyArtAssets.filter((asset) => asset.kind === "scene").length
  const propCount = storyArtAssets.filter((asset) => asset.kind === "prop").length
  const filteredAssets = kindFilter === "all" ? storyArtAssets : storyArtAssets.filter((asset) => asset.kind === kindFilter)
  const { page, pageCount, pageItems, setPage, totalCount } = usePagination(filteredAssets, PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Art direction"
        title="场景建模"
        description="维护剧本的场景与道具美术设定：光照状态、出图提示词与生成结果，切换上方剧本即可查看对应内容。"
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
              <MountainIcon />
            </EmptyMedia>
            <EmptyTitle>请先在剧本构造中创建剧本</EmptyTitle>
            <EmptyDescription>暂无可用剧本，场景与道具需要挂在一个具体剧本下。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Tabs value={kindFilter} onValueChange={(value) => value && setKindFilter(value as KindFilter)}>
            <TabsList>
              <TabsTrigger value="all">全部 {storyArtAssets.length}</TabsTrigger>
              <TabsTrigger value="scene">场景 {sceneCount}</TabsTrigger>
              <TabsTrigger value="prop">道具 {propCount}</TabsTrigger>
            </TabsList>
          </Tabs>

          {filteredAssets.length === 0 ? (
            <Empty className="min-h-72 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MountainIcon />
                </EmptyMedia>
                <EmptyTitle>暂无符合条件的场景或道具</EmptyTitle>
                <EmptyDescription>调整上方分类，或先完成美术设定的第一版生成。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : viewMode === "list" ? (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>编号</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead className="hidden md:table-cell">标签</TableHead>
                      <TableHead className="hidden lg:table-cell">光照</TableHead>
                      <TableHead className="hidden sm:table-cell">更新时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{asset.code}</TableCell>
                        <TableCell className="font-medium">{asset.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{artAssetKindLabels[asset.kind]}</Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">{asset.tag ?? "—"}</TableCell>
                        <TableCell className="hidden text-muted-foreground lg:table-cell">{asset.lighting ?? "—"}</TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">{asset.updatedAt}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <section className="grid gap-4 sm:grid-cols-2 @5xl/main:grid-cols-3">
              {pageItems.map((asset) => (
                <Card key={asset.id}>
                  <CardHeader>
                    <div className="grid aspect-square grid-cols-2 gap-0.5 overflow-hidden rounded-lg border bg-muted/50">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="flex items-center justify-center bg-muted/50">
                          <MountainIcon className="size-5 text-muted-foreground" />
                        </div>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle>
                        {asset.code} {asset.name}
                      </CardTitle>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">{artAssetKindLabels[asset.kind]}</Badge>
                        {asset.tag && <Badge variant="secondary">{asset.tag}</Badge>}
                      </div>
                    </div>
                    {asset.lighting && (
                      <p className="text-xs text-muted-foreground">
                        光照 · <Badge variant="outline">{asset.lighting}</Badge>
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">{asset.description}</p>
                    <p className="line-clamp-3 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{asset.prompt}</p>
                  </CardContent>
                  <CardFooter className="justify-end gap-2">
                    <Button variant="outline" size="sm" disabled>
                      <PencilIcon />
                      编辑图片
                    </Button>
                    <Button variant="outline" size="sm" disabled>
                      <RefreshCwIcon />
                      重新生成
                    </Button>
                  </CardFooter>
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
