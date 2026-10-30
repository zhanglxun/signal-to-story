import {
  CatalogRequestError,
  DEFAULT_SITE_ID,
  ENTRY_PAGE_MAX,
  ENTRY_PAGE_SIZE,
  accessLevelSchema,
  canReadRegistered,
  contentColumnSchema,
  contentFormSchema,
  type CatalogService,
  type Category,
  type EntryCard,
  type EntryBodyResult,
  type ListEntriesQuery,
  type ReaderContext,
  type ResourceAccess,
  type ResourceCard,
  type SourceRef,
  type TopicDetail,
  type TopicSummary,
} from "@/contracts/site"
import { decodeCursor, encodeCursor } from "@/services/cursor"
import { getSupabaseClient } from "@/lib/supabase"

type CategoryJoin = { slug: string; name: string }

type EntryRow = {
  id: string
  site_id: string
  slug: string
  title: string
  summary: string
  form: string
  content_column: string
  cover_url: string
  access_level: string
  featured: boolean
  published_at: string | null
  updated_at: string
  current_version: number | null
  site_categories: CategoryJoin | CategoryJoin[] | null
}

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new CatalogRequestError("内容服务暂时不可用")
}

function normalizeLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) return ENTRY_PAGE_SIZE
  return Math.min(ENTRY_PAGE_MAX, Math.max(1, Math.floor(limit)))
}

function categoryOf(row: EntryRow): CategoryJoin | null {
  const join = row.site_categories
  if (!join) return null
  return Array.isArray(join) ? (join[0] ?? null) : join
}

function mapEntry(row: EntryRow): EntryCard | null {
  const category = categoryOf(row)
  const form = contentFormSchema.safeParse(row.form)
  const column = contentColumnSchema.safeParse(row.content_column)
  const access = accessLevelSchema.safeParse(row.access_level)
  if (!category || !form.success || !column.success || !access.success || !row.published_at) {
    return null
  }
  return {
    id: row.id,
    siteId: row.site_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    categorySlug: category.slug,
    categoryName: category.name,
    form: form.data,
    column: column.data,
    accessLevel: access.data,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    featured: row.featured,
  }
}

function parseSources(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) return []
  const out: SourceRef[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const title = "title" in item && typeof item.title === "string" ? item.title.trim() : ""
    const url = "url" in item && typeof item.url === "string" ? item.url.trim() : ""
    if (!title || !url) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue
      out.push({ title: title.slice(0, 200), url })
    } catch {
      continue
    }
  }
  return out
}

const entrySelect =
  "id, site_id, slug, title, summary, form, content_column, cover_url, access_level, featured, published_at, updated_at, current_version, site_categories!inner(slug, name)"

export function createSupabaseCatalog(siteId = DEFAULT_SITE_ID): CatalogService {
  const client = getSupabaseClient()
  if (!client) {
    throw new Error("Supabase 未配置")
  }

  return {
    source: "supabase",
    async listEntries(query: ListEntriesQuery = {}) {
      const resolvedSite = query.siteId ?? siteId
      const limit = normalizeLimit(query.limit)
      let request = client
        .from("site_entries")
        .select(entrySelect)
        .eq("site_id", resolvedSite)
        .eq("status", "published")
        .eq("site_categories.enabled", true)
        .order("published_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit + 1)

      if (query.category) request = request.eq("site_categories.slug", query.category)
      if (query.form) request = request.eq("form", query.form)
      if (query.column) request = request.eq("content_column", query.column)
      const q = query.q?.trim().slice(0, 80)
      if (q) {
        const escaped = q.replaceAll(/[%_,]/g, " ")
        request = request.or(`title.ilike.%${escaped}%,summary.ilike.%${escaped}%`)
      }
      const cursor = query.cursor ? decodeCursor(query.cursor) : null
      if (cursor) {
        request = request.or(
          `published_at.lt.${cursor.publishedAt},and(published_at.eq.${cursor.publishedAt},id.lt.${cursor.id})`,
        )
      }

      const { data, error } = await request
      fail(error)
      const mapped = ((data ?? []) as EntryRow[]).flatMap((row) => {
        const entry = mapEntry(row)
        return entry ? [entry] : []
      })
      const items = mapped.slice(0, limit)
      const last = items.at(-1)
      const nextCursor =
        last && mapped.length > limit ? encodeCursor(last.publishedAt, last.id) : null
      return { items, nextCursor }
    },

    async getEntry(slug) {
      const { data, error } = await client
        .from("site_entries")
        .select(entrySelect)
        .eq("site_id", siteId)
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle()
      fail(error)
      if (!data) return null
      return mapEntry(data as EntryRow)
    },

    async getEntryBody(slug, reader: ReaderContext): Promise<EntryBodyResult> {
      const entry = await this.getEntry(slug)
      if (!entry) return { status: "not_found" }
      if (entry.accessLevel === "member") {
        return { status: "locked", summary: entry.summary }
      }
      if (entry.accessLevel === "registered" && !canReadRegistered(reader)) {
        return { status: "locked", summary: entry.summary }
      }
      const { data: meta, error: metaError } = await client
        .from("site_entries")
        .select("id, current_version")
        .eq("site_id", siteId)
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle()
      fail(metaError)
      if (!meta?.current_version) return { status: "not_found" }

      const { data: body, error: bodyError } = await client
        .from("site_entry_bodies")
        .select("markdown, sources")
        .eq("entry_id", meta.id)
        .eq("version", meta.current_version)
        .maybeSingle()
      fail(bodyError)
      if (!body || typeof body.markdown !== "string") {
        // RLS may hide body → treat as locked when access is restricted
        if (entry.accessLevel !== "public") {
          return { status: "locked", summary: entry.summary }
        }
        return { status: "not_found" }
      }
      return {
        status: "visible",
        markdown: body.markdown,
        sources: parseSources(body.sources),
      }
    },

    async listCategories(): Promise<Category[]> {
      const { data, error } = await client
        .from("site_categories")
        .select("slug, name, description, sort_order, enabled")
        .eq("site_id", siteId)
        .eq("enabled", true)
        .order("sort_order", { ascending: true })
      fail(error)
      return (data ?? []).map((row) => ({
        slug: row.slug as string,
        name: row.name as string,
        description: (row.description as string) ?? "",
        sort: row.sort_order as number,
        enabled: Boolean(row.enabled),
      }))
    },

    async listTopics(): Promise<TopicSummary[]> {
      const { data, error } = await client
        .from("site_topics")
        .select("id, slug, title, description, site_topic_items(entry_id)")
        .eq("site_id", siteId)
        .eq("status", "published")
        .order("sort_order", { ascending: true })
      fail(error)
      return (data ?? []).map((row) => {
        const items = Array.isArray(row.site_topic_items) ? row.site_topic_items : []
        return {
          slug: row.slug as string,
          title: row.title as string,
          description: (row.description as string) ?? "",
          itemCount: items.length,
        }
      })
    },

    async getTopic(slug): Promise<TopicDetail | null> {
      const { data, error } = await client
        .from("site_topics")
        .select(
          "slug, title, description, site_topic_items(sort_order, entry_id, site_entries!inner(id, site_id, slug, title, summary, form, content_column, cover_url, access_level, featured, published_at, updated_at, current_version, status, site_categories!inner(slug, name)))",
        )
        .eq("site_id", siteId)
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle()
      fail(error)
      if (!data) return null
      const rawItems = Array.isArray(data.site_topic_items) ? data.site_topic_items : []
      const sorted = [...rawItems].sort(
        (a, b) => Number((a as { sort_order?: number }).sort_order ?? 0) - Number((b as { sort_order?: number }).sort_order ?? 0),
      )
      const items: EntryCard[] = []
      for (const item of sorted) {
        const entryRaw = (item as { site_entries?: EntryRow | EntryRow[] }).site_entries
        const row = Array.isArray(entryRaw) ? entryRaw[0] : entryRaw
        if (!row || (row as { status?: string }).status !== "published") continue
        const mapped = mapEntry(row)
        if (mapped) items.push(mapped)
      }
      return {
        slug: data.slug as string,
        title: data.title as string,
        description: (data.description as string) ?? "",
        itemCount: items.length,
        items,
      }
    },

    async listResources(): Promise<ResourceCard[]> {
      const { data, error } = await client
        .from("site_resources")
        .select("id, title, description, access_level, status, entry_id, site_entries(slug)")
        .eq("site_id", siteId)
        .eq("status", "available")
        .order("updated_at", { ascending: false })
      fail(error)
      return (data ?? []).flatMap((row) => {
        const access = accessLevelSchema.safeParse(row.access_level)
        if (!access.success) return []
        const join = row.site_entries as { slug: string } | { slug: string }[] | null
        const entry = Array.isArray(join) ? join[0] : join
        return [
          {
            id: row.id as string,
            title: row.title as string,
            description: (row.description as string) ?? "",
            accessLevel: access.data,
            entrySlug: entry?.slug ?? null,
            status: "available" as const,
          },
        ]
      })
    },

    async getResourceAccess(id, reader): Promise<ResourceAccess> {
      const { data, error } = await client
        .from("site_resources")
        .select("id, access_level, status")
        .eq("id", id)
        .eq("site_id", siteId)
        .maybeSingle()
      fail(error)
      if (!data) return { status: "not_found" }
      if (data.status === "revoked") return { status: "revoked" }
      if (data.status !== "available") return { status: "not_found" }
      if (data.access_level === "member") return { status: "forbidden" }
      if (data.access_level === "registered" && !canReadRegistered(reader)) {
        return { status: "forbidden" }
      }
      return { status: "not_issued", reason: "storage_not_connected" }
    },
  }
}

export function createDisconnectedCatalog(): CatalogService {
  const unavailable = async () => {
    throw new CatalogRequestError("未连接数据库。请配置 VITE_SUPABASE_URL 与 anon/publishable key。")
  }
  return {
    source: "disconnected",
    listEntries: unavailable,
    getEntry: unavailable,
    getEntryBody: unavailable,
    listCategories: unavailable,
    listTopics: unavailable,
    getTopic: unavailable,
    listResources: unavailable,
    getResourceAccess: unavailable,
  }
}
