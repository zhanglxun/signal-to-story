import type { SiteMedia } from "@/contracts/site"
import { isSafeMediaUrl } from "@/lib/markdown"

export function VideoPlayer({ media }: { media: SiteMedia }) {
  if (media.kind !== "video" || !isSafeMediaUrl(media.url)) return null
  return (
    <figure className="overflow-hidden rounded-xl border bg-black">
      <video
        controls
        preload="metadata"
        playsInline
        poster={media.poster && isSafeMediaUrl(media.poster) ? media.poster : undefined}
        className="aspect-video w-full"
        aria-label={media.caption || media.alt || "视频"}
      >
        <source src={media.url} />
        当前浏览器不支持视频播放。
      </video>
      {media.caption && <figcaption className="bg-card px-4 py-2 text-xs text-muted-foreground">{media.caption}</figcaption>}
    </figure>
  )
}
