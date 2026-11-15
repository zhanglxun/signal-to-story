import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const importKnowledgeMarkdown = vi.fn()
vi.mock("@/services/knowledge-base-service", () => ({ importKnowledgeMarkdown: (...a: unknown[]) => importKnowledgeMarkdown(...a) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { RememberDecisionField } from "@/components/decision-memory/remember-decision-field"
import { KnowledgeImportDialog } from "@/components/knowledge/knowledge-import-dialog"
import { Button } from "@/components/ui/button"
import { buildDecisionMemoryInput, emptyRememberValue, type RememberDecisionValue } from "@/lib/remember-decision"
import { fallbackSlugFromFilename } from "@/lib/knowledge-import"

const ctx = { organizationId: "org-1", kind: "rejected_pattern" as const, quote: "  开头太啰嗦  ", platform: "wechat_official", source: "review_event" as const, sourceRef: "document:d1@v2" }

function Harness({ onValue }: { onValue: (v: RememberDecisionValue) => void }) {
  const [value, setValue] = useState(emptyRememberValue)
  return <RememberDecisionField value={value} platform="wechat_official" onChange={(v) => { setValue(v); onValue(v) }} />
}

describe("RememberDecisionField", () => {
  it("shows summary and scope only after ticking, defaulting to the platform scope", () => {
    const seen: RememberDecisionValue[] = []
    render(<Harness onValue={(v) => seen.push(v)} />)
    expect(screen.queryByLabelText(/偏好摘要/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox"))
    expect(seen.at(-1)).toMatchObject({ enabled: true, scope: "platform" })
    fireEvent.change(screen.getByLabelText(/偏好摘要/), { target: { value: "开头先给结论" } })
    fireEvent.change(screen.getByLabelText("适用范围"), { target: { value: "global" } })
    expect(seen.at(-1)).toEqual({ enabled: true, summary: "开头先给结论", scope: "global" })
    expect(screen.getByRole("option", { name: "仅公众号" })).toBeInTheDocument()
  })
})

describe("buildDecisionMemoryInput", () => {
  it("returns null when not ticked", () => {
    expect(buildDecisionMemoryInput(emptyRememberValue, ctx)).toBeNull()
  })
  it("keeps the human quote, scopes to the platform by default and falls back to the quote as summary", () => {
    expect(buildDecisionMemoryInput({ enabled: true, summary: "", scope: "platform" }, ctx)).toEqual({
      organizationId: "org-1", kind: "rejected_pattern", summary: "开头太啰嗦", humanQuote: "开头太啰嗦",
      platform: "wechat_official", source: "review_event", sourceRef: "document:d1@v2",
    })
  })
  it("uses the edited summary and a null platform for global scope", () => {
    const input = buildDecisionMemoryInput({ enabled: true, summary: "先给结论", scope: "global" }, ctx)
    expect(input).toMatchObject({ summary: "先给结论", humanQuote: "开头太啰嗦", platform: null })
  })
  it("rejects an empty memory before the main action runs", () => {
    expect(() => buildDecisionMemoryInput({ enabled: true, summary: "", scope: "platform" }, { ...ctx, quote: " " })).toThrow("摘要")
  })
  it("truncates to database limits", () => {
    const input = buildDecisionMemoryInput({ enabled: true, summary: "a".repeat(900), scope: "platform" }, { ...ctx, quote: "q".repeat(3000) })
    expect(input?.summary).toHaveLength(500)
    expect(input?.humanQuote).toHaveLength(2000)
  })
})

describe("KnowledgeImportDialog", () => {
  beforeEach(() => importKnowledgeMarkdown.mockReset())
  function renderDialog() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><KnowledgeImportDialog organizationId="org-1" trigger={<Button>导入</Button>} /></QueryClientProvider>)
  }
  it("warns that imports are unreviewed and submits pasted Markdown with a generated slug", async () => {
    importKnowledgeMarkdown.mockResolvedValue({ title: "笔记" })
    renderDialog()
    fireEvent.click(screen.getByRole("button", { name: "导入" }))
    expect(await screen.findByText(/不会进入系统指令区/)).toBeInTheDocument()
    const submit = screen.getByRole("button", { name: "导入为未审核" })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/粘贴 Markdown/), { target: { value: "# 笔记\n\n正文" } })
    fireEvent.click(submit)
    await waitFor(() => expect(importKnowledgeMarkdown).toHaveBeenCalledTimes(1))
    const [org, md, slug] = importKnowledgeMarkdown.mock.calls[0]
    expect(org).toBe("org-1")
    expect(md).toBe("# 笔记\n\n正文")
    expect(slug).toMatch(/^imported-/)
  })
  it("derives the slug from an uploaded file name", async () => {
    importKnowledgeMarkdown.mockResolvedValue({ title: "SOP" })
    renderDialog()
    fireEvent.click(screen.getByRole("button", { name: "导入" }))
    const input = await screen.findByLabelText(/选择 .md 文件/)
    fireEvent.change(input, { target: { files: [new File(["# SOP\n内容"], "Writing SOP.md", { type: "text/markdown" })] } })
    await waitFor(() => expect(screen.getByLabelText(/粘贴 Markdown/)).toHaveValue("# SOP\n内容"))
    fireEvent.click(screen.getByRole("button", { name: "导入为未审核" }))
    await waitFor(() => expect(importKnowledgeMarkdown).toHaveBeenCalled())
    expect(importKnowledgeMarkdown.mock.calls[0][2]).toBe("writing-sop")
    expect(fallbackSlugFromFilename("中文.md")).toMatch(/^imported-/)
  })
})
