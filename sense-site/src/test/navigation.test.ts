import { describe, expect, it } from "vitest"

import { activeNavId, primaryNav } from "@/config/navigation"

describe("reader navigation", () => {
  it("stays at one clickable level", () => {
    expect(primaryNav.map((item) => item.label)).toEqual(["首页", "探索", "专题", "资源库", "我的"])
    expect(primaryNav.every((item) => !("children" in item))).toBe(true)
    expect(new Set(primaryNav.map((item) => item.to)).size).toBe(primaryNav.length)
  })

  it("highlights the parent item for detail routes", () => {
    expect(activeNavId("/")).toBe("home")
    expect(activeNavId("/content/approve-before-publish")).toBe("explore")
    expect(activeNavId("/topics/practice")).toBe("topics")
    expect(activeNavId("/login")).toBeNull()
  })
})
