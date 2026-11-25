import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { WorkItemsPage } from "@/pages/work-items-page"

const mockCreateWorkItem = vi.fn().mockResolvedValue({
  id: "w-new",
  organization_id: "org-1",
  kind: "article",
  title: "新建的事项标题",
  brief: { text: "测试 Brief", content_kind: "explainer", target_seconds: 300, aspect_ratio: "9:16" },
  category_id: null,
  status: "todo",
  created_by: "u-1",
  created_at: "2026-11-19T05:00:00Z",
  updated_at: "2026-11-19T05:00:00Z",
})

vi.mock("@/hooks/use-content-data", () => ({
  useContentData: vi.fn().mockReturnValue({
    loading: false,
    error: null,
    workspace: {
      organization: { id: "org-1", name: "测试组织" },
      canManage: true,
    },
    data: {
      workItems: [
        {
          id: "w-1",
          organization_id: "org-1",
          kind: "article",
          title: "企业 Agent 落地复盘",
          brief: { text: "聚焦 ROI 与真实交付边界" },
          category_id: 10,
          status: "todo",
          created_by: "u-1",
          created_at: "2026-11-19T01:00:00Z",
          updated_at: "2026-11-19T02:00:00Z",
        },
      ],
      documents: [
        {
          id: "d-1",
          organization_id: "org-1",
          work_item_id: "w-1",
          platform: "master",
          title: "母稿",
          body: "正文",
          status: "approved",
          revision: 1,
        },
      ],
    },
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

vi.mock("@/services/work-item-service", () => ({
  createWorkItem: (...args: unknown[]) => mockCreateWorkItem(...args),
  updateWorkItem: vi.fn(),
  setWorkItemStatus: vi.fn(),
}))

function renderWorkItems() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/work-items"]}>
        <WorkItemsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("WorkItemsPage table & dialogs", () => {
  it("renders standard data table with category & status and opens create dialog", async () => {
    const user = userEvent.setup()
    renderWorkItems()

    expect(
      screen.getByRole("heading", { name: "事项" })
    ).toBeInTheDocument()
    expect(screen.getByRole("table")).toBeInTheDocument()
    expect(screen.getByText("企业 Agent 落地复盘")).toBeInTheDocument()
    expect(await screen.findByText("AI 工程")).toBeInTheDocument()
    expect(screen.getByText("1 份 · 1 已通过")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "查看" })).toBeInTheDocument()

    // Open create dialog from top-right button
    await user.click(screen.getByRole("button", { name: "新建事项" }))
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toBeInTheDocument()

    const titleInput = screen.getByRole("textbox", { name: "标题" })
    await user.type(titleInput, "新建的事项标题")
    await user.click(screen.getByRole("button", { name: "创建事项" }))

    expect(mockCreateWorkItem).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ title: "新建的事项标题" })
    )
  })
})
