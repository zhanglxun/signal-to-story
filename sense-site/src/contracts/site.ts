// Reader-facing contracts. These mirror the published columns that anon may read on
// public.content_documents (supabase/migrations/20261126100000_publish_on_documents.sql):
// id, slug, published_revision, published_title, published_body, published_meta, published_at.
// Nothing here carries back-office state (drafts, review notes, authors).

export const entryFormats = {
  article: "文章",
  tutorial: "图文教程",
  video: "视频",
  comic: "漫画",
  resource: "资源",
} as const
export type EntryFormat = keyof typeof entryFormats

export type SiteInfo = {
  name: string
  description: string
}

/** Safe card metadata; never contains the body. */
export type SiteEntry = {
  id: string
  slug: string
  title: string
  summary: string
  format: EntryFormat
  cover_url: string
  cover_alt: string
  /** The approved document revision this snapshot was copied from. */
  revision: number
  published_at: string
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

export type EntryQuery = {
  format?: EntryFormat
  keyword?: string
  cursor?: string | null
  limit?: number
}
export type EntryPage = { items: SiteEntry[]; nextCursor: string | null }

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
