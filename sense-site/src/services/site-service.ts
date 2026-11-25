import type { EntryPage, EntryQuery, SiteEntry, SiteEntryBody, SiteInfo } from "@/contracts/site"
import { siteEnv } from "@/lib/env"

/**
 * One read surface for every page. Two implementations share it:
 * Supabase (Data API + RLS, publishable key only, anon) and the local demo
 * (built-in sample snapshots that follow the same visibility rules).
 */
export interface SiteService {
  readonly mode: "supabase" | "demo"
  getSite(): Promise<SiteInfo>
  listEntries(query: EntryQuery): Promise<EntryPage>
  getEntry(slug: string): Promise<SiteEntry | null>
  readEntry(entry: SiteEntry): Promise<SiteEntryBody>
}

export class SiteServiceError extends Error {
  readonly kind: "unavailable" | "forbidden" | "network" | "invalid"
  constructor(kind: SiteServiceError["kind"], message: string) {
    super(message)
    this.kind = kind
  }
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
