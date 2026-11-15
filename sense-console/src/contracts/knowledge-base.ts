import type { KnowledgeTrustLevel } from "./agent-harness"

export type KnowledgeCategory =
  | "sop"
  | "brand_voice"
  | "domain_fact"
  | "decision_memory"

export interface KnowledgeEntry {
  slug: string
  title: string
  category: KnowledgeCategory
  tags: string[]
  /** Raw Markdown, stored verbatim. Render with renderSafeMarkdown (markdown-it, html:false). */
  content: string
  updatedAt: string
  sourceUrl?: string | null
  /** Only `trusted` reaches the system zone of a Context Pack. Imports are `unreviewed`. */
  trustLevel?: KnowledgeTrustLevel
  /** Repo-relative path for entries seeded from knowledge-base/. */
  sourcePath?: string | null
}

/** Row of public.knowledge_entries mapped to camelCase. */
export interface StoredKnowledgeEntry extends KnowledgeEntry {
  id: string
  organizationId: string
  trustLevel: KnowledgeTrustLevel
  reviewedBy: string | null
  reviewedAt: string | null
}

export interface MarkdownImportResult {
  entry: KnowledgeEntry
  cleanedWikiLinksCount: number
  /** Raw HTML tags found in the body. Informational only — content is kept verbatim. */
  rawHtmlTagCount: number
}
