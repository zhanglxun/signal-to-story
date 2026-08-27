export const promptExampleOriginTypes = ["collected", "self_created"] as const
export const promptExampleStatuses = ["inbox", "curated", "archived"] as const
export const promptExampleVisibilities = ["private", "shared"] as const

export type PromptExampleOriginType = (typeof promptExampleOriginTypes)[number]
export type PromptExampleStatus = (typeof promptExampleStatuses)[number]
export type PromptExampleVisibility = (typeof promptExampleVisibilities)[number]

export type PromptExample = {
  id: number
  organizationId: string
  title: string
  promptText: string
  negativePrompt: string | null
  exampleImageUrl: string | null
  exampleStoragePath: string | null
  /** A short-lived signed Storage URL, preferred over an external URL for display. */
  examplePreviewUrl: string | null
  exampleAssetId: number | null
  sourceUrl: string | null
  sourceAuthor: string | null
  originType: PromptExampleOriginType
  tags: string[]
  status: PromptExampleStatus
  visibility: PromptExampleVisibility
  notes: string | null
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

export type PromptExampleFilters = {
  organizationId: string
  query?: string
  originType?: PromptExampleOriginType
  status?: PromptExampleStatus
  page?: number
  pageSize?: number
}

export type PromptExamplePage = {
  promptExamples: PromptExample[]
  totalCount: number
}

export type CreatePromptExampleInput = {
  organizationId: string
  title: string
  promptText: string
  negativePrompt?: string
  exampleImageUrl?: string
  exampleStoragePath?: string | null
  exampleAssetId?: number | null
  sourceUrl?: string
  sourceAuthor?: string
  originType: PromptExampleOriginType
  tags: string[]
  status: PromptExampleStatus
  visibility: PromptExampleVisibility
  notes?: string
}

export type UpdatePromptExampleInput = CreatePromptExampleInput & { id: number }

export const promptExampleOriginLabels: Record<PromptExampleOriginType, string> = {
  collected: "网络收集",
  self_created: "自己创作",
}

export const promptExampleStatusLabels: Record<PromptExampleStatus, string> = {
  inbox: "待整理",
  curated: "已收藏",
  archived: "已归档",
}

export const promptExampleVisibilityLabels: Record<PromptExampleVisibility, string> = {
  private: "私有",
  shared: "可共享",
}
