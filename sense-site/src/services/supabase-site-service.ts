import type { SupabaseClient } from "@supabase/supabase-js"

import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  entryFormats,
  normalizeKeyword,
  type EntryFormat,
  type EntryPage,
  type EntryQuery,
  type SiteEntry,
  type SiteEntryBody,
} from "@/contracts/site"
import { siteEnv } from "@/lib/env"
import { isSafeMediaUrl } from "@/lib/markdown"
import { getSiteSupabase } from "@/lib/supabase"
import { SiteServiceError, type SiteService } from "@/services/site-service"

// Explicit column lists: anon's grant on content_documents is column-scoped, so `*` is denied on purpose.
export const ENTRY_COLUMNS = "id,slug,published_revision,published_title,published_meta,published_at"
const BODY_COLUMNS = "published_body,published_meta"

type PgError = { message: string; code?: string } | null

export function mapError(error: PgError): never | void {
  if (!error) return
  if (error.code === "42501") throw new SiteServiceError("forbidden", "当前没有访问此内容的权限。")
  if (error.code === "PGRST116") throw new SiteServiceError("unavailable", "内容不存在或已下线。")
  throw new SiteServiceError("network", "内容服务暂时不可用，请稍后重试。")
}

type Meta = Record<string, unknown>
type EntryRow = { id: string; slug: string; published_revision: number; published_title: string; published_meta: Meta | null; published_at: string }

const text = (v: unknown) => (typeof v === "string" ? v : "")

export function mapEntry(row: EntryRow): SiteEntry {
  const meta = row.published_meta ?? {}
  const format = text(meta.format) in entryFormats ? (text(meta.format) as EntryFormat) : "article"
  const cover = text(meta.cover_url)
  return {
    id: row.id,
    slug: row.slug,
    title: row.published_title,
    summary: text(meta.summary),
    format,
    cover_url: isSafeMediaUrl(cover) ? cover : "",
    cover_alt: text(meta.cover_alt),
    revision: Number(row.published_revision),
    published_at: row.published_at,
  }
}

export function sanitizeBody(markdown: string, meta: Meta | null): SiteEntryBody {
  const media = Array.isArray(meta?.media) ? meta.media : []
  const refs = Array.isArray(meta?.source_refs) ? meta.source_refs : []
  return {
    markdown,
    media: media.filter(
      (m): m is SiteEntryBody["media"][number] =>
        typeof m === "object" && m !== null && "url" in m && isSafeMediaUrl(String((m as { url: unknown }).url))
    ),
    source_refs: refs.filter(
      (r): r is SiteEntryBody["source_refs"][number] =>
        typeof r === "object" && r !== null && "url" in r && /^https:/i.test(String((r as { url: unknown }).url))
    ),
  }
}

export function createSupabaseSiteService(client: SupabaseClient | null = getSiteSupabase()): SiteService {
  if (!client) throw new SiteServiceError("unavailable", "站点尚未配置数据服务。")
  const db = client
  // RLS lets anon see only rows with published_at set; the explicit filter keeps the query honest.
  const published = () => {
    let request = db.from("content_documents").select(ENTRY_COLUMNS).not("published_at", "is", null)
    if (siteEnv.organizationId) request = request.eq("organization_id", siteEnv.organizationId)
    return request
  }

  return {
    mode: "supabase",

    async getSite() {
      return { name: siteEnv.siteName, description: siteEnv.siteDescription }
    },

    async listEntries(query: EntryQuery): Promise<EntryPage> {
      const limit = clampLimit(query.limit)
      let request = published()
      if (query.format) request = request.eq("published_meta->>format", query.format)
      const keyword = normalizeKeyword(query.keyword)
      if (keyword) request = request.or(`published_title.ilike.*${keyword}*,published_meta->>summary.ilike.*${keyword}*`)
      const cursor = decodeCursor(query.cursor)
      if (cursor)
        request = request.or(
          `published_at.lt.${cursor.publishedAt},and(published_at.eq.${cursor.publishedAt},id.lt.${cursor.id})`
        )
      const { data, error } = await request
        .order("published_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1)
      mapError(error)
      const rows = ((data ?? []) as EntryRow[]).map(mapEntry)
      const items = rows.slice(0, limit)
      return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null }
    },

    async getEntry(slug) {
      const { data, error } = await published().eq("slug", slug).maybeSingle()
      mapError(error)
      return data ? mapEntry(data as EntryRow) : null
    },

    async readEntry(entry) {
      const { data, error } = await db
        .from("content_documents")
        .select(BODY_COLUMNS)
        .eq("id", entry.id)
        .not("published_at", "is", null)
        .maybeSingle()
      mapError(error)
      if (!data) throw new SiteServiceError("unavailable", "内容不存在或已下线。")
      const row = data as { published_body: string; published_meta: Meta | null }
      return sanitizeBody(row.published_body, row.published_meta)
    },
  }
}
