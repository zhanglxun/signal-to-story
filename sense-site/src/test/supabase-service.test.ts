import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import type { SiteEntry, SiteResource } from "@/contracts/site"
import { createSupabaseSiteService, ENTRY_COLUMNS } from "@/services/supabase-site-service"

type Result = { data: unknown; error: { message: string; code?: string } | null }
type Call = { table: string; method: string; args: unknown[] }

/** Minimal recording stand-in for supabase-js; returns canned results per table. */
function fakeClient(results: Record<string, Result | Result[]>, signed: Result = { data: { signedUrl: "https://signed.example/x" }, error: null }) {
  const calls: Call[] = []
  const queue = new Map(Object.entries(results).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]))
  const next = (table: string): Result => {
    const list = queue.get(table) ?? [{ data: null, error: null }]
    return list.length > 1 ? list.shift()! : list[0]
  }
  const builder = (table: string) => {
    const proxy: Record<string, unknown> = {}
    for (const method of ["select", "eq", "in", "or", "order", "limit", "upsert", "delete", "insert"])
      proxy[method] = (...args: unknown[]) => {
        calls.push({ table, method, args })
        return proxy
      }
    proxy.maybeSingle = () => {
      calls.push({ table, method: "maybeSingle", args: [] })
      return Promise.resolve(next(table))
    }
    proxy.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(next(table)).then(resolve, reject)
    return proxy
  }
  const client = {
    from: (table: string) => builder(table),
    storage: { from: (bucket: string) => ({ createSignedUrl: (...args: unknown[]) => (calls.push({ table: `storage:${bucket}`, method: "createSignedUrl", args }), Promise.resolve(signed)) }) },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

const site = { data: { id: "site-1", slug: "signal-to-story", name: "S", description: "", base_url: "" }, error: null }
const entry: SiteEntry = {
  id: "e1", slug: "a", title: "A", summary: "S", category_id: null, format: "article", column_key: null, cover_url: "", cover_alt: "",
  access_level: "registered", current_release_id: "r1", current_version: 1, published_at: "2026-11-10T00:00:00+00:00", updated_at: "2026-11-10T00:00:00+00:00",
}

describe("supabase site service", () => {
  it("selects explicit safe columns and only online entries", async () => {
    const { client, calls } = fakeClient({ site_settings: site, site_entries: { data: [entry], error: null } })
    const page = await createSupabaseSiteService(client).listEntries({ limit: 12 })
    expect(page.items).toHaveLength(1)
    const select = calls.find((c) => c.table === "site_entries" && c.method === "select")!
    expect(select.args[0]).toBe(ENTRY_COLUMNS)
    expect(String(select.args[0])).not.toMatch(/organization_id|source_document_id|\*/)
    expect(calls).toContainEqual({ table: "site_entries", method: "eq", args: ["status", "online"] })
    expect(calls).toContainEqual({ table: "site_entries", method: "limit", args: [13] })
  })

  it("sanitizes keywords before building PostgREST filters", async () => {
    const { client, calls } = fakeClient({ site_settings: site, site_entries: { data: [], error: null } })
    await createSupabaseSiteService(client).listEntries({ keyword: "a,b),status.eq.offline" })
    const or = calls.find((c) => c.method === "or")!
    expect(String(or.args[0])).not.toMatch(/[(),].*status\.eq/)
    expect(String(or.args[0])).toBe("title.ilike.*a b status eq offline*,summary.ilike.*a b status eq offline*")
  })

  it("reports locked registered content when RLS returns no body", async () => {
    const { client } = fakeClient({ site_settings: site, site_entry_bodies: { data: null, error: null } })
    const service = createSupabaseSiteService(client)
    expect(await service.readEntry(entry, null)).toEqual({ state: "locked", reason: "login_required" })
    expect(await service.readEntry(entry, { userId: "u", email: "", displayName: "", verified: false })).toEqual({ state: "locked", reason: "verification_required" })
  })

  it("filters unsafe media out of bodies", async () => {
    const body = { markdown: "x", media: [{ kind: "video", url: "javascript:alert(1)" }, { kind: "video", url: "https://v.example/a.mp4" }], source_refs: [{ title: "t", url: "http://x" }] }
    const { client } = fakeClient({ site_settings: site, site_entry_bodies: { data: body, error: null } })
    const read = await createSupabaseSiteService(client).readEntry({ ...entry, access_level: "public" }, null)
    expect(read.state === "readable" && read.body.media.map((m) => m.url)).toEqual(["https://v.example/a.mp4"])
    expect(read.state === "readable" && read.body.source_refs).toEqual([])
  })

  it("signs a short-lived URL only when the file row is visible", async () => {
    const resource: SiteResource = { id: "res", entry_id: null, title: "T", description: "", file_name: "t.zip", mime_type: "", size_bytes: null, access_level: "registered" }
    const denied = fakeClient({ site_settings: site, site_resource_files: { data: null, error: null } })
    expect(await createSupabaseSiteService(denied.client).requestDownload(resource, null)).toEqual({ state: "denied", reason: "login_required" })
    expect(denied.calls.some((c) => c.method === "createSignedUrl")).toBe(false)
    const granted = fakeClient({ site_settings: site, site_resource_files: { data: { bucket: "site-resources", object_path: "o/s/t.zip" }, error: null } })
    const result = await createSupabaseSiteService(granted.client).requestDownload(resource, null)
    expect(result).toEqual({ state: "granted", url: "https://signed.example/x", expiresInSeconds: 60 })
    expect(granted.calls.find((c) => c.method === "createSignedUrl")?.args).toEqual(["o/s/t.zip", 60, { download: "t.zip" }])
  })

  it("maps database errors to reader-safe messages", async () => {
    const { client } = fakeClient({ site_settings: { data: null, error: { message: "relation internal_x does not exist", code: "42P01" } } })
    await expect(createSupabaseSiteService(client).getSite()).rejects.toThrow("内容服务暂时不可用，请稍后重试。")
  })

  it("treats an unpublished site as unavailable", async () => {
    const { client } = fakeClient({ site_settings: { data: null, error: null } })
    await expect(createSupabaseSiteService(client).listCategories()).rejects.toThrow("站点尚未上线。")
  })
})
