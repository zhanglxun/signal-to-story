import { useInfiniteQuery, useQuery } from "@tanstack/react-query"

import type { EntryQuery, SiteEntry } from "@/contracts/site"
import { getSiteService } from "@/services/site-service"

const service = () => getSiteService()

export const siteKeys = {
  site: ["site"] as const,
  entries: (query: EntryQuery) => ["site", "entries", query] as const,
  entry: (slug: string) => ["site", "entry", slug] as const,
  body: (entryId: string, revision: number) => ["site", "body", entryId, revision] as const,
}

export const useSiteInfo = () => useQuery({ queryKey: siteKeys.site, queryFn: async () => (await service()).getSite() })
export const useEntries = (query: Omit<EntryQuery, "cursor">) =>
  useInfiniteQuery({
    queryKey: siteKeys.entries(query),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => (await service()).listEntries({ ...query, cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor,
  })
export const useEntry = (slug: string) =>
  useQuery({ queryKey: siteKeys.entry(slug), queryFn: async () => (await service()).getEntry(slug) })
export const useEntryBody = (entry: SiteEntry | null | undefined) =>
  useQuery({
    queryKey: siteKeys.body(entry?.id ?? "", entry?.revision ?? 0),
    queryFn: async () => (await service()).readEntry(entry as SiteEntry),
    enabled: Boolean(entry),
  })
