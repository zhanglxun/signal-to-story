import {
  ArrowRightIcon,
  BookOpenIcon,
  ClapperboardIcon,
  FilmIcon,
  LayersIcon,
  MountainIcon,
  PaletteIcon,
  SparklesIcon,
  UserRoundIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { StoryScopeSelect } from "@/components/video-production/story-scope-select"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { artAssets } from "@/data/story-production-mock"
import { buildStoryScopedPath, useStoryScope } from "@/hooks/use-story-scope"

function StageCard({
  index,
  label,
  hint,
  icon: Icon,
  stat,
  to,
}: {
  index?: string
  label: string
  hint: string
  icon: LucideIcon
  stat: string
  to?: string
}) {
  const content = (
    <Card className={to ? "h-full transition-colors hover:bg-muted/50" : "h-full"}>
      <CardContent className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Icon className="size-4 text-muted-foreground" />
            {index && <span className="text-xs text-muted-foreground">{index}</span>}
            {label}
          </span>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </div>
        <p className="text-sm text-muted-foreground">{stat}</p>
      </CardContent>
    </Card>
  )
  return to ? <Link to={to}>{content}</Link> : content
}

export function CanvasPage() {
  const { storyId, story } = useStoryScope()
  const storyArtAssets = artAssets.filter((asset) => asset.storyId === storyId)
  const sceneCount = storyArtAssets.filter((asset) => asset.kind === "scene").length
  const propCount = storyArtAssets.filter((asset) => asset.kind === "prop").length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Production canvas"
        title="画布创作"
        description="从大纲到分镜，五个阶段的产线进度都在这里查看。改完直接重新生成，每一次改动都可以追溯。"
      />

      <StoryScopeSelect />

      {!story ? (
        <Empty className="min-h-72 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PaletteIcon />
            </EmptyMedia>
            <EmptyTitle>请先在剧本构造中创建剧本</EmptyTitle>
            <EmptyDescription>画布创作是单个剧本的产线总览，需要先选择或创建一个剧本。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
            <StageCard label="小说原文" hint="素材来源" icon={BookOpenIcon} stat="原稿与人物设定来源" />

            <ArrowRightIcon className="hidden size-5 shrink-0 text-muted-foreground lg:block" />

            <StageCard
              index="01"
              label="大纲"
              hint="什么"
              icon={LayersIcon}
              stat={`${story.chapterCount} 集 · ${story.hookCount} 个爽点`}
            />

            <ArrowRightIcon className="hidden size-5 shrink-0 text-muted-foreground lg:block" />

            <div className="flex-1 space-y-2 rounded-xl border border-dashed p-3">
              <p className="text-center text-xs text-muted-foreground">收敛层 · 三者同步迭代，无先后</p>
              <StageCard
                index="02"
                label="角色"
                hint="谁"
                icon={UserRoundIcon}
                stat={`${story.characterCount} 个角色`}
                to={buildStoryScopedPath("/video/characters", story.id)}
              />
              <StageCard
                index="03"
                label="美术"
                hint="在哪 + 拿什么"
                icon={MountainIcon}
                stat={`${sceneCount} 个场景 · ${propCount} 个道具`}
                to={buildStoryScopedPath("/video/scenes", story.id)}
              />
              <StageCard
                index="04"
                label="剧本"
                hint="戏"
                icon={ClapperboardIcon}
                stat={`${story.sceneSlotCount} 场 · ${story.beatCount} 节拍`}
                to={`/video/scripts/${story.id}`}
              />
            </div>

            <ArrowRightIcon className="hidden size-5 shrink-0 text-muted-foreground lg:block" />

            <StageCard
              index="05"
              label="分镜"
              hint="怎么拍"
              icon={FilmIcon}
              stat={`${story.segmentCount} 段 · ${story.shotCount} 个镜头`}
              to={buildStoryScopedPath("/video/storyboards", story.id)}
            />

            <ArrowRightIcon className="hidden size-5 shrink-0 text-muted-foreground lg:block" />

            <Card className="h-full border-dashed">
              <CardContent className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <SparklesIcon className="size-5 text-muted-foreground" />
                <p className="text-sm font-medium">批量生成</p>
                <p className="text-xs text-muted-foreground">按镜出片</p>
                <Button size="sm" variant="outline" onClick={() => toast.info("批量生成尚未接入，等待 Worker 落地")}>
                  生成
                </Button>
              </CardContent>
            </Card>
          </div>

          <p className="text-center text-xs text-muted-foreground">人工过一遍 · 不满意就微调，重新生成</p>
        </>
      )}
    </div>
  )
}
