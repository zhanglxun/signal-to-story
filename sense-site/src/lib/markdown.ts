export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; label: string; href: string }

export type Block =
  | { type: "heading"; level: 2 | 3; id: string; text: string }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; items: Inline[][] }
  | { type: "quote"; inlines: Inline[] }
  | { type: "code"; value: string }

const inlinePattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g

export function safeHref(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith("#")) {
    return /^#[\p{L}\p{N}_-]+$/u.test(trimmed) ? trimmed : null
  }
  try {
    const url = new URL(trimmed)
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString()
  } catch {
    return null
  }
  return null
}

export function parseInlines(input: string): Inline[] {
  const inlines: Inline[] = []
  let last = 0
  for (const match of input.matchAll(inlinePattern)) {
    const index = match.index ?? 0
    if (index > last) inlines.push({ type: "text", value: input.slice(last, index) })
    if (match[2]) inlines.push({ type: "strong", value: match[2] })
    else if (match[3]) inlines.push({ type: "code", value: match[3] })
    else if (match[4] && match[5]) {
      const href = safeHref(match[5])
      if (href) inlines.push({ type: "link", label: match[4], href })
      else inlines.push({ type: "text", value: `${match[4]} (${match[5]})` })
    }
    last = index + match[0].length
  }
  if (last < input.length) inlines.push({ type: "text", value: input.slice(last) })
  if (inlines.length === 0) inlines.push({ type: "text", value: input })
  return inlines
}

function headingId(text: string, used: Map<string, number>) {
  const base =
    text
      .trim()
      .toLocaleLowerCase("zh-CN")
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}-]+/gu, "") || "section"
  const count = used.get(base) ?? 0
  used.set(base, count + 1)
  return count === 0 ? base : `${base}-${count + 1}`
}

export function parseMarkdown(source: string) {
  const lines = source.replaceAll("\r\n", "\n").split("\n")
  const blocks: Block[] = []
  const used = new Map<string, number>()
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ""
    if (!line.trim()) {
      index += 1
      continue
    }
    if (line.startsWith("```")) {
      const collected: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        collected.push(lines[index] ?? "")
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: "code", value: collected.join("\n") })
      continue
    }
    if (line.startsWith("### ")) {
      const text = line.slice(4).trim()
      blocks.push({ type: "heading", level: 3, id: headingId(text, used), text })
      index += 1
      continue
    }
    if (line.startsWith("## ")) {
      const text = line.slice(3).trim()
      blocks.push({ type: "heading", level: 2, id: headingId(text, used), text })
      index += 1
      continue
    }
    if (line.startsWith("> ")) {
      blocks.push({ type: "quote", inlines: parseInlines(line.slice(2).trim()) })
      index += 1
      continue
    }
    if (line.startsWith("- ")) {
      const items: Inline[][] = []
      while (index < lines.length && (lines[index] ?? "").startsWith("- ")) {
        items.push(parseInlines((lines[index] ?? "").slice(2).trim()))
        index += 1
      }
      blocks.push({ type: "list", items })
      continue
    }
    const paragraph: string[] = []
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !(lines[index] ?? "").startsWith("#") &&
      !(lines[index] ?? "").startsWith("- ") &&
      !(lines[index] ?? "").startsWith("> ") &&
      !(lines[index] ?? "").startsWith("```")
    ) {
      paragraph.push((lines[index] ?? "").trim())
      index += 1
    }
    blocks.push({ type: "paragraph", inlines: parseInlines(paragraph.join(" ")) })
  }

  const toc = blocks.flatMap((block) =>
    block.type === "heading" ? [{ id: block.id, level: block.level, text: block.text }] : []
  )
  return { blocks, toc }
}
