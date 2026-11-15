// Reader-facing contracts. These mirror the safe column sets exposed by
// sense-console/supabase/migrations/20261116100000_create_site_publishing.sql.
// Nothing here carries back-office identifiers (organization, source document).

export const accessLevels = {
  public: "公开",
  registered: "注册可读",
} as const
export type AccessLevel = keyof typeof accessLevels

export const entryFormats = {
  article: "文章",
  tutorial: "图文教程",
  video: "视频",
  comic: "漫画",
  resource: "资源",
} as const
export type EntryFormat = keyof typeof entryFormats

export const entryColumns = {
  news: "资讯",
  analysis: "分析",
  how_to: "实操",
  case: "案例",
} as const
export type EntryColumn = keyof typeof entryColumns

export type SiteInfo = {
  id: string
  slug: string
  name: string
  description: string
  base_url: string
}

export type SiteCategory = {
  id: string
  slug: string
  name: string
  description: string
  sort_order: number
}

/** Safe card metadata; never contains the body. */
export type SiteEntry = {
  id: string
  slug: string
  title: string
  summary: string
  category_id: string | null
  format: EntryFormat
  column_key: EntryColumn | null
  cover_url: string
  cover_alt: string
  access_level: AccessLevel
  current_release_id: string
  current_version: number
  published_at: string
  updated_at: string
}

export type SiteMedia = {
  kind: "image" | "video"
  url: string
  alt?: string
  poster?: string
  caption?: string
}
export type SourceRef = { title: string; url: string }

export type SiteEntryBody = {
  markdown: string
  media: SiteMedia[]
  source_refs: SourceRef[]
}

/** Body is null when the reader is not allowed to read it (locked) — never a partial body. */
export type EntryReadResult =
  | { state: "readable"; body: SiteEntryBody }
  | { state: "locked"; reason: "login_required" | "verification_required" }

export type SiteTopic = {
  id: string
  slug: string
  title: string
  description: string
  cover_url: string
  cover_alt: string
  sort_order: number
  entry_count: number
}

export type SiteResource = {
  id: string
  entry_id: string | null
  title: string
  description: string
  file_name: string
  mime_type: string
  size_bytes: number | null
  access_level: AccessLevel
}

export type ResourceDownload =
  | { state: "granted"; url: string; expiresInSeconds: number }
  | { state: "denied"; reason: "login_required" | "verification_required" | "unavailable" }

export type EntryQuery = {
  category?: string
  format?: EntryFormat
  column?: EntryColumn
  keyword?: string
  cursor?: string | null
  limit?: number
}
export type EntryPage = { items: SiteEntry[]; nextCursor: string | null }

export type ReaderSession = {
  userId: string
  email: string
  displayName: string
  verified: boolean
}

export const DEFAULT_PAGE_SIZE = 12
export const MAX_PAGE_SIZE = 50
export const MAX_KEYWORD_LENGTH = 50

export function clampLimit(limit: number | undefined) {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE)
}

/** Stable cursor over (published_at DESC, id DESC). */
export function encodeCursor(entry: Pick<SiteEntry, "published_at" | "id">) {
  return `${entry.published_at}|${entry.id}`
}
export function decodeCursor(cursor: string | null | undefined) {
  if (!cursor) return null
  const [publishedAt, id] = cursor.split("|")
  if (!publishedAt || !id || Number.isNaN(Date.parse(publishedAt))) return null
  if (!/^[0-9a-z-]{1,64}$/i.test(id)) return null
  return { publishedAt, id }
}

/** Keyword for title/summary substring search; strips PostgREST filter syntax characters. */
export function normalizeKeyword(keyword: string | undefined) {
  return (keyword ?? "")
    .replace(/[%_,()*\\:"'.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_KEYWORD_LENGTH)
}

export function compareEntries(a: SiteEntry, b: SiteEntry) {
  if (a.published_at !== b.published_at) return a.published_at < b.published_at ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}
