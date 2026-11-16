import { beforeEach, describe, expect, it } from "vitest"

import type { ReaderSession } from "@/contracts/site"
import { demoEntries } from "@/data/demo-snapshots"
import { siteEnv } from "@/lib/env"
import { createDemoSiteService } from "@/services/demo-site-service"
import { createDemoReaderAuth } from "@/services/reader-auth-service"

const reader: ReaderSession = { userId: "u-a", email: "a@example.com", displayName: "A", verified: true }
const unverified: ReaderSession = { ...reader, userId: "u-c", verified: false }

describe("demo mode", () => {
  beforeEach(() => localStorage.clear())

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

  it("locks registered bodies for visitors and unverified readers", async () => {
    const service = createDemoSiteService()
    const entry = (await service.getEntry("ai-cost-ledger-template"))!
    expect(entry.access_level).toBe("registered")
    expect(await service.readEntry(entry, null)).toEqual({ state: "locked", reason: "login_required" })
    expect(await service.readEntry(entry, unverified)).toEqual({ state: "locked", reason: "verification_required" })
    const read = await service.readEntry(entry, reader)
    expect(read.state).toBe("readable")
  })

  it("public bodies are readable without login", async () => {
    const service = createDemoSiteService()
    const entry = (await service.getEntry("why-enterprise-agents-stall"))!
    const read = await service.readEntry(entry, null)
    expect(read.state === "readable" && read.body.markdown).toContain("任务边界")
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

  it("filters by category, format and keyword", async () => {
    const service = createDemoSiteService()
    const byCategory = await service.listEntries({ category: "enterprise-ai" })
    expect(byCategory.items.length).toBeGreaterThan(0)
    expect(byCategory.items.every((e) => e.category_id === "cat-enterprise")).toBe(true)
    expect((await service.listEntries({ format: "video" })).items.map((e) => e.format)).toEqual(["video"])
    expect((await service.listEntries({ keyword: "RAG" })).items).toHaveLength(1)
    expect((await service.listEntries({ category: "missing" })).items).toHaveLength(0)
    expect((await service.listEntries({ category: "empty-category" })).items).toHaveLength(0)
  })

  it("topics hide offline entries", async () => {
    const service = createDemoSiteService()
    const topic = await service.getTopic("enterprise-agent-path")
    expect(topic?.entries.map((e) => e.slug)).not.toContain("withdrawn-entry")
    expect(topic?.topic.entry_count).toBe(3)
  })

  it("bookmarks are per reader and require verification", async () => {
    const service = createDemoSiteService()
    await service.addBookmark(reader, "e-rag-basics")
    expect((await service.listBookmarks(reader)).map((e) => e.id)).toEqual(["e-rag-basics"])
    expect(await service.listBookmarks({ ...reader, userId: "u-b" })).toEqual([])
    await expect(service.addBookmark(unverified, "e-rag-basics")).rejects.toThrow(/邮箱验证/)
    await expect(service.addBookmark(reader, "e-offline")).rejects.toThrow(/下线/)
    await service.removeBookmark(reader, "e-rag-basics")
    expect(await service.listBookmarks(reader)).toEqual([])
  })

  it("resource download is authorized per access level", async () => {
    const service = createDemoSiteService()
    const [registered, publicResource] = await service.listResources()
    expect(await service.requestDownload(registered, null)).toEqual({ state: "denied", reason: "login_required" })
    expect((await service.requestDownload(registered, reader)).state).toBe("granted")
    expect((await service.requestDownload(publicResource, null)).state).toBe("granted")
  })

  it("demo auth validates input and signs out", async () => {
    const auth = createDemoReaderAuth()
    await expect(auth.signIn("not-an-email", "12345678")).rejects.toThrow(/邮箱/)
    await expect(auth.signIn("a@example.com", "short")).rejects.toThrow(/8 位/)
    const session = await auth.signIn("a@example.com", "12345678")
    expect(session.verified).toBe(true)
    await auth.signOut()
    expect(await auth.getSession()).toBeNull()
  })
})
