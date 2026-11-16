import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { EntryQuery, ReaderSession, SiteEntry } from "@/contracts/site"
import { getSiteService } from "@/services/site-service"

const service = () => getSiteService()

export const siteKeys = {
  site: ["site"] as const,
  categories: ["site", "categories"] as const,
  entries: (query: EntryQuery) => ["site", "entries", query] as const,
  entry: (slug: string) => ["site", "entry", slug] as const,
  topics: ["site", "topics"] as const,
  topic: (slug: string) => ["site", "topic", slug] as const,
  resources: ["site", "resources"] as const,
  // Reader-scoped keys live under "reader" and are dropped on identity change.
  body: (userId: string | null, entryId: string, releaseId: string) => ["reader", userId, "body", entryId, releaseId] as const,
  bookmarks: (userId: string) => ["reader", userId, "bookmarks"] as const,
  bookmarked: (userId: string, entryId: string) => ["reader", userId, "bookmarked", entryId] as const,
}

export const useSiteInfo = () => useQuery({ queryKey: siteKeys.site, queryFn: async () => (await service()).getSite() })
export const useCategories = () =>
  useQuery({ queryKey: siteKeys.categories, queryFn: async () => (await service()).listCategories() })
export const useEntries = (query: Omit<EntryQuery, "cursor">) =>
  useInfiniteQuery({
    queryKey: siteKeys.entries(query),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => (await service()).listEntries({ ...query, cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor,
  })
export const useEntry = (slug: string) =>
  useQuery({ queryKey: siteKeys.entry(slug), queryFn: async () => (await service()).getEntry(slug) })
export const useEntryBody = (entry: SiteEntry | null | undefined, session: ReaderSession | null, enabled = true) =>
  useQuery({
    queryKey: siteKeys.body(session?.userId ?? null, entry?.id ?? "", entry?.current_release_id ?? ""),
    queryFn: async () => (await service()).readEntry(entry as SiteEntry, session),
    enabled: Boolean(entry) && enabled,
    // Registered bodies are personal data: never keep them around after leaving the page.
    gcTime: 0,
  })
export const useTopics = () => useQuery({ queryKey: siteKeys.topics, queryFn: async () => (await service()).listTopics() })
export const useTopic = (slug: string) =>
  useQuery({ queryKey: siteKeys.topic(slug), queryFn: async () => (await service()).getTopic(slug) })
export const useResources = () =>
  useQuery({ queryKey: siteKeys.resources, queryFn: async () => (await service()).listResources() })
export const useBookmarks = (session: ReaderSession | null) =>
  useQuery({
    queryKey: siteKeys.bookmarks(session?.userId ?? ""),
    queryFn: async () => (await service()).listBookmarks(session as ReaderSession),
    enabled: Boolean(session),
  })
export const useIsBookmarked = (session: ReaderSession | null, entryId: string | undefined) =>
  useQuery({
    queryKey: siteKeys.bookmarked(session?.userId ?? "", entryId ?? ""),
    queryFn: async () => (await service()).isBookmarked(session as ReaderSession, entryId as string),
    enabled: Boolean(session && entryId),
  })

export function useToggleBookmark(session: ReaderSession | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ entryId, bookmarked }: { entryId: string; bookmarked: boolean }) => {
      if (!session) throw new Error("请先登录。")
      const api = await service()
      if (bookmarked) await api.removeBookmark(session, entryId)
      else await api.addBookmark(session, entryId)
    },
    onSuccess: (_data, { entryId }) => {
      if (!session) return
      void queryClient.invalidateQueries({ queryKey: siteKeys.bookmarks(session.userId) })
      void queryClient.invalidateQueries({ queryKey: siteKeys.bookmarked(session.userId, entryId) })
    },
  })
}
