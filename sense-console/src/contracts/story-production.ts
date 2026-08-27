export const storyStatuses = ["draft", "in_production", "in_review", "published"] as const
export type StoryStatus = (typeof storyStatuses)[number]

export const storyStatusLabels: Record<StoryStatus, string> = {
  draft: "草稿",
  in_production: "生成中",
  in_review: "待审核",
  published: "已发布",
}

export type Story = {
  id: string
  title: string
  logline: string
  source: "original" | "adapted"
  status: StoryStatus
  chapterCount: number
  hookCount: number
  sceneSlotCount: number
  beatCount: number
  segmentCount: number
  shotCount: number
  characterCount: number
  artAssetCount: number
  updatedAt: string
}

export const storySourceLabels: Record<Story["source"], string> = {
  original: "原创",
  adapted: "改编",
}

export type Chapter = {
  id: string
  storyId: string
  index: number
  title: string
  hook: string
}

export const shotStatuses = ["pending", "generated", "approved"] as const
export type ShotStatus = (typeof shotStatuses)[number]

export const shotStatusLabels: Record<ShotStatus, string> = {
  pending: "待生成",
  generated: "已生成",
  approved: "已认领",
}

export type Shot = {
  id: string
  chapterId: string
  index: number
  shotType: string
  duration: string
  description: string
  status: ShotStatus
}

export const characterWeights = ["protagonist", "major", "supporting"] as const
export type CharacterWeight = (typeof characterWeights)[number]

export const characterWeightLabels: Record<CharacterWeight, string> = {
  protagonist: "主角",
  major: "重要",
  supporting: "配角",
}

export type Character = {
  id: string
  storyId: string
  name: string
  alias: string
  weight: CharacterWeight
  logline: string
  voice: string
  avatarUrl: string | null
}

export const artAssetKinds = ["scene", "prop"] as const
export type ArtAssetKind = (typeof artAssetKinds)[number]

export const artAssetKindLabels: Record<ArtAssetKind, string> = {
  scene: "场景",
  prop: "道具",
}

export type ArtAsset = {
  id: string
  storyId: string
  code: string
  kind: ArtAssetKind
  name: string
  tag: string | null
  lighting: string | null
  description: string
  prompt: string
  thumbnailUrl: string | null
  updatedAt: string
}
