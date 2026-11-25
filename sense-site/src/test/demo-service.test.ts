import { describe, expect, it } from "vitest"

import { demoEntries } from "@/data/demo-snapshots"
import { siteEnv } from "@/lib/env"
import { createDemoSiteService } from "@/services/demo-site-service"

describe("demo mode", () => {
  it("is enabled in tests (no Supabase configured / VITE_SITE_DEMO=1)", () => {
    expect(siteEnv.isDemo).toBe(true)
    expect(siteEnv.isSupabaseConfigured).toBe(false)
  })

  it("never lists offline entries and cards carry no body", async () => {
    const service = createDemoSiteService()
    const page = await service.listEntries({ limit: 50 })
    expect(page.items.some((e) => e.slug === "withdrawn-entry")).toBe(false)
    expect(page.items.every((e) => !("body" in e) && !("status" in e))).toBe(true)
    expect(await service.getEntry("withdrawn-entry")).toBeNull()
  })

  it("bodies are readable without login", async () => {
    const service = createDemoSiteService()
    const entry = (await service.getEntry("why-enterprise-agents-stall"))!
    expect((await service.readEntry(entry)).markdown).toContain("任务边界")
  })

  it("paginates with a stable cursor without duplicates", async () => {
    const service = createDemoSiteService()
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = await service.listEntries({ limit: 2, cursor })
      seen.push(...page.items.map((e) => e.id))
      cursor = page.nextCursor
    } while (cursor)
    const online = demoEntries.filter((e) => e.status === "online").length
    expect(seen).toHaveLength(online)
    expect(new Set(seen).size).toBe(online)
  })

  it("filters by format and keyword", async () => {
    const service = createDemoSiteService()
    expect((await service.listEntries({ format: "video" })).items.map((e) => e.format)).toEqual(["video"])
    expect((await service.listEntries({ keyword: "RAG" })).items).toHaveLength(1)
  })
})
