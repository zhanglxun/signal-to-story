import { describe, expect, it } from "vitest"

import { isSafeHref, renderMarkdown } from "@/lib/markdown"

describe("renderMarkdown", () => {
  it("escapes raw HTML instead of executing it", () => {
    const { html } = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n<iframe src="https://evil.example"></iframe>')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<img[^>]*onerror/i)
    expect(html).not.toMatch(/<iframe/i)
    expect(html).toContain("&lt;script&gt;")
  })

  it("drops dangerous link protocols and hardens external links", () => {
    const { html } = renderMarkdown("[a](javascript:alert(1)) [b](data:text/html,x) [c](https://example.com) [d](/explore) [e](//evil.example)")
    expect(html).not.toMatch(/href="javascript:/i)
    expect(html).not.toMatch(/href="data:/i)
    expect(html).not.toMatch(/href="\/\/evil/i)
    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer nofollow ugc"')
    expect(html).toContain('href="/explore"')
  })

  it("only renders https images", () => {
    const { html } = renderMarkdown("![ok](https://cdn.example/a.png) ![bad](http://cdn.example/b.png) ![worse](javascript:x)")
    expect(html).toContain('src="https://cdn.example/a.png"')
    expect(html).not.toContain("http://cdn.example/b.png")
    // Rejected targets stay as inert text, never as an attribute.
    expect(html).not.toMatch(/(src|href)="javascript:/i)
  })

  it("adds unique heading ids for the table of contents", () => {
    const { html, headings } = renderMarkdown("## 背景\n\n## 背景\n\n### 细节")
    expect(headings.map((h) => h.id)).toEqual(["背景", "背景-2", "细节"])
    expect(html).toContain('<h2 id="背景">')
  })

  it("whitelists hrefs", () => {
    expect(isSafeHref("mailto:a@b.c")).toBe(true)
    expect(isSafeHref("#top")).toBe(true)
    expect(isSafeHref("vbscript:x")).toBe(false)
    expect(isSafeHref("  JAVASCRIPT:alert(1)")).toBe(false)
  })
})
