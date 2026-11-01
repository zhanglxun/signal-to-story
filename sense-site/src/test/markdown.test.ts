import { describe, expect, it } from "vitest"

import { parseMarkdown, safeHref } from "@/lib/markdown"

describe("markdown", () => {
  it("keeps headings for the table of contents and ignores raw html execution", () => {
    const parsed = parseMarkdown("## 第一节\n\n<script>alert(1)</script>\n\n- [文档](javascript:alert(1))\n")
    expect(parsed.toc.map((item) => item.text)).toEqual(["第一节"])
    const paragraph = parsed.blocks.find((block) => block.type === "paragraph")
    expect(paragraph && paragraph.type === "paragraph" ? paragraph.inlines[0] : null).toMatchObject({
      type: "text",
      value: "<script>alert(1)</script>",
    })
    const list = parsed.blocks.find((block) => block.type === "list")
    expect(list && list.type === "list" ? list.items[0]?.[0] : null).toMatchObject({ type: "text" })
  })

  it("allows only http and https links", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a")
    expect(safeHref("http://example.com/a")).toBe("http://example.com/a")
    expect(safeHref("javascript:alert(1)")).toBeNull()
    expect(safeHref("//example.com")).toBeNull()
  })
})
