import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { IntakePage } from "@/pages/intake-page"

const mockRecordManualInput = vi.fn().mockResolvedValue({
  id: "e-new",
  organization_id: "org-1",
  source: "web",
  connection_id: null,
  external_id: "ext-new",
  text: "新线索标题",
  url: "https://example.com/new",
  payload: {},
  work_item_id: null,
  ignored_at: null,
  created_by: "u-1",
  created_at: "2026-11-19T05:00:00Z",
})

vi.mock("@/services/content-workspace-service", () => ({
  getContentWorkspace: vi.fn().mockResolvedValue({
    organization: { id: "org-1", name: "测试组织" },
    canManage: true,
  }),
}))

vi.mock("@/services/source-category-service", () => ({
  getSourceCategories: vi.fn().mockResolvedValue([
    {
      id: 10,
      organizationId: "org-1",
      parentId: null,
      name: "AI 工程",
      iconUrl: null,
      sortOrder: 1,
      isActive: true,
      description: null,
      createdBy: "u-1",
      createdAt: "2026-11-19T00:00:00Z",
      updatedBy: "u-1",
      updatedAt: "2026-11-19T00:00:00Z",
    },
  ]),
}))

vi.mock("@/services/intake-service", () => ({
  listInbox: vi.fn().mockResolvedValue({
    events: [
      {
        id: "e-1",
        organization_id: "org-1",
        source: "im",
        connection_id: "conn-1",
        external_id: "ext-1",
        text: "AI Agent 工作流拆解\n补充一句背景说明",
        url: "https://example.com/agent",
        payload: { category_id: 10 },
        work_item_id: null,
        ignored_at: null,
        created_by: "u-1",
        created_at: "2026-11-19T04:00:00Z",
      },
    ],
    totalCount: 1,
  }),
  recordManualInput: (...args: unknown[]) => mockRecordManualInput(...args),
  promoteInput: vi.fn(),
  attachInput: vi.fn(),
  ignoreInput: vi.fn(),
  ignoreInputs: vi.fn(),
}))

vi.mock("@/services/work-item-service", () => ({
  listWorkItems: vi.fn().mockResolvedValue([
    {
      id: "w-1",
      organization_id: "org-1",
      kind: "article",
      title: "已有测试事项",
      brief: {},
      category_id: null,
      status: "todo",
      created_by: "u-1",
      created_at: "2026-11-19T01:00:00Z",
      updated_at: "2026-11-19T01:00:00Z",
    },
  ]),
}))

function renderIntake() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/intake"]}>
        <IntakePage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("IntakePage table & create dialog", () => {
  it("renders standard data table with category & promote action and submits create dialog", async () => {
    const user = userEvent.setup()
    renderIntake()

    expect(
      await screen.findByRole("heading", { name: "收件箱" })
    ).toBeInTheDocument()
    expect(screen.getByRole("table")).toBeInTheDocument()
    expect(await screen.findByText("AI Agent 工作流拆解")).toBeInTheDocument()
    expect(screen.getByText("IM")).toBeInTheDocument()
    expect(await screen.findByText("AI 工程")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "转为事项" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "打开链接 AI Agent 工作流拆解" })).toBeInTheDocument()

    // Open top-right create dialog and submit
    await user.click(screen.getByRole("button", { name: "新建输入" }))
    expect(
      screen.getByRole("heading", { name: "新建输入" })
    ).toBeInTheDocument()

    await user.type(
      screen.getByPlaceholderText("一句想法、一段摘录…"),
      "新线索标题"
    )
    await user.type(
      screen.getByPlaceholderText("https://"),
      "https://example.com/new"
    )
    await user.click(screen.getByRole("button", { name: "创建" }))

    expect(mockRecordManualInput).toHaveBeenCalledWith("org-1", {
      text: "新线索标题",
      url: "https://example.com/new",
      categoryId: null,
    })
  })
})
