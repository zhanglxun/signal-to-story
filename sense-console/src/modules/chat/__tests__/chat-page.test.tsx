import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeAll, describe, expect, it } from "vitest"

import { ChatPage } from "@/modules/chat/chat-page"
import { createMemoryChatSessionRepository } from "@/modules/chat/services/chat-session-service"
import { createMockChatTransport } from "@/modules/chat/transport/mock-transport"

beforeAll(() => {
  if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => undefined
  }
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined
  }
  if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

function renderChatPage(initialPath = "/chat-next") {
  const store = createMemoryChatSessionRepository({ seed: true })
  const transport = createMockChatTransport({ store, stepDelayMs: 1 })
  return {
    store,
    ...render(
      <MemoryRouter initialEntries={[initialPath]}>
        <ChatPage mockMode repository={store} transport={transport} />
      </MemoryRouter>
    ),
  }
}

describe("ChatPage (Phase 1 Mock Mode)", () => {
  it("loads seeded sessions, switches multi-version replies, and renders safe Markdown", async () => {
    const user = userEvent.setup()
    const { container } = renderChatPage()

    // Seeded session 1 has two versions for user message u1 (default shows latest v2/2)
    expect(await screen.findByText("版本 2 / 2")).toBeInTheDocument()
    expect(screen.getByText("双循环出稿的三项关键价值")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "上一版本" }))
    expect(screen.getByText("版本 1 / 2")).toBeInTheDocument()
    expect(screen.getByText(/核心收益主要有两点/)).toBeInTheDocument()

    // Send a prompt with raw <script> tag and verify safe Markdown escapes it
    const textarea = screen.getByLabelText("聊天消息输入框")
    await user.type(textarea, '测试 <script>window.__xss=1</script>')
    await user.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() => {
      expect(screen.getByText(/回复摘要/)).toBeInTheDocument()
    })
    expect(container.querySelector("script")).toBeNull()
  })

  it("supports creating, /clear inheriting workItemId, renaming, archiving, and deleting sessions", async () => {
    const user = userEvent.setup()
    const { store } = renderChatPage()

    const sidebar = screen.getByLabelText("历史会话")
    expect(await within(sidebar).findByText("Agent Harness 内容生产拆解")).toBeInTheDocument()

    // /clear creates a new session inheriting workItemId from mock-session-1 ("mock-wi-1")
    const textarea = screen.getByLabelText("聊天消息输入框")
    await user.type(textarea, "/clear{enter}")

    await waitFor(async () => {
      const list = await store.listSessions("mock-org-1")
      expect(list).toHaveLength(3)
      const newest = list[0]
      expect(newest.workItemId).toBe("mock-wi-1")
    })

    // Create another session via button
    await user.click(screen.getByRole("button", { name: "新建对话" }))
    await waitFor(async () => {
      const list = await store.listSessions("mock-org-1")
      expect(list).toHaveLength(4)
    })

    // Rename, archive, restore, delete on a session via DropdownMenu
    await user.click(screen.getByRole("button", { name: "会话操作：Agent Harness 内容生产拆解" }))
    await user.click(await screen.findByText("重命名"))
    const renameInput = screen.getByPlaceholderText("输入新标题")
    await user.clear(renameInput)
    await user.type(renameInput, "已重命名会话")
    await user.click(screen.getByRole("button", { name: "保存" }))
    expect(await within(sidebar).findByText("已重命名会话")).toBeInTheDocument()

    // Archive and verify it disappears from active list, appears under 已归档, then delete
    await user.click(screen.getByRole("button", { name: "会话操作：已重命名会话" }))
    await user.click(await screen.findByText("归档会话"))
    await waitFor(() => {
      expect(within(sidebar).queryByText("已重命名会话")).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: "已归档" }))
    expect(await within(sidebar).findByText("已重命名会话")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "会话操作：已重命名会话" }))
    await user.click(await screen.findByText("删除会话"))
    await waitFor(() => {
      expect(within(sidebar).queryByText("已重命名会话")).not.toBeInTheDocument()
    })
  })

  it("supports H5 narrow layout via ?h5=1 and opens drawer", async () => {
    const user = userEvent.setup()
    renderChatPage("/chat-next?h5=1")

    expect(await screen.findByRole("button", { name: "桌面视图" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "打开会话列表" }))
    expect(await screen.findByText("会话列表")).toBeInTheDocument()
  })

  it("groups Model Selector by node and disables offline nodes", async () => {
    const user = userEvent.setup()
    renderChatPage()

    const selectorBtn = await screen.findByRole("button", { name: "选择模型或本地 CLI" })
    await user.click(selectorBtn)

    expect(screen.getByText("云端常驻节点 · Cloud Worker")).toBeInTheDocument()
    expect(screen.getByText("本机开发节点 · MacBook ACP")).toBeInTheDocument()
    expect(screen.getByText("备用节点 · Studio Workstation（离线）")).toBeInTheDocument()

    const offlineOption = screen.getByText("Claude Code (ACP)").closest('[role="option"]')
    expect(offlineOption).toHaveAttribute("aria-disabled", "true")
  })

  it("executes /capture as a local card without inserting a chat_message", async () => {
    const user = userEvent.setup()
    const { store } = renderChatPage()

    expect(await screen.findByText("版本 2 / 2")).toBeInTheDocument()
    const beforeCount = (await store.listMessages("mock-session-1")).length

    const textarea = screen.getByLabelText("聊天消息输入框")
    await user.type(textarea, "/capture https://example.com/idea 一句灵感{enter}")

    expect(await screen.findByText("已收录到收件箱（Mock）")).toBeInTheDocument()
    const afterCount = (await store.listMessages("mock-session-1")).length
    expect(afterCount).toBe(beforeCount)
  })
})
