import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ChatPromptInput } from "@/modules/chat/components/chat-prompt-input"
import { listMockRuntimeCatalog } from "@/modules/chat/services/runtime-catalog-service"
import type { ChatContextRefPart, ContextRefOption, RuntimeNodeCatalog } from "@/modules/chat/types"

const REFS: ContextRefOption[] = [
  { kind: "work_item", id: "wi-1", label: "选题 A：Agent Harness", subtitle: "article" },
  { kind: "document", id: "doc-1", label: "公众号初稿", subtitle: "wechat" },
]

function Harness({
  catalog,
  onSubmitSpy,
  onQuickCaptureSpy,
  isStreaming = false,
}: {
  catalog: RuntimeNodeCatalog[]
  onSubmitSpy: (payload: { value: string; refs: ChatContextRefPart[] }) => void
  onQuickCaptureSpy?: (text: string) => void
  isStreaming?: boolean
}) {
  const [value, setValue] = useState("")
  const [refs, setRefs] = useState<ChatContextRefPart[]>([])

  return (
    <ChatPromptInput
      value={value}
      onChange={setValue}
      contextRefs={refs}
      onAddContextRef={(r) => setRefs((prev) => [...prev, r])}
      onRemoveContextRef={(kind, id) =>
        setRefs((prev) => prev.filter((item) => !(item.kind === kind && item.id === id)))
      }
      referenceOptions={REFS}
      catalog={catalog}
      selectedNodeId="node-cloud-1"
      selectedRuntimeId="api:qwen:qwen3.8-flash"
      thinkingEffort="low"
      onSelectRuntime={() => undefined}
      onThinkingEffortChange={() => undefined}
      isStreaming={isStreaming}
      onSubmit={() => onSubmitSpy({ value, refs })}
      onStop={() => undefined}
      onQuickCaptureUrl={(text) => onQuickCaptureSpy?.(text)}
    />
  )
}

describe("ChatPromptInput", () => {
  it("opens Slash menu on '/' and inserts selected command", async () => {
    const user = userEvent.setup()
    const catalog = listMockRuntimeCatalog()
    const onSubmitSpy = vi.fn()

    render(<Harness catalog={catalog} onSubmitSpy={onSubmitSpy} />)
    const textarea = screen.getByLabelText("聊天消息输入框")
    await user.type(textarea, "/")

    expect(screen.getByRole("listbox", { name: "Slash 命令菜单" })).toBeInTheDocument()
    await user.click(screen.getByText("极简速记收录"))

    expect(textarea).toHaveValue("/capture ")
  })

  it("opens '@' reference picker, mounts removable context_ref chip, and passes refs on submit", async () => {
    const user = userEvent.setup()
    const catalog = listMockRuntimeCatalog()
    const onSubmitSpy = vi.fn()

    render(<Harness catalog={catalog} onSubmitSpy={onSubmitSpy} />)
    const textarea = screen.getByLabelText("聊天消息输入框")
    await user.type(textarea, "请帮我看下 @")

    expect(screen.getByRole("listbox", { name: "引用事项或稿件" })).toBeInTheDocument()
    await user.click(screen.getByText("选题 A：Agent Harness"))

    expect(screen.getByRole("button", { name: "移除引用 选题 A：Agent Harness" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "发送" }))
    expect(onSubmitSpy).toHaveBeenCalledWith({
      value: "请帮我看下",
      refs: [
        {
          type: "context_ref",
          kind: "work_item",
          id: "wi-1",
          label: "选题 A：Agent Harness",
        },
      ],
    })

    // Remove the chip
    await user.click(screen.getByRole("button", { name: "移除引用 选题 A：Agent Harness" }))
    expect(
      screen.queryByRole("button", { name: "移除引用 选题 A：Agent Harness" })
    ).not.toBeInTheDocument()
  })

  it("shows quick-capture chip when pasting a URL and stop button while streaming", async () => {
    const user = userEvent.setup()
    const catalog = listMockRuntimeCatalog()
    const onQuickCapture = vi.fn()

    const { rerender } = render(
      <Harness catalog={catalog} onSubmitSpy={vi.fn()} onQuickCaptureSpy={onQuickCapture} />
    )
    const textarea = screen.getByLabelText("聊天消息输入框")
    await user.type(textarea, "https://example.com/article 值得写一篇")

    const chipBtn = screen.getByRole("button", { name: "一键收录到收件箱" })
    await user.click(chipBtn)
    expect(onQuickCapture).toHaveBeenCalledWith("https://example.com/article 值得写一篇")

    rerender(
      <Harness catalog={catalog} onSubmitSpy={vi.fn()} isStreaming />
    )
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument()
  })
})
