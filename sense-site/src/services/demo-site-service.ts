import {
  clampLimit,
  compareEntries,
  decodeCursor,
  encodeCursor,
  normalizeKeyword,
  type EntryQuery,
  type ReaderSession,
  type SiteEntry,
} from "@/contracts/site"
import { demoCategories, demoEntries, demoResources, demoSite, demoTopics } from "@/data/demo-snapshots"
import { safeStorage } from "@/lib/format"
import { lockReason, SiteServiceError, type SiteService } from "@/services/site-service"

const BOOKMARK_KEY = "sense-site.demo.bookmarks"
const latency = import.meta.env.MODE === "test" ? 0 : 150

const wait = () => new Promise((resolve) => setTimeout(resolve, latency))

// Mirrors RLS: only online entries are ever returned, bodies only when access allows.
const online = () => demoEntries.filter((entry) => entry.status === "online")
function toCard(entry: (typeof demoEntries)[number]): SiteEntry {
  // Strip demo-only fields so cards never carry a body.
  const { body, status, ...card } = entry
  void body
  void status
  return card
}
const canRead = (level: SiteEntry["access_level"], session: ReaderSession | null) =>
  level === "public" || Boolean(session?.verified)

function loadBookmarks(): Record<string, string[]> {
  try {
    const raw = safeStorage()?.getItem(BOOKMARK_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}
function saveBookmarks(value: Record<string, string[]>) {
  try {
    safeStorage()?.setItem(BOOKMARK_KEY, JSON.stringify(value))
  } catch {
    // Demo convenience only.
  }
}

export function createDemoSiteService(): SiteService {
  let bookmarks = loadBookmarks()

  return {
    mode: "demo",
    async getSite() {
      await wait()
      return demoSite
    },
    async listCategories() {
      await wait()
      return [...demoCategories].sort((a, b) => a.sort_order - b.sort_order)
    },
    async listEntries(query: EntryQuery) {
      await wait()
      const limit = clampLimit(query.limit)
      const category = query.category ? demoCategories.find((c) => c.slug === query.category) : null
      if (query.category && !category) return { items: [], nextCursor: null }
      const keyword = normalizeKeyword(query.keyword).toLowerCase()
      const cursor = decodeCursor(query.cursor)
      const rows = online()
        .map(toCard)
        .filter((e) => !category || e.category_id === category.id)
        .filter((e) => !query.format || e.format === query.format)
        .filter((e) => !query.column || e.column_key === query.column)
        .filter((e) => !keyword || `${e.title} ${e.summary}`.toLowerCase().includes(keyword))
        .sort(compareEntries)
        .filter(
          (e) =>
            !cursor || e.published_at < cursor.publishedAt || (e.published_at === cursor.publishedAt && e.id < cursor.id)
        )
      const items = rows.slice(0, limit)
      return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null }
    },
    async getEntry(slug) {
      await wait()
      const found = online().find((e) => e.slug === slug)
      return found ? toCard(found) : null
    },
    async getEntriesByIds(ids) {
      await wait()
      return online()
        .filter((e) => ids.includes(e.id))
        .map(toCard)
    },
    async readEntry(entry, session) {
      await wait()
      const found = online().find((e) => e.id === entry.id && e.current_release_id === entry.current_release_id)
      if (!found) throw new SiteServiceError("unavailable", "内容不存在或已下线。")
      if (!canRead(found.access_level, session)) return { state: "locked", reason: lockReason(session) }
      return { state: "readable", body: found.body }
    },
    async listTopics() {
      await wait()
      const ids = new Set(online().map((e) => e.id))
      return demoTopics.map(({ entryIds, ...topic }) => ({
        ...topic,
        entry_count: entryIds.filter((id) => ids.has(id)).length,
      }))
    },
    async getTopic(slug) {
      await wait()
      const topic = demoTopics.find((t) => t.slug === slug)
      if (!topic) return null
      const byId = new Map(online().map((e) => [e.id, toCard(e)]))
      const entries = topic.entryIds.map((id) => byId.get(id)).filter((e): e is SiteEntry => Boolean(e))
      const { entryIds, ...rest } = topic
      void entryIds
      return { topic: { ...rest, entry_count: entries.length }, entries }
    },
    async listResources() {
      await wait()
      const ids = new Set(online().map((e) => e.id))
      return demoResources.filter((r) => !r.entry_id || ids.has(r.entry_id))
    },
    async requestDownload(resource, session) {
      await wait()
      if (!canRead(resource.access_level, session)) return { state: "denied", reason: lockReason(session) }
      const text = `【演示资源】${resource.title}\n\n这是本地演示模式生成的示例文件，不是真实发布的资源。\n`
      return { state: "granted", url: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`, expiresInSeconds: 60 }
    },
    async listBookmarks(session) {
      await wait()
      const order = bookmarks[session.userId] ?? []
      const byId = new Map(online().map((e) => [e.id, toCard(e)]))
      return order.map((id) => byId.get(id)).filter((e): e is SiteEntry => Boolean(e))
    },
    async isBookmarked(session, entryId) {
      await wait()
      return (bookmarks[session.userId] ?? []).includes(entryId)
    },
    async addBookmark(session, entryId) {
      await wait()
      if (!session.verified) throw new SiteServiceError("forbidden", "请先完成邮箱验证后再收藏。")
      if (!online().some((e) => e.id === entryId)) throw new SiteServiceError("unavailable", "内容不存在或已下线。")
      const list = bookmarks[session.userId] ?? []
      if (!list.includes(entryId)) bookmarks = { ...bookmarks, [session.userId]: [entryId, ...list] }
      saveBookmarks(bookmarks)
    },
    async removeBookmark(session, entryId) {
      await wait()
      bookmarks = { ...bookmarks, [session.userId]: (bookmarks[session.userId] ?? []).filter((id) => id !== entryId) }
      saveBookmarks(bookmarks)
    },
  }
}

let instance: SiteService | null = null
export function getDemoSiteService() {
  instance ??= createDemoSiteService()
  return instance
}
