import { ClapperboardIcon, FilmIcon, MountainIcon, PaletteIcon, UserRoundIcon } from "lucide-react"
import { Link, useParams } from "react-router"

import { DetailLayout } from "@/components/detail-layout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent } from "@/components/ui/card"
import { storySourceLabels, storyStatusLabels } from "@/contracts/story-production"
import { chapters, stories } from "@/data/story-production-mock"
import { buildStoryScopedPath } from "@/hooks/use-story-scope"

const quickLinks = [
  { path: "/video/storyboards", label: "分镜设置", description: "按章节查看镜头与描述", icon: FilmIcon },
  { path: "/video/characters", label: "角色设定", description: "查看该剧本的角色阵容", icon: UserRoundIcon },
  { path: "/video/scenes", label: "场景建模", description: "查看场景与道具美术设定", icon: MountainIcon },
  { path: "/video/canvas", label: "画布创作", description: "查看整体产线进度", icon: PaletteIcon },
]

export function ScriptDetailPage() {
  const { storyId } = useParams()
  const story = stories.find((item) => item.id === storyId)

  if (!story) {
    return (
      <Alert variant="destructive">
        <AlertTitle>剧本不存在</AlertTitle>
        <AlertDescription>该剧本可能已被删除，请返回剧本列表重新选择。</AlertDescription>
      </Alert>
    )
  }

  const storyChapters = chapters.filter((chapter) => chapter.storyId === story.id)

  return (
    <DetailLayout
      backTo="/video/scripts"
      backLabel="返回剧本构造"
      eyebrow={`${storySourceLabels[story.source]} · #${story.id}`}
      title={story.title}
      status={storyStatusLabels[story.status]}
      description={story.logline}
      facts={[
        { label: "集数 · 爽点", value: `${story.chapterCount} 集 · ${story.hookCount} 个爽点` },
        { label: "场次 · 节拍", value: `${story.sceneSlotCount} 场 · ${story.beatCount} 节拍` },
        { label: "分镜进度", value: `${story.segmentCount} 段 · ${story.shotCount} 个镜头` },
        { label: "角色 / 美术资产", value: `${story.characterCount} 个角色 · ${story.artAssetCount} 个场景/道具` },
        { label: "更新时间", value: story.updatedAt },
      ]}
    >
      <Card>
        <CardContent>
          <p className="mb-4 flex items-center gap-2 text-sm font-medium">
            <ClapperboardIcon className="size-4 text-muted-foreground" />
            章节 · {storyChapters.length} 集
          </p>
          <ul className="space-y-3">
            {storyChapters.map((chapter) => (
              <li key={chapter.id} className="flex items-start justify-between gap-4 border-b pb-3 text-sm last:border-b-0 last:pb-0">
                <span className="font-medium">{chapter.title}</span>
                <span className="text-right text-muted-foreground">{chapter.hook}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {quickLinks.map(({ path, label, description, icon: Icon }) => (
          <Link key={path} to={buildStoryScopedPath(path, story.id)}>
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardContent className="flex items-start gap-3">
                <Icon className="mt-0.5 size-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </DetailLayout>
  )
}
