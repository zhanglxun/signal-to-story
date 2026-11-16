import { BookMarkedIcon } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { storyStatusLabels } from "@/contracts/story-production"
import { useStoryScope } from "@/hooks/use-story-scope"

/**
 * Shared "current story" switcher for the storyboard/character/scene/canvas
 * pages. Selecting a story here updates the `storyId` query param that
 * `useStoryScope` reads on every one of those pages, so switching context in
 * one place carries across the whole video-production module.
 */
export function StoryScopeSelect({ className }: { className?: string }) {
  const { storyId, story, stories, setStoryId } = useStoryScope()

  if (stories.length === 0) return null

  // Base UI's `Select.Value` only shows the raw value string unless `items`
  // (a value → label map) is passed to the root — without it, the trigger
  // would show the story's id instead of its title once one is selected.
  const itemLabels = Object.fromEntries(stories.map((item) => [item.id, item.title]))

  return (
    <div className={className ?? "flex flex-wrap items-center gap-3"}>
      <Select items={itemLabels} value={storyId ?? undefined} onValueChange={(value) => value && setStoryId(value)}>
        <SelectTrigger className="w-56" aria-label="切换剧本">
          <BookMarkedIcon className="text-muted-foreground" />
          <SelectValue placeholder="选择剧本" />
        </SelectTrigger>
        <SelectContent>
          {stories.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {story && (
        <span className="text-xs text-muted-foreground">
          {story.chapterCount} 集 · {story.hookCount} 个爽点 · {storyStatusLabels[story.status]}
        </span>
      )}
    </div>
  )
}
