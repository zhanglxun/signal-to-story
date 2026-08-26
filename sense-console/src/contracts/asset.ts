export const assetTypes = ["character", "scene", "prop", "sound", "style"] as const
export const mediaTypes = ["image", "audio", "video", "model", "document", "other"] as const

export type AssetType = (typeof assetTypes)[number]
export type AssetMediaType = (typeof mediaTypes)[number]

export type Asset = {
  id: number
  organizationId: string
  assetType: AssetType
  category: string
  mediaType: AssetMediaType
  name: string
  cloudUrl: string | null
  thumbnailUrl: string | null
  isActive: boolean
  description: string | null
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

export type AssetFilters = {
  organizationId: string
  assetType?: AssetType
  query?: string
  active?: boolean
}

export type CreateAssetInput = {
  organizationId: string
  assetType: AssetType
  category: string
  mediaType: AssetMediaType
  name: string
  cloudUrl?: string
  localPath?: string
  thumbnailUrl?: string
  description?: string
  isActive: boolean
}

export type UpdateAssetInput = CreateAssetInput & {
  id: number
}

export type AssetWorkspace = {
  organization: {
    id: string
    name: string
  } | null
  canManage: boolean
}

export const assetTypeLabels: Record<AssetType, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  sound: "音效",
  style: "风格",
}

export const mediaTypeLabels: Record<AssetMediaType, string> = {
  image: "图片",
  audio: "音频",
  video: "视频",
  model: "模型",
  document: "文档",
  other: "其他",
}
