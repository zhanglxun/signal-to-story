import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AgentJob, JobUsage } from "@/contracts/agent-job"
import type { ContentDocument } from "@/contracts/content"
import type { RunnerNode } from "@/services/runner-node-service"

const mockEnqueue = vi.fn()
const mockListJobs = vi.fn()
const mockListJobUsage = vi.fn()
const mockListRunnerNodes = vi.fn()
const mockDocumentHistory = vi.fn()
const mockSaveDocument = vi.fn()
const mockReviewDocument = vi.fn()
const mockApproveDirectly = vi.fn()

vi.mock("@/services/agent-job-service", () => ({
  enqueueContentDraftJob: (...args: unknown[]) => mockEnqueue(...args),
  listAgentJobs: (...args: unknown[]) => mockListJobs(...args),
  listJobUsage: (...args: unknown[]) => mockListJobUsage(...args),
}))
vi.mock("@/services/runner-node-service", async () => {
  const actual = await vi.importActual<typeof import("@/services/runner-node-service")>("@/services/runner-node-service")
  return { ...actual, listRunnerNodes: (...args: unknown[]) => mockListRunnerNodes(...args) }
})
vi.mock("@/services/content-service", () => ({
  documentHistory: (...args: unknown[]) => mockDocumentHistory(...args),
  saveDocument: (...args: unknown[]) => mockSaveDocument(...args),
  reviewDocument: (...args: unknown[]) => mockReviewDocument(...args),
  approveDocumentDirectly: (...args: unknown[]) => mockApproveDirectly(...args),
}))
vi.mock("@/services/decision-memory-service", () => ({ createDecisionMemory: vi.fn() }))
vi.mock("@/components/content/site-publish-panel", () => ({ SitePublishPanel: () => null }))

import { DocumentEditor } from "@/components/content/document-editor"

function makeDoc(over: Partial<ContentDocument> = {}): ContentDocument {
  return {
    id: "doc-1",
    organization_id: "org-1",
      work_item_id: "item-1",
    platform: "master",
    title: "初始标题",
    body: "初始正文",
    status: "draft",
    revision: 1,
    review_note: "",
    updated_at: "2026-11-22T00:00:00Z",
    ...over,
  }
}

function makeJob(over: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "job-1",
    organizationId: "org-1",
    workItemId: "item-1",
    kind: "content_draft",
    status: "queued",
    payload: { instruction: "扩写" },
    result: null,
    idempotencyKey: "k1",
    attempts: 0,
    maxAttempts: 2,
    runAfter: null,
    nodeId: null,
    lockedUntil: null,
    leaseEpoch: 0,
    cancelRequestedAt: null,
    notifiedAt: null,
    error: null,
    errorCode: null,
    createdBy: "u-1",
    createdAt: "2026-11-22T00:00:00Z",
    updatedAt: "2026-11-22T00:00:00Z",
    target: { type: "content_document", id: "doc-1", revision: 1 },
    limits: { maxRounds: 3, maxHops: 8, budgetCents: 100, tokenBudget: null },
    approvalRequestId: null,
    ...over,
  }
}

function makeNode(lastSeenAt: string | null): RunnerNode {
  return { id: "node-1", name: "mac", revoked_at: null, last_seen_at: lastSeenAt, created_at: "2026-11-22T00:00:00Z" }
}

function renderEditor(doc = makeDoc(), qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const ui = (d: ContentDocument) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DocumentEditor document={d} canEdit canReview />
      </MemoryRouter>
    </QueryClientProvider>
  )
  const res = render(ui(doc))
  return { ...res, rerenderDoc: (next: ContentDocument) => res.rerender(ui(next)) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDocumentHistory.mockResolvedValue([])
  mockListJobs.mockResolvedValue([])
  mockListJobUsage.mockResolvedValue({} satisfies Record<string, JobUsage>)
  mockListRunnerNodes.mockResolvedValue([makeNode(new Date().toISOString())])
  mockEnqueue.mockResolvedValue({ jobId: "job-1", status: "queued", duplicate: false })
})

describe("DocumentEditor (DB2c-3 direct draft)", () => {
  it("queues a content_draft job and shows its status + /tasks/:id link", async () => {
    const user = userEvent.setup()
    mockListJobs
      .mockResolvedValueOnce([])
      .mockResolvedValue([makeJob({ id: "job-1", status: "pending_review", result: { written_revision: 2 } })])
    mockListJobUsage.mockResolvedValue({
      "job-1": { rounds: 2, evaluatedRounds: 2, hops: 4, tokens: 320, costCents: 1, driver: "cloud", model: "qwen", durationMs: 900, startedAt: null, lastStepAt: null },
    })

    renderEditor()
    await user.click(screen.getByRole("button", { name: "交给 Agent 出稿" }))

    await waitFor(() => expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ documentId: "doc-1" })))
    expect(await screen.findByRole("link", { name: "查看任务进度" })).toHaveAttribute("href", "/tasks/job-1")
    expect(await screen.findByText("已写入 v2")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "查看执行记录" })).toHaveAttribute("href", "/tasks/job-1")
  })

  it("displays the newly written v2 body automatically when there are no unsaved edits", async () => {
    const { rerenderDoc } = renderEditor(makeDoc({ revision: 1, body: "初始正文" }))
    expect(screen.getByDisplayValue("初始正文")).toBeInTheDocument()

    rerenderDoc(makeDoc({ revision: 2, body: "AI 直接写入的 v2 正文" }))
    expect(await screen.findByDisplayValue("AI 直接写入的 v2 正文")).toBeInTheDocument()
    expect(screen.getByText("v2")).toBeInTheDocument()
  })

  it("preserves unsaved local edits and lets the user reload when cloud revision changes", async () => {
    const user = userEvent.setup()
    const { rerenderDoc } = renderEditor(makeDoc({ revision: 1, body: "初始正文" }))

    const textarea = screen.getByDisplayValue("初始正文")
    await user.clear(textarea)
    await user.type(textarea, "人工未保存草稿")

    rerenderDoc(makeDoc({ revision: 2, body: "云端 v2 正文" }))
    expect(screen.getByDisplayValue("人工未保存草稿")).toBeInTheDocument()
    expect(screen.getByText(/云端稿件已变化，当前输入仍保留/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "载入云端版本" }))
    expect(screen.getByDisplayValue("云端 v2 正文")).toBeInTheDocument()
  })

  it("warns with a link to /system/cli-agents when no runner node is online", async () => {
    mockListRunnerNodes.mockResolvedValue([makeNode(null)])
    renderEditor()
    expect(await screen.findByText(/当前没有在线执行节点/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "管理执行节点" })).toHaveAttribute("href", "/system/cli-agents")
  })

  it("defaults to formatted Markdown preview for AI pending_review drafts with [待核实] warning, and supports mode switching & solo direct approval", async () => {
    const user = userEvent.setup()
    const v2 = makeDoc({ revision: 2, status: "draft", body: "## 结论\n\n**加粗结论**。\n\n[待核实] 用户数。" })
    mockListJobs.mockResolvedValue([makeJob({ status: "pending_review", result: { written_revision: 2 } })])
    mockApproveDirectly.mockResolvedValue({ ...v2, status: "approved" })

    renderEditor(v2)
    expect(await screen.findByTestId("markdown-preview")).toBeInTheDocument()
    expect(screen.getByText(/含 1 处 \[待核实\]/)).toBeInTheDocument()
    expect(screen.getByText("加粗结论").tagName).toBe("STRONG")

    await user.click(screen.getByRole("tab", { name: "编辑原文" }))
    expect(screen.getByLabelText("正文（Markdown）")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "双栏对照" }))
    expect(screen.getByTestId("markdown-preview")).toBeInTheDocument()
    expect(screen.getByLabelText("正文（Markdown）")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "确认并定稿" }))
    await waitFor(() => expect(mockApproveDirectly).toHaveBeenCalledWith(v2, ""))
  })

  it("requires a rejection reason in dialog when sending changes_requested on in_review doc", async () => {
    const user = userEvent.setup()
    const reviewDoc = makeDoc({ status: "in_review", revision: 2, body: "## 正文" })
    mockReviewDocument.mockResolvedValue({ ...reviewDoc, status: "changes_requested" })

    renderEditor(reviewDoc)
    await user.click(screen.getByRole("button", { name: "退回修改" }))
    const confirm = await screen.findByRole("button", { name: "确认退回修改" })
    expect(confirm).toBeDisabled()

    await user.type(screen.getByLabelText("退回原因"), "请补充真实来源链接")
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await waitFor(() =>
      expect(mockReviewDocument).toHaveBeenCalledWith(reviewDoc, "changes_requested", "请补充真实来源链接")
    )
  })
})
