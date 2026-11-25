import {
  clampLimit,
  compareEntries,
  decodeCursor,
  encodeCursor,
  normalizeKeyword,
  type EntryQuery,
  type SiteEntry,
} from "@/contracts/site"
import { demoEntries, demoSite } from "@/data/demo-snapshots"
import { SiteServiceError, type SiteService } from "@/services/site-service"

const latency = import.meta.env.MODE === "test" ? 0 : 150
const wait = () => new Promise((resolve) => setTimeout(resolve, latency))

// Mirrors RLS: only published (online) entries are ever returned.
const online = () => demoEntries.filter((entry) => entry.status === "online")
function toCard(entry: (typeof demoEntries)[number]): SiteEntry {
  // Strip demo-only fields so cards never carry a body.
  const { body, status, ...card } = entry
  void body
  void status
  return card
}

export function createDemoSiteService(): SiteService {
  return {
    mode: "demo",
    async getSite() {
      await wait()
      return demoSite
    },
    async listEntries(query: EntryQuery) {
      await wait()
      const keyword = normalizeKeyword(query.keyword).toLowerCase()
      const cursor = decodeCursor(query.cursor)
      const limit = clampLimit(query.limit)
      const rows = online()
        .filter((e) => !query.format || e.format === query.format)
        .filter((e) => !keyword || e.title.toLowerCase().includes(keyword) || e.summary.toLowerCase().includes(keyword))
        .map(toCard)
        .sort(compareEntries)
        .filter((e) => !cursor || e.published_at < cursor.publishedAt || (e.published_at === cursor.publishedAt && e.id < cursor.id))
      const items = rows.slice(0, limit)
      return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null }
    },
    async getEntry(slug) {
      await wait()
      const found = online().find((e) => e.slug === slug)
      return found ? toCard(found) : null
    },
    async readEntry(entry) {
      await wait()
      const found = online().find((e) => e.id === entry.id)
      if (!found) throw new SiteServiceError("unavailable", "内容不存在或已下线。")
      return found.body
    },
  }
}

let instance: SiteService | null = null
export function getDemoSiteService() {
  instance ??= createDemoSiteService()
  return instance
}
