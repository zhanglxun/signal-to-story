import { z } from "zod"

export const DEFAULT_SITE_ID = "primary"
export const ENTRY_PAGE_SIZE = 12
export const ENTRY_PAGE_MAX = 50

export const contentFormSchema = z.enum([
  "article",
  "tutorial",
  "video",
  "comic",
  "resource",
])
export const contentColumnSchema = z.enum([
  "news",
  "analysis",
  "how_to",
  "case",
])
export const accessLevelSchema = z.enum(["public", "registered"])

export type ContentForm = z.infer<typeof contentFormSchema>
export type ContentColumn = z.infer<typeof contentColumnSchema>
export type AccessLevel = z.infer<typeof accessLevelSchema>

export const formLabel: Record<ContentForm, string> = {
  article: "文章",
  tutorial: "教程",
  video: "视频",
  comic: "漫画",
  resource: "资源",
}

export const columnLabel: Record<ContentColumn, string> = {
  news: "动态",
  analysis: "分析",
  how_to: "方法",
  case: "案例",
}

export const accessLabel: Record<AccessLevel, string> = {
  public: "公开",
  registered: "注册可读",
}

/** Forms that have reader-facing entries in the first baseline. */
export const listedForms = ["article", "tutorial"] as const satisfies readonly ContentForm[]

export type SourceRef = {
  title: string
  url: string
}

export type EntryCard = {
  id: string
  siteId: string
  slug: string
  title: string
  summary: string
  categorySlug: string
  categoryName: string
  form: ContentForm
  column: ContentColumn
  accessLevel: AccessLevel
  publishedAt: string
  updatedAt: string
  featured: boolean
}

export type Category = {
  slug: string
  name: string
  description: string
  sort: number
  enabled: boolean
}

export type TopicSummary = {
  slug: string
  title: string
  description: string
  itemCount: number
}

export type TopicDetail = TopicSummary & {
  items: EntryCard[]
}

export type ResourceCard = {
  id: string
  title: string
  description: string
  accessLevel: AccessLevel
  entrySlug: string | null
  status: "available" | "revoked"
}

export type ListEntriesQuery = {
  siteId?: string
  category?: string
  form?: ContentForm
  column?: ContentColumn
  q?: string
  cursor?: string
  limit?: number
}

export type ListEntriesResult = {
  items: EntryCard[]
  nextCursor: string | null
}

export type EntryBodyResult =
  | { status: "visible"; markdown: string; sources: SourceRef[] }
  | { status: "locked"; summary: string }
  | { status: "not_found" }

export type ResourceAccess =
  | { status: "not_found" }
  | { status: "revoked" }
  | { status: "forbidden" }
  | { status: "not_issued"; reason: "storage_not_connected" }

export type ReaderContext = {
  userId: string | null
  emailVerified: boolean
}

export class CatalogRequestError extends Error {
  readonly code = "unavailable"

  constructor(message = "内容服务暂时不可用") {
    super(message)
    this.name = "CatalogRequestError"
  }
}

export type CatalogService = {
  source: "stub"
  listEntries(query?: ListEntriesQuery): Promise<ListEntriesResult>
  getEntry(slug: string): Promise<EntryCard | null>
  getEntryBody(slug: string, reader: ReaderContext): Promise<EntryBodyResult>
  listCategories(): Promise<Category[]>
  listTopics(): Promise<TopicSummary[]>
  getTopic(slug: string): Promise<TopicDetail | null>
  listResources(): Promise<ResourceCard[]>
  getResourceAccess(id: string, reader: ReaderContext): Promise<ResourceAccess>
}

export const anonymousReader: ReaderContext = {
  userId: null,
  emailVerified: false,
}

export function canReadRegistered(reader: ReaderContext) {
  return Boolean(reader.userId) && reader.emailVerified
}
