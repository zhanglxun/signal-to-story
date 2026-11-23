import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import type { SiteEntry } from "@/contracts/site"
import { createSupabaseSiteService, ENTRY_COLUMNS, mapEntry } from "@/services/supabase-site-service"

type Result = { data: unknown; error: { message: string; code?: string } | null }
type Call = { table: string; method: string; args: unknown[] }

/** Minimal recording stand-in for supabase-js; returns canned results per table. */
function fakeClient(results: Record<string, Result | Result[]>) {
  const calls: Call[] = []
  const queue = new Map(Object.entries(results).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]))
  const next = (table: string): Result => {
    const list = queue.get(table) ?? [{ data: null, error: null }]
    return list.length > 1 ? list.shift()! : list[0]
  }
  const builder = (table: string) => {
    const proxy: Record<string, unknown> = {}
    for (const method of ["select", "eq", "not", "in", "or", "order", "limit"])
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
  return { client: { from: (table: string) => builder(table) } as unknown as SupabaseClient, calls }
}

const row = {
  id: "e1", slug: "a", published_revision: 3, published_title: "A", published_at: "2026-11-10T00:00:00+00:00",
  published_meta: { summary: "S", format: "video", cover_url: "javascript:alert(1)", cover_alt: "x" },
}
const entry: SiteEntry = mapEntry(row)

describe("supabase site service", () => {
  it("maps published columns into a card, dropping unsafe covers", () => {
    expect(entry).toEqual({ id: "e1", slug: "a", title: "A", summary: "S", format: "video", cover_url: "", cover_alt: "x", revision: 3, published_at: row.published_at })
  })

  it("selects explicit published columns and only published rows", async () => {
    const { client, calls } = fakeClient({ content_documents: { data: [row], error: null } })
    const page = await createSupabaseSiteService(client).listEntries({ limit: 12 })
    expect(page.items).toHaveLength(1)
    const select = calls.find((c) => c.method === "select")!
    expect(select.args[0]).toBe(ENTRY_COLUMNS)
    expect(String(select.args[0])).not.toMatch(/\bbody\b|review_note|\*/)
    expect(calls).toContainEqual({ table: "content_documents", method: "not", args: ["published_at", "is", null] })
    expect(calls).toContainEqual({ table: "content_documents", method: "limit", args: [13] })
  })

  it("sanitizes keywords before building PostgREST filters", async () => {
    const { client, calls } = fakeClient({ content_documents: { data: [], error: null } })
    await createSupabaseSiteService(client).listEntries({ keyword: "a,b),published_at.is.null" })
    const or = calls.find((c) => c.method === "or")!
    expect(String(or.args[0])).toBe("published_title.ilike.*a b published at is null*,published_meta->>summary.ilike.*a b published at is null*")
  })

  it("filters unsafe media out of bodies", async () => {
    const meta = { media: [{ kind: "video", url: "javascript:alert(1)" }, { kind: "video", url: "https://v.example/a.mp4" }], source_refs: [{ title: "t", url: "http://x" }] }
    const { client } = fakeClient({ content_documents: { data: { published_body: "x", published_meta: meta }, error: null } })
    const body = await createSupabaseSiteService(client).readEntry(entry)
    expect(body.media.map((m) => m.url)).toEqual(["https://v.example/a.mp4"])
    expect(body.source_refs).toEqual([])
  })

  it("treats a missing body as unpublished", async () => {
    const { client } = fakeClient({ content_documents: { data: null, error: null } })
    await expect(createSupabaseSiteService(client).readEntry(entry)).rejects.toThrow("内容不存在或已下线。")
  })

  it("maps database errors to reader-safe messages", async () => {
    const { client } = fakeClient({ content_documents: { data: null, error: { message: "relation internal_x does not exist", code: "42P01" } } })
    await expect(createSupabaseSiteService(client).listEntries({})).rejects.toThrow("内容服务暂时不可用，请稍后重试。")
  })
})
