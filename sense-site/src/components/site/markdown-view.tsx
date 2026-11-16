import type { Heading } from "@/lib/markdown"

/**
 * Renders HTML produced by renderMarkdown() only (markdown-it with html:false,
 * whitelisted link protocols, https-only images). Never pass other HTML here.
 */
export function MarkdownView({ html }: { html: string }) {
  return <div className="site-prose" data-testid="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
}

export function TableOfContents({ headings }: { headings: Heading[] }) {
  if (headings.length < 2) return null
  return (
    <nav aria-label="目录" className="text-sm">
      <p className="mb-2 font-medium">目录</p>
      <ol className="space-y-1.5 border-l pl-3">
        {headings.map((heading) => (
          <li key={heading.id} className={heading.level === 3 ? "pl-3" : ""}>
            <a href={`#${heading.id}`} className="text-muted-foreground hover:text-foreground">
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
