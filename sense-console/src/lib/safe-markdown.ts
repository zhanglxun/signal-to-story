import MarkdownIt from "markdown-it"

/**
 * The only sanctioned Markdown renderer. `html: false` escapes raw HTML (no <script>, <iframe>,
 * event attributes); markdown-it's default validateLink rejects javascript:/vbscript:/data: URLs.
 * Stored content is never regex-"cleaned" — safety is a rendering concern.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("rel", "noopener noreferrer nofollow")
  tokens[idx].attrSet("target", "_blank")
  return defaultLinkOpen(tokens, idx, options, env, self)
}

export function renderSafeMarkdown(markdown: string): string {
  return md.render(markdown)
}
