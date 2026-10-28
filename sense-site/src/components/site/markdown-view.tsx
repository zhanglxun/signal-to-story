import type { ReactNode } from "react"

import { parseMarkdown, type Inline } from "@/lib/markdown"

function InlineText({ inlines }: { inlines: Inline[] }) {
  return inlines.map((inline, index) => {
    const key = `${inline.type}-${index}`
    if (inline.type === "strong") return <strong key={key}>{inline.value}</strong>
    if (inline.type === "code") return <code key={key}>{inline.value}</code>
    if (inline.type === "link") {
      const external = inline.href.startsWith("http")
      return (
        <a
          key={key}
          href={inline.href}
          {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
        >
          {inline.label}
        </a>
      )
    }
    return <span key={key}>{inline.value}</span>
  })
}

export function MarkdownView({ source }: { source: string }) {
  const { blocks } = parseMarkdown(source)
  return (
    <div className="reading">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = block.level === 2 ? "h2" : "h3"
          return (
            <Tag key={block.id} id={block.id}>
              {block.text}
            </Tag>
          )
        }
        if (block.type === "list") {
          return (
            <ul key={`list-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <InlineText inlines={item} />
                </li>
              ))}
            </ul>
          )
        }
        if (block.type === "quote") {
          return (
            <blockquote key={`quote-${index}`}>
              <InlineText inlines={block.inlines} />
            </blockquote>
          )
        }
        if (block.type === "code") {
          return (
            <pre key={`code-${index}`}>
              <code>{block.value}</code>
            </pre>
          )
        }
        return (
          <p key={`p-${index}`}>
            <InlineText inlines={block.inlines} />
          </p>
        )
      })}
    </div>
  )
}

export function Toc({ source }: { source: string }) {
  const { toc } = parseMarkdown(source)
  if (toc.length === 0) return null
  const list: ReactNode = (
    <ol className="grid gap-2 text-sm">
      {toc.map((item) => (
        <li key={item.id} className={item.level === 3 ? "pl-3" : undefined}>
          <a className="rounded-sm hover:underline focus-visible:ring-3 focus-visible:ring-ring/50" href={`#${item.id}`}>
            {item.text}
          </a>
        </li>
      ))}
    </ol>
  )
  return (
    <nav aria-label="目录">
      <p className="mb-3 text-sm font-medium">目录</p>
      {list}
    </nav>
  )
}
