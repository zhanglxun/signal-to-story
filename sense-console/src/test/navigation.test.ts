import { describe, expect, it } from "vitest"

import { navigationConfig, resolveNavigation } from "@/config/navigation"

describe("console navigation", () => {
  it("keeps the JSON menu at two levels with unique ids and paths", () => {
    const moduleIds = navigationConfig.modules.map((module) => module.id)
    const groups = navigationConfig.modules.flatMap((module) => module.groups)
    const items = groups.flatMap((group) => group.items)

    expect(new Set(moduleIds).size).toBe(moduleIds.length)
    expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length)
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
    expect(new Set(items.map((item) => item.path)).size).toBe(items.length)
    expect(items.every((item) => !("children" in item))).toBe(true)
  })

  it("inherits the parent menu for detail routes", () => {
    expect(resolveNavigation("/assets/42").activeItem?.id).toBe("assets")
    expect(resolveNavigation("/topics/topic-1").activeItem?.id).toBe("topics")
    expect(resolveNavigation("/tasks/task-1").activeItem?.id).toBe("tasks")
  })

  it("assigns account settings to the system module without adding a menu item", () => {
    const resolved = resolveNavigation("/account")
    expect(resolved.activeModule.id).toBe("system")
    expect(resolved.activeItem).toBeUndefined()
  })
})
