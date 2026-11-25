import type { KnowledgeTrustLevel } from "@/contracts/agent-harness"
import type { KnowledgeCategory, KnowledgeEntry } from "@/contracts/knowledge-base"
import { DEFAULT_KNOWLEDGE_ENTRIES } from "@/data/knowledge-base-defaults.generated"

export { exportKnowledgeEntryToMarkdown, importMarkdownToKnowledgeEntry } from "@/lib/knowledge-markdown"

/**
 * The knowledge base is the repository's knowledge-base/*.md (reviewed through git). The agent worker reads the
 * files directly; this generated copy (`npm run kb:seed`) only lets the console show them. There is no table.
 */
export const BUILTIN_KNOWLEDGE_BASE_ENTRIES: readonly KnowledgeEntry[] = DEFAULT_KNOWLEDGE_ENTRIES

/** Rank entries by category/tag match for Context Pack injection. Carries trustLevel through. */
export function selectRelevantKnowledgeSnippets(options: {
  entries?: readonly KnowledgeEntry[]
  categories?: KnowledgeCategory[]
  tags?: string[]
  limit?: number
}): Array<{ slug: string; title: string; content: string; trustLevel: KnowledgeTrustLevel }> {
  const pool = options.entries ?? BUILTIN_KNOWLEDGE_BASE_ENTRIES
  const wantedCategories = new Set(options.categories ?? [])
  const wantedTags = new Set((options.tags ?? []).map((t) => t.toLowerCase()))
  const limit = Math.max(options.limit ?? 5, 1)

  return pool
    .filter((entry) => entry.trustLevel !== "archived")
    .map((entry) => {
      let score = 0
      if (wantedCategories.size === 0 || wantedCategories.has(entry.category)) score += 2
      for (const tag of entry.tags) if (wantedTags.has(tag.toLowerCase())) score += 3
      return { entry, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => ({ slug: entry.slug, title: entry.title, content: entry.content, trustLevel: entry.trustLevel ?? "unreviewed" }))
}
