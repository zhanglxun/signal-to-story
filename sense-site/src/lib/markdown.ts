import MarkdownIt from "markdown-it"

export type Heading = { id: string; text: string; level: number }

const SAFE_LINK = /^(https?:|mailto:)/i
const SAFE_IMAGE = /^https:/i

export function isSafeHref(href: string) {
  const value = href.trim()
  if (!value) return false
  if (value.startsWith("#") || (value.startsWith("/") && !value.startsWith("//"))) return true
  return SAFE_LINK.test(value)
}

export function isSafeMediaUrl(url: string | undefined | null) {
  return Boolean(url && SAFE_IMAGE.test(url.trim()) && !/[\s<>"]/.test(url.trim()))
}

function createRenderer() {
  // html: false — raw HTML in Markdown is escaped, never executed.
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false })
  md.validateLink = (url) => isSafeHref(url)

  const defaultLinkOpen =
    md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const href = token.attrGet("href") ?? ""
    if (/^https?:/i.test(href)) {
      token.attrSet("target", "_blank")
      token.attrSet("rel", "noopener noreferrer nofollow ugc")
    }
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  const defaultImage =
    md.renderer.rules.image ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const src = token.attrGet("src") ?? ""
    if (!isSafeMediaUrl(src)) return ""
    token.attrSet("loading", "lazy")
    token.attrSet("referrerpolicy", "no-referrer")
    return defaultImage(tokens, idx, options, env, self)
  }

  md.renderer.rules.heading_open = (tokens, idx, options, env: { headings: Heading[]; used: Map<string, number> }, self) => {
    const token = tokens[idx]
    const inline = tokens[idx + 1]
    const text = inline?.children?.map((child) => child.content).join("") ?? inline?.content ?? ""
    const base =
      text
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "section"
    const seen = env.used.get(base) ?? 0
    env.used.set(base, seen + 1)
    const id = seen ? `${base}-${seen + 1}` : base
    token.attrSet("id", id)
    const level = Number(token.tag.slice(1))
    if (level >= 2 && level <= 3) env.headings.push({ id, text, level })
    return self.renderToken(tokens, idx, options)
  }
  return md
}

const renderer = createRenderer()

export function renderMarkdown(markdown: string): { html: string; headings: Heading[] } {
  const env = { headings: [] as Heading[], used: new Map<string, number>() }
  const html = renderer.render(markdown, env)
  return { html, headings: env.headings }
}
