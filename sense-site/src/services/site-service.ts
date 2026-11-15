import type {
  EntryPage,
  EntryQuery,
  EntryReadResult,
  ReaderSession,
  ResourceDownload,
  SiteCategory,
  SiteEntry,
  SiteInfo,
  SiteResource,
  SiteTopic,
} from "@/contracts/site"
import { siteEnv } from "@/lib/env"

/**
 * One read/write surface for every page. Two implementations share it:
 * Supabase (Data API + RLS, publishable key only) and the local demo
 * (built-in sample snapshots that follow the same visibility rules).
 */
export interface SiteService {
  readonly mode: "supabase" | "demo"
  getSite(): Promise<SiteInfo>
  listCategories(): Promise<SiteCategory[]>
  listEntries(query: EntryQuery): Promise<EntryPage>
  getEntry(slug: string): Promise<SiteEntry | null>
  getEntriesByIds(ids: string[]): Promise<SiteEntry[]>
  readEntry(entry: SiteEntry, session: ReaderSession | null): Promise<EntryReadResult>
  listTopics(): Promise<SiteTopic[]>
  getTopic(slug: string): Promise<{ topic: SiteTopic; entries: SiteEntry[] } | null>
  listResources(): Promise<SiteResource[]>
  requestDownload(resource: SiteResource, session: ReaderSession | null): Promise<ResourceDownload>
  listBookmarks(session: ReaderSession): Promise<SiteEntry[]>
  isBookmarked(session: ReaderSession, entryId: string): Promise<boolean>
  addBookmark(session: ReaderSession, entryId: string): Promise<void>
  removeBookmark(session: ReaderSession, entryId: string): Promise<void>
}

export class SiteServiceError extends Error {
  readonly kind: "unavailable" | "forbidden" | "network" | "invalid"
  constructor(kind: SiteServiceError["kind"], message: string) {
    super(message)
    this.kind = kind
  }
}

export function lockReason(session: ReaderSession | null) {
  return session ? ("verification_required" as const) : ("login_required" as const)
}

let override: SiteService | null = null
let cached: Promise<SiteService> | null = null

export async function getSiteService(): Promise<SiteService> {
  if (override) return override
  cached ??= siteEnv.isDemo
    ? import("@/services/demo-site-service").then((m) => m.getDemoSiteService())
    : import("@/services/supabase-site-service").then((m) => m.createSupabaseSiteService())
  return cached
}

/** Test hook: replace the active implementation. */
export function setSiteServiceForTests(service: SiteService | null) {
  override = service
  cached = null
}
