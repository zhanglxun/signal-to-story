import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * MVP knowledge source (docs/database.md §3): the repository's knowledge-base/**\/*.md files, read by the worker.
 * There is no knowledge table; these files are reviewed through git, so every entry counts as trusted.
 */
export interface RepoKnowledgeEntry {
  slug: string
  title: string
  category: string
  tags: string[]
  content: string
  trust_level: "trusted"
}

const here = path.dirname(fileURLToPath(import.meta.url))
export const KNOWLEDGE_DIR = process.env.SENSE_KNOWLEDGE_DIR || path.resolve(here, "../../knowledge-base")

function walk(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir).sort()
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return name.endsWith(".md") && name.toLowerCase() !== "readme.md" ? [full] : []
  })
}

/** Parse `---` frontmatter (slug, title, category, tags: [a, b]) followed by a Markdown body. */
export function parseKnowledgeMarkdown(raw: string, fallbackSlug: string): RepoKnowledgeEntry {
  const text = raw.replace(/\r\n/g, "\n").trim()
  const meta: Record<string, string> = {}
  let body = text
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 4)
    if (end !== -1) {
      for (const line of text.slice(4, end).split("\n")) {
        const i = line.indexOf(":")
        if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")
      }
      body = text.slice(end + 5).trim()
    }
  }
  const tags = (meta.tags ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return {
    slug: meta.slug || fallbackSlug,
    title: meta.title || heading || fallbackSlug,
    category: meta.category || "sop",
    tags,
    content: body,
    trust_level: "trusted",
  }
}

let cache: { dir: string; entries: RepoKnowledgeEntry[] } | null = null

export function loadRepositoryKnowledge(dir = KNOWLEDGE_DIR): RepoKnowledgeEntry[] {
  if (cache?.dir === dir) return cache.entries
  const entries = walk(dir).map((file) => parseKnowledgeMarkdown(readFileSync(file, "utf8"), path.basename(file, ".md")))
  cache = { dir, entries }
  return entries
}

/** Knowledge used for video storyboards: the storyboard SOP, anything tagged video, and the brand voice. */
export function loadVideoKnowledge(dir = KNOWLEDGE_DIR): Array<{ slug: string; title: string; content: string }> {
  return loadRepositoryKnowledge(dir)
    .filter((k) => k.slug === "video-storyboard-sop" || k.tags.includes("video") || k.category === "brand_voice")
    .slice(0, 10)
    .map(({ slug, title, content }) => ({ slug, title, content }))
}
