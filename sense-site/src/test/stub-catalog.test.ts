import { describe, expect, it } from "vitest"

import { anonymousReader } from "@/contracts/site"
import { createMemoryBookmarkStore } from "@/services/bookmarks"
import { createStubCatalog, decodeCursor, encodeCursor } from "@/services/stub-catalog"

const catalog = createStubCatalog()

describe("stub catalog", () => {
  it("pages published entries without returning bodies", async () => {
    const first = await catalog.listEntries({ limit: 12 })
    expect(first.items).toHaveLength(12)
    expect(first.items[0]?.slug).toBe("approve-before-publish")
    expect(first.nextCursor).toBeTruthy()
    expect("markdown" in (first.items[0] ?? {})).toBe(false)

    const second = await catalog.listEntries({ limit: 12, cursor: first.nextCursor ?? "" })
    expect(second.items.map((item) => item.slug)).toEqual(["scene-sketch"])
    expect(second.nextCursor).toBeNull()
  })

  it("locks registered bodies until the reader is verified", async () => {
    const locked = await catalog.getEntryBody("model-limits", anonymousReader)
    expect(locked.status).toBe("locked")
    if (locked.status === "locked") expect(locked.summary).toContain("模型会犯错")
    expect(JSON.stringify(locked)).not.toContain("版式占位")

    const unverified = await catalog.getEntryBody("model-limits", {
      userId: "user-1",
      emailVerified: false,
    })
    expect(unverified.status).toBe("locked")

    const visible = await catalog.getEntryBody("model-limits", {
      userId: "user-1",
      emailVerified: true,
    })
    expect(visible.status).toBe("visible")
  })

  it("hides disabled categories and empty filters", async () => {
    const categories = await catalog.listCategories()
    expect(categories.map((category) => category.slug)).not.toContain("hidden")
    const empty = await catalog.listEntries({ category: "lab" })
    expect(empty.items).toEqual([])
  })

  it("rejects a forced catalog failure and ignores a bad cursor", async () => {
    await expect(catalog.getEntry("status-error")).rejects.toThrow(/暂时不可用/)
    const page = await catalog.listEntries({ cursor: "%%%" })
    expect(page.items[0]?.id).toBe("entry-013")
  })

  it("round-trips cursors", () => {
    const encoded = encodeCursor("2026-10-20T08:00:00.000+08:00", "entry-013")
    expect(decodeCursor(encoded)).toEqual({
      publishedAt: "2026-10-20T08:00:00.000+08:00",
      id: "entry-013",
    })
    expect(decodeCursor("not-a-cursor")).toBeNull()
  })
})

describe("bookmarks", () => {
  it("keeps readers separate", () => {
    const store = createMemoryBookmarkStore()
    store.add("preview:a@example.com", "story-seed")
    store.add("preview:b@example.com", "desk-tools")
    expect(store.list("preview:a@example.com").map((item) => item.slug)).toEqual(["story-seed"])
    store.remove("preview:a@example.com", "story-seed")
    expect(store.list("preview:b@example.com")).toHaveLength(1)
  })
})
