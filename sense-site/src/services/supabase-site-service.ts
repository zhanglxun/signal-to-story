import type { SupabaseClient } from "@supabase/supabase-js"

import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  normalizeKeyword,
  type EntryPage,
  type EntryQuery,
  type SiteEntry,
  type SiteEntryBody,
  type SiteInfo,
  type SiteResource,
  type SiteTopic,
} from "@/contracts/site"
import { siteEnv } from "@/lib/env"
import { isSafeMediaUrl } from "@/lib/markdown"
import { getSiteSupabase } from "@/lib/supabase"
import { lockReason, SiteServiceError, type SiteService } from "@/services/site-service"

// Explicit column lists: the anon/authenticated grants are column-scoped, so `*` is denied on purpose.
export const ENTRY_COLUMNS =
  "id,slug,title,summary,category_id,format,column_key,cover_url,cover_alt,access_level,current_release_id,current_version,published_at,updated_at"
const SITE_COLUMNS = "id,slug,name,description,base_url"
const TOPIC_COLUMNS = "id,slug,title,description,cover_url,cover_alt,sort_order"
const RESOURCE_COLUMNS = "id,entry_id,title,description,file_name,mime_type,size_bytes,access_level"
const SIGNED_URL_SECONDS = 60

type PgError = { message: string; code?: string } | null

export function mapError(error: PgError): never | void {
  if (!error) return
  if (error.code === "42501") throw new SiteServiceError("forbidden", "当前账号没有访问此内容的权限。")
  if (error.code === "PGRST116") throw new SiteServiceError("unavailable", "内容不存在或已下线。")
  throw new SiteServiceError("network", "内容服务暂时不可用，请稍后重试。")
}

function sanitizeBody(row: { markdown: string; media: unknown; source_refs: unknown }): SiteEntryBody {
  const media = Array.isArray(row.media) ? row.media : []
  const refs = Array.isArray(row.source_refs) ? row.source_refs : []
  return {
    markdown: row.markdown,
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
  let sitePromise: Promise<SiteInfo> | null = null

  async function site() {
    sitePromise ??= (async () => {
      const { data, error } = await db.from("site_settings").select(SITE_COLUMNS).eq("slug", siteEnv.siteSlug).maybeSingle()
      mapError(error)
      if (!data) throw new SiteServiceError("unavailable", "站点尚未上线。")
      return data as SiteInfo
    })().catch((error) => {
      sitePromise = null
      throw error
    })
    return sitePromise
  }

  async function entriesByIds(ids: string[]) {
    if (!ids.length) return []
    const { id: siteId } = await site()
    const { data, error } = await db
      .from("site_entries")
      .select(ENTRY_COLUMNS)
      .eq("site_id", siteId)
      .eq("status", "online")
      .in("id", ids.slice(0, 200))
    mapError(error)
    return (data ?? []) as SiteEntry[]
  }

  return {
    mode: "supabase",
    getSite: site,

    async listCategories() {
      const { id } = await site()
      const { data, error } = await db
        .from("site_categories")
        .select("id,slug,name,description,sort_order")
        .eq("site_id", id)
        .eq("enabled", true)
        .order("sort_order")
        .order("name")
      mapError(error)
      return data ?? []
    },

    async listEntries(query: EntryQuery): Promise<EntryPage> {
      const { id: siteId } = await site()
      const limit = clampLimit(query.limit)
      let request = db
        .from("site_entries")
        .select(ENTRY_COLUMNS)
        .eq("site_id", siteId)
        .eq("status", "online")
      if (query.category) {
        const { data: category, error } = await db
          .from("site_categories")
          .select("id")
          .eq("site_id", siteId)
          .eq("slug", query.category)
          .maybeSingle()
        mapError(error)
        if (!category) return { items: [], nextCursor: null }
        request = request.eq("category_id", category.id)
      }
      if (query.format) request = request.eq("format", query.format)
      if (query.column) request = request.eq("column_key", query.column)
      const keyword = normalizeKeyword(query.keyword)
      if (keyword) request = request.or(`title.ilike.*${keyword}*,summary.ilike.*${keyword}*`)
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
      const rows = (data ?? []) as SiteEntry[]
      const items = rows.slice(0, limit)
      return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null }
    },

    async getEntry(slug) {
      const { id: siteId } = await site()
      const { data, error } = await db
        .from("site_entries")
        .select(ENTRY_COLUMNS)
        .eq("site_id", siteId)
        .eq("slug", slug)
        .eq("status", "online")
        .maybeSingle()
      mapError(error)
      return (data as SiteEntry | null) ?? null
    },

    getEntriesByIds: entriesByIds,

    async readEntry(entry, session) {
      // RLS returns the body only for the current release and an allowed access level.
      const { data, error } = await db
        .from("site_entry_bodies")
        .select("markdown,media,source_refs")
        .eq("entry_id", entry.id)
        .eq("release_id", entry.current_release_id)
        .maybeSingle()
      mapError(error)
      if (data) return { state: "readable", body: sanitizeBody(data) }
      if (entry.access_level === "public") throw new SiteServiceError("unavailable", "内容不存在或已下线。")
      return { state: "locked", reason: lockReason(session) }
    },

    async listTopics() {
      const { id: siteId } = await site()
      const [topics, items] = await Promise.all([
        db.from("site_topics").select(TOPIC_COLUMNS).eq("site_id", siteId).eq("status", "online").order("sort_order"),
        db.from("site_topic_items").select("topic_id").eq("site_id", siteId),
      ])
      mapError(topics.error)
      mapError(items.error)
      const counts = new Map<string, number>()
      for (const item of items.data ?? []) counts.set(item.topic_id, (counts.get(item.topic_id) ?? 0) + 1)
      return (topics.data ?? []).map((topic) => ({ ...topic, entry_count: counts.get(topic.id) ?? 0 })) as SiteTopic[]
    },

    async getTopic(slug) {
      const { id: siteId } = await site()
      const { data: topic, error } = await db
        .from("site_topics")
        .select(TOPIC_COLUMNS)
        .eq("site_id", siteId)
        .eq("slug", slug)
        .eq("status", "online")
        .maybeSingle()
      mapError(error)
      if (!topic) return null
      const { data: items, error: itemError } = await db
        .from("site_topic_items")
        .select("entry_id,sort_order")
        .eq("topic_id", topic.id)
        .order("sort_order")
      mapError(itemError)
      const order = (items ?? []).map((item) => item.entry_id as string)
      const entries = await entriesByIds(order)
      const byId = new Map(entries.map((entry) => [entry.id, entry]))
      const ordered = order.map((id) => byId.get(id)).filter((entry): entry is SiteEntry => Boolean(entry))
      return { topic: { ...(topic as Omit<SiteTopic, "entry_count">), entry_count: ordered.length }, entries: ordered }
    },

    async listResources() {
      const { id: siteId } = await site()
      const { data, error } = await db
        .from("site_resources")
        .select(RESOURCE_COLUMNS)
        .eq("site_id", siteId)
        .eq("status", "online")
        .order("sort_order")
      mapError(error)
      return (data ?? []) as SiteResource[]
    },

    async requestDownload(resource: SiteResource, session) {
      // The file row is only visible when RLS allows the download; storage RLS re-checks the same rule.
      const { data, error } = await db
        .from("site_resource_files")
        .select("bucket,object_path")
        .eq("resource_id", resource.id)
        .maybeSingle()
      mapError(error)
      if (!data) {
        if (resource.access_level === "public") return { state: "denied", reason: "unavailable" }
        return { state: "denied", reason: lockReason(session) }
      }
      const signed = await db.storage
        .from(data.bucket)
        .createSignedUrl(data.object_path, SIGNED_URL_SECONDS, { download: resource.file_name })
      if (signed.error || !signed.data?.signedUrl) return { state: "denied", reason: "unavailable" }
      return { state: "granted", url: signed.data.signedUrl, expiresInSeconds: SIGNED_URL_SECONDS }
    },

    async listBookmarks(session) {
      const { data, error } = await db
        .from("site_bookmarks")
        .select("entry_id,created_at")
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false })
      mapError(error)
      const order = (data ?? []).map((row) => row.entry_id as string)
      const entries = await entriesByIds(order)
      const byId = new Map(entries.map((entry) => [entry.id, entry]))
      return order.map((id) => byId.get(id)).filter((entry): entry is SiteEntry => Boolean(entry))
    },

    async isBookmarked(session, entryId) {
      const { data, error } = await db
        .from("site_bookmarks")
        .select("entry_id")
        .eq("user_id", session.userId)
        .eq("entry_id", entryId)
        .maybeSingle()
      mapError(error)
      return Boolean(data)
    },

    async addBookmark(session, entryId) {
      if (!session.verified) throw new SiteServiceError("forbidden", "请先完成邮箱验证后再收藏。")
      const { id: siteId } = await site()
      // Reader profile is created lazily; it never grants organization access.
      const profile = await db
        .from("site_readers")
        .upsert({ site_id: siteId, user_id: session.userId, display_name: session.displayName.slice(0, 80) }, {
          onConflict: "site_id,user_id",
          ignoreDuplicates: true,
        })
      mapError(profile.error)
      const { error } = await db
        .from("site_bookmarks")
        .upsert({ site_id: siteId, entry_id: entryId, user_id: session.userId }, { onConflict: "user_id,entry_id", ignoreDuplicates: true })
      mapError(error)
    },

    async removeBookmark(session, entryId) {
      const { error } = await db.from("site_bookmarks").delete().eq("user_id", session.userId).eq("entry_id", entryId)
      mapError(error)
    },
  }
}
