import type { KnowledgeCategory, KnowledgeEntry, MarkdownImportResult } from "../contracts/knowledge-base"

/** Pure Markdown <-> KnowledgeEntry conversion. No browser/Node APIs (used by the seed generator too). */
const VALID_CATEGORIES: ReadonlySet<KnowledgeCategory> = new Set([
  "sop",
  "brand_voice",
  "domain_fact",
  "decision_memory",
])

function normalizeSlug(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "knowledge-item"
  )
}

/**
 * Parse a Markdown document (optional YAML-ish frontmatter: slug, title, category, tags,
 * updated_at, source_url) into a knowledge entry.
 * - Obsidian wiki links are converted: [[Target|Alias]] -> Alias, [[Target]] -> Target, ![[file]] -> [附件: file]
 * - HTML is NOT stripped or rewritten. Content is stored verbatim; rendering uses markdown-it (html:false).
 * - Imported entries are `unreviewed`: they only enter Context Packs as untrusted reference data.
 */
export function importMarkdownToKnowledgeEntry(rawMarkdown: string, fallbackSlug = "imported-note"): MarkdownImportResult {
  const normalized = rawMarkdown.replace(/\r\n/g, "\n").trim()
  let frontmatterBlock = ""
  let body = normalized

  if (normalized.startsWith("---\n")) {
    const endIdx = normalized.indexOf("\n---\n", 4)
    if (endIdx !== -1) {
      frontmatterBlock = normalized.slice(4, endIdx)
      body = normalized.slice(endIdx + 5).trim()
    }
  }

  const meta: Record<string, string> = {}
  for (const line of frontmatterBlock.split("\n")) {
    const colonIdx = line.indexOf(":")
    if (colonIdx > 0) {
      meta[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, "")
    }
  }

  let cleanedWikiLinksCount = 0
  body = body.replace(/!\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    cleanedWikiLinksCount += 1
    return `[附件: ${inner.trim()}]`
  })
  body = body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
    cleanedWikiLinksCount += 1
    return (alias ?? target).trim()
  })

  const rawHtmlTagCount = (body.match(/<\/?[a-zA-Z][^>]*>/g) ?? []).length

  const headingMatch = body.match(/^#\s+(.+)$/m)
  const title = meta.title || headingMatch?.[1]?.trim() || fallbackSlug
  const rawCategory = (meta.category || "domain_fact") as KnowledgeCategory
  const category: KnowledgeCategory = VALID_CATEGORIES.has(rawCategory) ? rawCategory : "domain_fact"
  const tags = (meta.tags ? meta.tags.replace(/^\[|\]$/g, "") : "")
    .split(",")
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)

  return {
    entry: {
      slug: normalizeSlug(meta.slug || fallbackSlug),
      title,
      category,
      tags,
      content: body.trim(),
      updatedAt: meta.updated_at || new Date().toISOString().slice(0, 10),
      sourceUrl: meta.source_url || null,
      trustLevel: "unreviewed",
    },
    cleanedWikiLinksCount,
    rawHtmlTagCount,
  }
}

/** Export an entry to portable Markdown (no plugin-specific syntax). */
export function exportKnowledgeEntryToMarkdown(entry: KnowledgeEntry): string {
  const lines = [
    "---",
    `slug: ${entry.slug}`,
    `title: ${entry.title}`,
    `category: ${entry.category}`,
    `tags: [${entry.tags.join(", ")}]`,
    `updated_at: ${entry.updatedAt}`,
  ]
  if (entry.sourceUrl) lines.push(`source_url: ${entry.sourceUrl}`)
  lines.push("---", "", entry.content.trim(), "")
  return lines.join("\n")
}

