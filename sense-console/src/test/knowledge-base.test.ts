import { describe, expect, it } from "vitest"

import { renderSafeMarkdown } from "@/lib/safe-markdown"
import {
  BUILTIN_KNOWLEDGE_BASE_ENTRIES,
  exportKnowledgeEntryToMarkdown,
  importMarkdownToKnowledgeEntry,
  selectRelevantKnowledgeSnippets,
} from "@/services/knowledge-base-service"

describe("P2: De-Obsidian Project Knowledge Base & Markdown Import/Export", () => {
  it("imports Markdown with frontmatter, converts Obsidian wikilinks, and keeps raw HTML verbatim", () => {
    const raw = [
      "---",
      "slug: AI Industry Fact",
      "title: 企业级 Agent 落地要素",
      "category: domain_fact",
      "tags: [agent, enterprise, harness]",
      "updated_at: 2026-11-15",
      "source_url: https://story.susense.cn/ref/1",
      "---",
      "",
      "# 企业级 Agent 落地要素",
      "参考了 [[总体架构SPEC|系统总体架构规范]] 与 ![[架构图.png]]。",
      "<script>alert('xss')</script>",
      "[恶意链接](javascript:alert(1))",
    ].join("\n")

    const imported = importMarkdownToKnowledgeEntry(raw)

    expect(imported.entry.slug).toBe("ai-industry-fact")
    expect(imported.entry.title).toBe("企业级 Agent 落地要素")
    expect(imported.entry.category).toBe("domain_fact")
    expect(imported.entry.tags).toEqual(["agent", "enterprise", "harness"])
    expect(imported.cleanedWikiLinksCount).toBe(2)
    expect(imported.rawHtmlTagCount).toBe(2)
    expect(imported.entry.trustLevel).toBe("unreviewed")
    expect(imported.entry.content).toContain("系统总体架构规范")
    expect(imported.entry.content).toContain("[附件: 架构图.png]")
    // Stored verbatim: no regex "sanitizing". Safety is the renderer's job.
    expect(imported.entry.content).toContain("<script>alert('xss')</script>")
    const html = renderSafeMarkdown(imported.entry.content)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toMatch(/href="javascript:/i)
  })

  it("defaults come from the repository knowledge-base/ (trusted) instead of hand-copied text", () => {
    expect(BUILTIN_KNOWLEDGE_BASE_ENTRIES.map((e) => e.slug).sort()).toEqual(["default-brand-guide", "text-content-sop", "video-storyboard-sop"])
    for (const entry of BUILTIN_KNOWLEDGE_BASE_ENTRIES) {
      expect(entry.trustLevel).toBe("trusted")
      expect(entry.sourcePath).toMatch(/^knowledge-base\//)
    }
  })

  it("exports KnowledgeEntry to clean standard Markdown and round-trips losslessly", () => {
    const markdown = exportKnowledgeEntryToMarkdown({
      slug: "video-sop-v2",
      title: "视频分镜规范 V2",
      category: "sop",
      tags: ["video", "wanx"],
      updatedAt: "2026-11-15",
      sourceUrl: "https://story.susense.cn/sop",
      content: "第一镜必须包含强视觉吸引点。",
    })

    const reimported = importMarkdownToKnowledgeEntry(markdown)
    expect(reimported.entry.slug).toBe("video-sop-v2")
    expect(reimported.entry.title).toBe("视频分镜规范 V2")
    expect(reimported.entry.category).toBe("sop")
    expect(reimported.entry.tags).toEqual(["video", "wanx"])
    expect(reimported.entry.content).toBe("第一镜必须包含强视觉吸引点。")
  })

  it("selects relevant knowledge snippets by category and tags for ContextPack injection", () => {
    const videoSnippets = selectRelevantKnowledgeSnippets({
      categories: ["sop"],
      tags: ["video", "wanx"],
      limit: 2,
    })

    expect(videoSnippets.length).toBeGreaterThan(0)
    expect(videoSnippets[0].slug).toBe("video-storyboard-sop")
    expect(videoSnippets[0].trustLevel).toBe("trusted")
  })
})
