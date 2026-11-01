import { describe, expect, it } from "vitest"

import { exploreHref, parseExploreSearch } from "@/lib/explore-query"
import { safeNextPath } from "@/lib/paths"

describe("explore query", () => {
  it("keeps valid filters and drops unknown ones", () => {
    const params = new URLSearchParams("category=tools&form=video&column=nope&q=  清单  &cursor=abc")
    expect(parseExploreSearch(params)).toEqual({
      category: "tools",
      form: "video",
      q: "清单",
      cursor: "abc",
    })
  })

  it("writes a shareable path", () => {
    expect(exploreHref({ category: "tools", q: "清单" })).toBe("/explore?category=tools&q=%E6%B8%85%E5%8D%95")
    expect(exploreHref({})).toBe("/explore")
  })
})

describe("safe next path", () => {
  it("only allows internal reader paths", () => {
    expect(safeNextPath("/content/approve-before-publish")).toBe("/content/approve-before-publish")
    expect(safeNextPath("https://evil.example")).toBe("/me")
    expect(safeNextPath("//evil.example")).toBe("/me")
    expect(safeNextPath("/login?next=/me")).toBe("/me")
  })
})
