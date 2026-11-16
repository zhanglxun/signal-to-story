import type { KnowledgeTrustLevel } from "@/contracts/agent-harness"
import type { KnowledgeCategory, KnowledgeEntry, StoredKnowledgeEntry } from "@/contracts/knowledge-base"
import { DEFAULT_KNOWLEDGE_ENTRIES } from "@/data/knowledge-base-defaults.generated"
import { getSupabaseClient } from "@/lib/supabase"

import { exportKnowledgeEntryToMarkdown, importMarkdownToKnowledgeEntry } from "@/lib/knowledge-markdown"

export { exportKnowledgeEntryToMarkdown, importMarkdownToKnowledgeEntry } from "@/lib/knowledge-markdown"

/**
 * Default (trusted) entries generated from the repository's knowledge-base/*.md by
 * `npm run kb:seed`. Not hand-maintained. The runtime source of truth is public.knowledge_entries;
 * the same files are seeded there by supabase/seeds/knowledge_base.sql.
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

// ---------------------------------------------------------------------------
// Runtime: public.knowledge_entries (RLS: content.view read, content.manage write,
// content.review required to mark trusted).
// ---------------------------------------------------------------------------

function db() {
  const client = getSupabaseClient()
  if (!client) throw new Error("Supabase 未配置")
  return client
}

export function mapKnowledgeRow(row: Record<string, unknown>): StoredKnowledgeEntry {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    slug: String(row.slug),
    title: String(row.title),
    category: row.category as KnowledgeCategory,
    tags: (row.tags as string[]) ?? [],
    content: String(row.content ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    sourceUrl: (row.source_url as string | null) ?? null,
    sourcePath: (row.source_path as string | null) ?? null,
    trustLevel: row.trust_level as KnowledgeTrustLevel,
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
  }
}

export async function listKnowledgeEntries(organizationId: string, options: { trustLevels?: KnowledgeTrustLevel[]; category?: KnowledgeCategory } = {}): Promise<StoredKnowledgeEntry[]> {
  let query = db().from("knowledge_entries").select("*").eq("organization_id", organizationId)
  if (options.trustLevels?.length) query = query.in("trust_level", options.trustLevels)
  if (options.category) query = query.eq("category", options.category)
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapKnowledgeRow)
}

/** Import Markdown as an `unreviewed` entry. Fails on duplicate slug within the organization. */
export async function importKnowledgeMarkdown(organizationId: string, rawMarkdown: string, fallbackSlug?: string): Promise<StoredKnowledgeEntry> {
  const { entry } = importMarkdownToKnowledgeEntry(rawMarkdown, fallbackSlug)
  const { data, error } = await db()
    .from("knowledge_entries")
    .insert({
      organization_id: organizationId,
      slug: entry.slug,
      title: entry.title,
      category: entry.category,
      tags: entry.tags,
      content: entry.content,
      source_url: entry.sourceUrl,
      trust_level: "unreviewed",
    })
    .select("*")
    .single()
  if (error) throw new Error(error.code === "23505" ? `知识条目 ${entry.slug} 已存在` : error.message)
  return mapKnowledgeRow(data)
}

/** Requires content.review to set `trusted` (enforced by the database trigger). */
export async function setKnowledgeTrustLevel(entryId: string, trustLevel: KnowledgeTrustLevel): Promise<StoredKnowledgeEntry> {
  const { data, error } = await db().from("knowledge_entries").update({ trust_level: trustLevel }).eq("id", entryId).select("*").single()
  if (error) throw new Error(error.message)
  return mapKnowledgeRow(data)
}

/** Mark an entry `trusted`. The database requires content.review; the UI only mirrors that. */
export const markKnowledgeTrusted = (entryId: string) => setKnowledgeTrustLevel(entryId, "trusted")

/** Archived entries never enter a Context Pack. */
export const archiveKnowledgeEntry = (entryId: string) => setKnowledgeTrustLevel(entryId, "archived")

/** Put an entry back to `unreviewed` (reference-only) so it can be re-reviewed. */
export const restoreKnowledgeEntry = (entryId: string) => setKnowledgeTrustLevel(entryId, "unreviewed")

/** Portable Markdown (frontmatter + body) for one stored entry. */
export function exportKnowledgeMarkdown(entry: StoredKnowledgeEntry): string {
  return exportKnowledgeEntryToMarkdown(entry)
}
