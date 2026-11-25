import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeAll, describe, expect, it } from "vitest"

import { ChatPage } from "@/modules/chat/chat-page"
import { createMemoryChatSessionRepository } from "@/modules/chat/services/chat-session-service"
import { createMockChatTransport } from "@/modules/chat/transport/mock-transport"
import type { RuntimeEntry, RuntimeNodeCatalog } from "@/modules/chat/types"

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

function renderChatPage(
  initialPath = "/chat",
  options?: {
    permissionTimeoutMs?: number
    cancelPersistDelayMs?: number
    stepDelayMs?: number
    pendingPollIntervalMs?: number
    variant?: "shell" | "h5"
    catalogLoader?: () => Promise<RuntimeNodeCatalog[]>
  }
) {
  const store = createMemoryChatSessionRepository({ seed: true })
  const transport = createMockChatTransport({
    store,
    stepDelayMs: options?.stepDelayMs ?? 1,
    permissionTimeoutMs: options?.permissionTimeoutMs,
    cancelPersistDelayMs: options?.cancelPersistDelayMs,
  })
  return {
    store,
    ...render(
      <MemoryRouter initialEntries={[initialPath]}>
        <ChatPage
          mockMode
          repository={store}
          transport={transport}
          pendingPollIntervalMs={options?.pendingPollIntervalMs}
          variant={options?.variant}
          catalogLoader={options?.catalogLoader}
        />
      </MemoryRouter>
    ),
  }
}

function runtime(id: string, label: string, overrides: Partial<RuntimeEntry> = {}): RuntimeEntry {
  return {
    id,
    kind: id.startsWith("acp:") ? "acp" : "api",
    provider: id.split(":")[1] ?? "",
    model: id.split(":")[2] ?? "",
    label,
    capabilities: { streaming: true, reasoning: false },
    status: "ready",
    ...overrides,
  }
}

function node(
  nodeId: string,
  nodeName: string,
  runtimes: RuntimeEntry[],
  overrides: Partial<RuntimeNodeCatalog> = {}
): RuntimeNodeCatalog {
  return {
    nodeId,
    nodeName,
    online: true,
    lastSeenAt: new Date().toISOString(),
    protocolVersion: 1,
    supportsHttpSse: true,
    httpEndpointHint: `http://127.0.0.1/${nodeId}`,
    runtimes,
    ...overrides,
  }
}

/** Seed sessions use node-cloud-1 (qwen / deepseek-chat): keep those ids so runtime_config restores. */
const REAL_LIKE_CATALOG: RuntimeNodeCatalog[] = [
  node("node-cloud-1", "云端节点 A", [
    runtime("api:qwen:qwen3.8-flash", "千问 Flash", { capabilities: { reasoning: true } }),
    runtime("api:deepseek:deepseek-chat", "DeepSeek Chat"),
  ]),
  node("node-offline", "离线节点 B", [runtime("acp:opencode", "OpenCode 离线")], {
    online: false,
  }),
  node("node-no-sse", "队列节点 C", [runtime("api:kimi:kimi-k2", "Kimi 无对话入口")], {
    supportsHttpSse: false,
  }),
  node("node-no-hint", "无地址节点 D", [runtime("api:zhipu:glm", "GLM 无地址")], {
    httpEndpointHint: "",
  }),
]

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

  it("supports the H5 standalone layout and opens the drawer", async () => {
    const user = userEvent.setup()
    renderChatPage("/h5/chat", { variant: "h5" })

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

  it("renders Phase 2 plan, tool cards, stack trace, and permission timeout in ChatPage", async () => {
    const user = userEvent.setup()
    renderChatPage("/chat", { permissionTimeoutMs: 150 })

    expect(await screen.findByText("版本 2 / 2")).toBeInTheDocument()
    const textarea = screen.getByLabelText("聊天消息输入框")
    await user.type(textarea, "请演示计划步骤、工具执行与失败调用栈{enter}")

    await waitFor(() => {
      expect(screen.getByText(/已完成本地事项读取/)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument()
    })

    expect(screen.getByText("执行计划")).toBeInTheDocument()
    expect(screen.getByText("read_work_item")).toBeInTheDocument()
    expect(screen.getByText("fetch_reference")).toBeInTheDocument()
    expect(screen.getByText("抓取信源超时：目标站点在 5000ms 内未响应")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /工具错误调用栈/ }))
    expect(screen.getByText(/FetchTimeoutError/)).toBeVisible()

    await user.type(textarea, "请演示权限超时自动拒绝流程{enter}")
    expect(await screen.findByRole("button", { name: "仅本次允许" })).toBeInTheDocument()
    expect(await screen.findByText("已超时（按拒绝处理）")).toBeInTheDocument()
  })

  it("shows stopping placeholder after stop and resolves once delayed assistant message lands", async () => {
    const user = userEvent.setup()
    renderChatPage("/chat", {
      stepDelayMs: 25,
      cancelPersistDelayMs: 70,
      pendingPollIntervalMs: 15,
    })

    expect(await screen.findByText("版本 2 / 2")).toBeInTheDocument()
    const textarea = screen.getByLabelText("聊天消息输入框")
    await user.type(textarea, "请验证停止后延迟落库占位{enter}")

    const stopBtn = await screen.findByRole("button", { name: "停止" })
    await user.click(stopBtn)

    expect(await screen.findByText("正在停止，等待助手回复落库…")).toBeInTheDocument()
    expect(await screen.findByText("已停止")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText("正在停止，等待助手回复落库…")).not.toBeInTheDocument()
    })
  })
})

describe("ChatPage first send", () => {
  it("shows the persisted reply of a turn sent from a brand-new session", async () => {
    const user = userEvent.setup()
    const store = createMemoryChatSessionRepository({ seed: false })
    const transport = createMockChatTransport({ store, stepDelayMs: 1 })
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <ChatPage mockMode repository={store} transport={transport} />
      </MemoryRouter>
    )
    await user.type(screen.getByLabelText("聊天消息输入框"), "第一句话{enter}")
    await waitFor(async () => {
      const [session] = await store.listSessions("mock-org-1")
      expect((await store.listMessages(session.id)).map((m) => m.role)).toEqual(["user", "assistant"])
    })
    await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeInTheDocument())
    // The live turn is cleared on done; the reply must come back from the store.
    expect(await screen.findByText(/回复摘要/, {}, { timeout: 3000 })).toBeInTheDocument()
  })
})

describe("ChatPage with the node catalog", () => {
  it("only offers runtimes on online nodes that serve HTTP/SSE at a known address", async () => {
    const user = userEvent.setup()
    renderChatPage("/chat", { catalogLoader: async () => REAL_LIKE_CATALOG })

    await user.click(await screen.findByRole("button", { name: "选择模型或本地 CLI" }))

    expect(screen.getByText("离线节点 B（离线）")).toBeInTheDocument()
    expect(screen.getByText("队列节点 C（不支持对话）")).toBeInTheDocument()
    expect(screen.getByText("无地址节点 D（未配置地址）")).toBeInTheDocument()
    for (const label of ["OpenCode 离线", "Kimi 无对话入口", "GLM 无地址"]) {
      expect(screen.getByText(label).closest('[role="option"]')).toHaveAttribute("aria-disabled", "true")
    }
    expect(screen.getByRole("option", { name: /DeepSeek Chat/ })).not.toHaveAttribute(
      "aria-disabled",
      "true"
    )
  })

  it("tells the user when no node can take a turn", async () => {
    renderChatPage("/chat", {
      catalogLoader: async () => REAL_LIKE_CATALOG.slice(1),
    })
    expect(await screen.findByText(/没有可用的执行节点/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "选择模型或本地 CLI" })).toHaveTextContent("选择运行引擎")
  })

  it("restores the selector from each session's runtime_config and saves it on new sessions", async () => {
    const user = userEvent.setup()
    const { store } = renderChatPage("/chat", { catalogLoader: async () => REAL_LIKE_CATALOG })
    const selector = await screen.findByRole("button", { name: "选择模型或本地 CLI" })
    const sidebar = screen.getByLabelText("历史会话")

    // mock-session-1 (most recent) remembers api:qwen:qwen3.8-flash on node-cloud-1.
    await waitFor(() => expect(selector).toHaveTextContent("千问 Flash"))

    await user.click(within(sidebar).getByText("选题灵感速记与大纲整理"))
    await waitFor(() => expect(selector).toHaveTextContent("DeepSeek Chat"))

    await user.click(within(sidebar).getByText("Agent Harness 内容生产拆解"))
    await waitFor(() => expect(selector).toHaveTextContent("千问 Flash"))

    // Picking a runtime is written back to the active session.
    await user.click(selector)
    await user.click(screen.getByRole("option", { name: /DeepSeek Chat/ }))
    await waitFor(async () => {
      const s1 = (await store.listSessions("mock-org-1")).find((s) => s.id === "mock-session-1")
      expect(s1?.runtimeConfig).toMatchObject({
        node_id: "node-cloud-1",
        runtime_id: "api:deepseek:deepseek-chat",
        thinking_effort: "off",
      })
    })

    // A new session starts with the current selection as its runtime_config.
    await user.click(screen.getByRole("button", { name: "新建对话" }))
    await waitFor(async () => {
      const newest = (await store.listSessions("mock-org-1"))[0]
      expect(newest.id).not.toMatch(/^mock-session-[12]$/)
      expect(newest.runtimeConfig).toMatchObject({
        node_id: "node-cloud-1",
        runtime_id: "api:deepseek:deepseek-chat",
        driver_kind: "api",
      })
    })
  })

  it("falls back and says so when the saved runtime is offline", async () => {
    const catalog = [
      node("node-cloud-1", "云端节点 A", [runtime("api:qwen:qwen3.8-flash", "千问 Flash")], {
        online: false,
      }),
      node("node-cloud-2", "云端节点 B", [runtime("api:deepseek:deepseek-chat", "DeepSeek B")]),
    ]
    renderChatPage("/chat", { catalogLoader: async () => catalog })
    const selector = await screen.findByRole("button", { name: "选择模型或本地 CLI" })
    await waitFor(() => expect(selector).toHaveTextContent("DeepSeek B"))
    expect(screen.getByText(/上次使用的运行时（api:qwen:qwen3.8-flash）当前不可用/)).toBeInTheDocument()
  })
})
