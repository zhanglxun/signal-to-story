import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ContentDocument } from "@/contracts/content"
import type { WorkItem } from "@/contracts/work-item"

const mockGetWorkItem = vi.fn()
const mockListDocs = vi.fn()
const mockListInputs = vi.fn()
const mockSetStatus = vi.fn()

vi.mock("@/services/content-workspace-service", () => ({
  getContentWorkspace: vi.fn().mockResolvedValue({
    organization: { id: "org-1", name: "测试组织" },
    canManage: true,
    canReview: true,
    canPublish: true,
    canManageOrganization: true,
  }),
}))
vi.mock("@/services/work-item-service", () => ({
  getWorkItem: (...args: unknown[]) => mockGetWorkItem(...args),
  listWorkItemDocuments: (...args: unknown[]) => mockListDocs(...args),
  listWorkItemInputs: (...args: unknown[]) => mockListInputs(...args),
  setWorkItemStatus: (...args: unknown[]) => mockSetStatus(...args),
  updateWorkItem: vi.fn(),
  createWorkItemDocument: vi.fn(),
}))
vi.mock("@/services/source-category-service", () => ({
  getSourceCategories: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/services/content-service", () => ({
  approveDocumentDirectly: vi.fn(),
  reviewDocument: vi.fn(),
  saveDocument: vi.fn(),
  documentHistory: vi.fn().mockResolvedValue([]),
  setPublishedUrl: vi.fn(),
}))
vi.mock("@/services/agent-job-service", () => ({
  enqueueContentDraftJob: vi.fn(),
  listAgentJobs: vi.fn().mockResolvedValue([]),
  listJobUsage: vi.fn().mockResolvedValue({}),
}))
vi.mock("@/services/runner-node-service", async () => {
  const actual = await vi.importActual<typeof import("@/services/runner-node-service")>("@/services/runner-node-service")
  return { ...actual, listRunnerNodes: vi.fn().mockResolvedValue([]) }
})
vi.mock("@/services/site-publish-service", () => ({
  listSitePublishApprovals: vi.fn().mockResolvedValue([]),
}))

import { WorkItemDetailPage } from "@/pages/work-item-detail-page"
import { ContentOverviewPage } from "@/pages/content-overview-page"
import * as useContentDataHook from "@/hooks/use-content-data"

const baseItem: WorkItem = {
  id: "w-flomo",
  organization_id: "org-1",
  kind: "article",
  title: "搜索和分析一下这个产品： flomo",
  brief: { text: "研究卡片笔记设计理念" },
  category_id: null,
  status: "done",
  created_by: "u-1",
  created_at: "2026-11-23T01:00:00Z",
  updated_at: "2026-11-23T02:00:00Z",
}

const draftMaster: ContentDocument = {
  id: "d-master",
  organization_id: "org-1",
  work_item_id: "w-flomo",
  platform: "master",
  title: "flomo 产品拆解",
  body: "## 核心观察\n\nflomo 把记录成本降到最低。\n\n[待核实] 具体上线年份。",
  revision: 2,
  status: "draft",
  review_note: "",
  updated_at: "2026-11-23T03:00:00Z",
}

function renderDetail(itemId = "w-flomo") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/work-items/${itemId}`]}>
        <Routes>
          <Route path="/work-items/:workItemId" element={<WorkItemDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetWorkItem.mockResolvedValue(baseItem)
  mockListDocs.mockResolvedValue([draftMaster])
  mockListInputs.mockResolvedValue([])
})

describe("WorkItemDetailPage guided workflow", () => {
  it("shows the 4-step progress strip and highlights the done-without-approval recovery action", async () => {
    renderDetail()

    expect(
      await screen.findByRole("list", { name: "创作流程进度" })
    ).toBeInTheDocument()
    expect(screen.getByText(/1\. 准备与出稿/)).toBeInTheDocument()
    expect(screen.getByText(/2\. 审阅与定稿/)).toBeInTheDocument()
    expect(screen.getByText(/3\. 发布与分发/)).toBeInTheDocument()
    expect(screen.getByText(/4\. 归档完成/)).toBeInTheDocument()

    expect(
      screen.getByText("事项已归档，但稿件尚未定稿")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "补做定稿" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "切回待审核" })
    ).toBeInTheDocument()
  })

  it("shows step 2 solo 1-click approval CTA when the card is waiting in review with a draft", async () => {
    mockGetWorkItem.mockResolvedValue({ ...baseItem, status: "review" })
    renderDetail()

    await waitFor(() =>
      expect(
        screen.getByText("AI 草稿已就绪，请审阅并定稿")
      ).toBeInTheDocument()
    )
    expect(
      screen.getByRole("button", { name: "一键确认并定稿" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "确认并定稿" })
    ).toBeInTheDocument()
  })
})

describe("ContentOverviewPage Review Center (unified queue)", () => {
  it("lists work_items in review status whose draft has not been submitted yet", () => {
    vi.spyOn(useContentDataHook, "useContentData").mockReturnValue({
      loading: false,
      error: null,
      workspace: {
        organization: { id: "org-1", name: "测试组织" },
        canManage: true,
        canReview: true,
      },
      data: {
        workItems: [{ ...baseItem, status: "review" }],
        documents: [draftMaster],
      },
    })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/content/reviews"]}>
          <ContentOverviewPage mode="reviews" />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByRole("heading", { name: "审核中心" })).toBeInTheDocument()
    expect(screen.getByText("flomo 产品拆解")).toBeInTheDocument()
    expect(screen.getByText("AI 草稿待审阅")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "去审阅定稿" })).toHaveAttribute(
      "href",
      "/work-items/w-flomo"
    )
  })
})
