import {
  CatalogRequestError,
  DEFAULT_SITE_ID,
  ENTRY_PAGE_MAX,
  ENTRY_PAGE_SIZE,
  canReadRegistered,
  type CatalogService,
  type EntryCard,
  type ListEntriesQuery,
  type ReaderContext,
} from "@/contracts/site"
import {
  CATALOG_ERROR_SLUG,
  fixtureBodies,
  fixtureCategories,
  fixtureEntries,
  fixtureResources,
  fixtureTopics,
} from "@/services/fixtures"

type Cursor = { publishedAt: string; id: string }

export function encodeCursor(publishedAt: string, id: string) {
  const bytes = new TextEncoder().encode(JSON.stringify([publishedAt, id]))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

export function decodeCursor(value: string): Cursor | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [publishedAt, id] = parsed
    if (typeof publishedAt !== "string" || typeof id !== "string") return null
    return { publishedAt, id }
  } catch {
    return null
  }
}

function normalizeLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) return ENTRY_PAGE_SIZE
  return Math.min(ENTRY_PAGE_MAX, Math.max(1, Math.floor(limit)))
}

function compareDesc(a: EntryCard, b: EntryCard) {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1
  if (a.id !== b.id) return a.id < b.id ? 1 : -1
  return 0
}

function isAfterCursor(entry: EntryCard, cursor: Cursor) {
  if (entry.publishedAt !== cursor.publishedAt) return entry.publishedAt < cursor.publishedAt
  return entry.id < cursor.id
}

function findEntry(slug: string) {
  return fixtureEntries.find((entry) => entry.slug === slug) ?? null
}

export function createStubCatalog(): CatalogService {
  return {
    source: "stub",
    async listEntries(query: ListEntriesQuery = {}) {
      const siteId = query.siteId ?? DEFAULT_SITE_ID
      if (siteId !== DEFAULT_SITE_ID) return { items: [], nextCursor: null }
      const q = query.q?.trim().slice(0, 80).toLocaleLowerCase("zh-CN")
      const matched = fixtureEntries
        .filter((entry) => entry.siteId === siteId)
        .filter((entry) => (query.category ? entry.categorySlug === query.category : true))
        .filter((entry) => (query.form ? entry.form === query.form : true))
        .filter((entry) => (query.column ? entry.column === query.column : true))
        .filter((entry) => {
          if (!q) return true
          return `${entry.title}\n${entry.summary}`.toLocaleLowerCase("zh-CN").includes(q)
        })
        .sort(compareDesc)

      const cursor = query.cursor ? decodeCursor(query.cursor) : null
      const filtered = cursor ? matched.filter((entry) => isAfterCursor(entry, cursor)) : matched
      const limit = normalizeLimit(query.limit)
      const items = filtered.slice(0, limit)
      const last = items.at(-1)
      const nextCursor =
        last && filtered.length > limit ? encodeCursor(last.publishedAt, last.id) : null
      return { items, nextCursor }
    },
    async getEntry(slug) {
      if (slug === CATALOG_ERROR_SLUG) {
        throw new CatalogRequestError("内容服务暂时不可用")
      }
      return findEntry(slug)
    },
    async getEntryBody(slug, reader: ReaderContext) {
      if (slug === CATALOG_ERROR_SLUG) {
        throw new CatalogRequestError("内容服务暂时不可用")
      }
      const entry = findEntry(slug)
      if (!entry) return { status: "not_found" }
      if (entry.accessLevel === "registered" && !canReadRegistered(reader)) {
        return { status: "locked", summary: entry.summary }
      }
      const body = fixtureBodies.get(slug)
      if (!body) return { status: "not_found" }
      return { status: "visible", markdown: body.markdown, sources: body.sources }
    },
    async listCategories() {
      return fixtureCategories
        .filter((category) => category.enabled)
        .sort((a, b) => a.sort - b.sort)
    },
    async listTopics() {
      return fixtureTopics.map((topic) => ({
        slug: topic.slug,
        title: topic.title,
        description: topic.description,
        itemCount: topic.itemSlugs.filter((slug) => findEntry(slug)).length,
      }))
    },
    async getTopic(slug) {
      const topic = fixtureTopics.find((item) => item.slug === slug)
      if (!topic) return null
      const items = topic.itemSlugs.flatMap((itemSlug) => {
        const entry = findEntry(itemSlug)
        return entry ? [entry] : []
      })
      return {
        slug: topic.slug,
        title: topic.title,
        description: topic.description,
        itemCount: items.length,
        items,
      }
    },
    async listResources() {
      return fixtureResources
    },
    async getResourceAccess(id, reader) {
      const resource = fixtureResources.find((item) => item.id === id)
      if (!resource) return { status: "not_found" }
      if (resource.status === "revoked") return { status: "revoked" }
      if (resource.accessLevel === "registered" && !canReadRegistered(reader)) {
        return { status: "forbidden" }
      }
      return { status: "not_issued", reason: "storage_not_connected" }
    },
  }
}
