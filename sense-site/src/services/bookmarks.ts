export type BookmarkRecord = {
  slug: string
  createdAt: string
}

export type BookmarkStore = {
  list(userId: string): BookmarkRecord[]
  add(userId: string, slug: string): BookmarkRecord[]
  remove(userId: string, slug: string): BookmarkRecord[]
}

const STORAGE_KEY = "sense-site.bookmarks"

function sanitize(value: unknown): Record<string, BookmarkRecord[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const next: Record<string, BookmarkRecord[]> = {}
  for (const [userId, records] of Object.entries(value)) {
    if (!Array.isArray(records)) continue
    next[userId] = records.flatMap((record) => {
      if (!record || typeof record !== "object") return []
      const slug = "slug" in record ? record.slug : null
      const createdAt = "createdAt" in record ? record.createdAt : null
      if (typeof slug !== "string" || typeof createdAt !== "string" || !slug.trim()) return []
      return [{ slug, createdAt }]
    })
  }
  return next
}

export function createMemoryBookmarkStore(initial: Record<string, BookmarkRecord[]> = {}): BookmarkStore {
  let map = sanitize(initial)
  return {
    list(userId) {
      return [...(map[userId] ?? [])]
    },
    add(userId, slug) {
      const current = map[userId] ?? []
      if (!current.some((record) => record.slug === slug)) {
        map = {
          ...map,
          [userId]: [{ slug, createdAt: new Date().toISOString() }, ...current],
        }
      }
      return [...(map[userId] ?? [])]
    },
    remove(userId, slug) {
      map = {
        ...map,
        [userId]: (map[userId] ?? []).filter((record) => record.slug !== slug),
      }
      return [...(map[userId] ?? [])]
    },
  }
}

export function createLocalBookmarkStore(): BookmarkStore {
  const read = (): Record<string, BookmarkRecord[]> => {
    if (typeof localStorage === "undefined") return {}
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? sanitize(JSON.parse(raw) as unknown) : {}
    } catch {
      return {}
    }
  }
  const write = (map: Record<string, BookmarkRecord[]>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    } catch {
      // Ignore quota and private-mode failures. The in-memory copy still works for this view.
    }
  }
  return {
    list(userId) {
      return read()[userId] ?? []
    },
    add(userId, slug) {
      const map = read()
      const current = map[userId] ?? []
      if (!current.some((record) => record.slug === slug)) {
        map[userId] = [{ slug, createdAt: new Date().toISOString() }, ...current]
        write(map)
      }
      return map[userId] ?? []
    },
    remove(userId, slug) {
      const map = read()
      map[userId] = (map[userId] ?? []).filter((record) => record.slug !== slug)
      write(map)
      return map[userId] ?? []
    },
  }
}

export const readerBookmarks = createLocalBookmarkStore()
