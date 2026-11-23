import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AgentJob, ApprovalRequest } from "@/contracts/agent-job"

const mocks = vi.hoisted(() => ({
  getContentWorkspace: vi.fn(),
  getTaskCenter: vi.fn(),
  getJobTargets: vi.fn(),
  listRunnerNodes: vi.fn(),
  retryAgentJob: vi.fn(),
  resumeAgentJob: vi.fn(),
  cancelAgentJob: vi.fn(),
  getAgentJob: vi.fn(),
  listAgentJobSteps: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@/services/content-workspace-service", () => ({
  getContentWorkspace: mocks.getContentWorkspace,
}))
vi.mock("@/services/task-center-service", () => ({
  getTaskCenter: mocks.getTaskCenter,
  getJobTargets: mocks.getJobTargets,
}))
vi.mock("@/services/runner-node-service", async () => {
  const actual = await vi.importActual<typeof import("@/services/runner-node-service")>(
    "@/services/runner-node-service",
  )
  return { ...actual, listRunnerNodes: (...args: unknown[]) => mocks.listRunnerNodes(...args) }
})
vi.mock("@/services/agent-job-service", () => ({
  retryAgentJob: mocks.retryAgentJob,
  resumeAgentJob: mocks.resumeAgentJob,
  cancelAgentJob: mocks.cancelAgentJob,
  getAgentJob: mocks.getAgentJob,
  listAgentJobSteps: mocks.listAgentJobSteps,
}))
vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

import { TaskDetailPage } from "@/pages/task-detail-page"
import { TasksPage } from "@/pages/tasks-page"

function makeJob(over: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "job-10000001",
    organizationId: "org-1",
    workItemId: "item-1",
    kind: "content_draft",
    status: "queued",
    payload: { instruction: "撰写深度解析" },
    result: null,
    idempotencyKey: "k-1",
    attempts: 1,
    maxAttempts: 2,
    runAfter: null,
    nodeId: null,
    lockedUntil: null,
    leaseEpoch: 1,
    cancelRequestedAt: null,
    notifiedAt: null,
    error: null,
    errorCode: null,
    createdBy: "user-1",
    createdAt: "2026-11-23T08:00:00Z",
    updatedAt: "2026-11-23T08:05:00Z",
    target: { type: "content_document", id: "doc-1", revision: 1 },
    limits: { maxRounds: 3, maxHops: 8, budgetCents: 100, tokenBudget: null },
    approvalRequestId: null,
    ...over,
  }
}

function renderWithRoutes(initialEntry = "/tasks") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getContentWorkspace.mockResolvedValue({
    organization: { id: "org-1", name: "测试组织" },
    canManage: true,
    canDispatch: true,
  })
  mocks.listRunnerNodes.mockResolvedValue([
    {
      id: "node-1",
      name: "mac-worker",
      revoked_at: null,
      last_seen_at: new Date().toISOString(),
      created_at: "2026-11-23T00:00:00Z",
    },
  ])
  mocks.getJobTargets.mockResolvedValue({})
  mocks.listAgentJobSteps.mockResolvedValue([])
})

describe("TasksPage shadcn table, tabs & real retry", () => {
  it("renders a standard table, status tabs with counts, filters by tab/search, and retries a failed job", async () => {
    const failedJob = makeJob({
      id: "job-fail-1",
      status: "failed",
      error: "模型请求超时",
      errorCode: "timeout",
      target: { type: "content_document", id: "doc-fail", revision: 1 },
    })
    const activeJob = makeJob({
      id: "job-run-1",
      status: "running",
      kind: "video_storyboard",
      payload: { outline: "三十秒解释注意力机制" },
      target: null,
    })
    const blockedJob = makeJob({
      id: "job-block-1",
      status: "blocked_needs_human",
      error: "达到最大轮数",
      target: { type: "content_document", id: "doc-block", revision: 1 },
    })
    const reviewJob = makeJob({
      id: "job-rev-1",
      status: "pending_review",
      result: { written_revision: 2 },
      target: { type: "content_document", id: "doc-rev", revision: 1 },
    })

    const initialData = {
      jobs: [failedJob, activeJob, blockedJob, reviewJob],
      approvals: [] as ApprovalRequest[],
      targets: {
        "doc-fail": {
          targetType: "content_document" as const,
          documentId: "doc-fail",
          title: "失败的公众号稿件",
          platform: "wechat_official",
          workItemId: "wi-1",
        },
        "doc-block": {
          targetType: "content_document" as const,
          documentId: "doc-block",
          title: "待拍板小红书草稿",
          platform: "xiaohongshu",
          workItemId: "wi-2",
        },
        "doc-rev": {
          targetType: "content_document" as const,
          documentId: "doc-rev",
          title: "待审核母稿",
          platform: "master",
          workItemId: "wi-3",
        },
      },
      usage: {
        "job-fail-1": { rounds: 1, evaluatedRounds: 0, hops: 1, tokens: 120, costCents: 1, driver: "cloud", model: "qwen", durationMs: 300, startedAt: null, lastStepAt: null },
        "job-run-1": { rounds: 1, evaluatedRounds: 0, hops: 1, tokens: 80, costCents: 1, driver: "cloud", model: "qwen", durationMs: 200, startedAt: null, lastStepAt: null },
        "job-block-1": { rounds: 3, evaluatedRounds: 3, hops: 6, tokens: 500, costCents: 4, driver: "cloud", model: "qwen", durationMs: 900, startedAt: null, lastStepAt: null },
        "job-rev-1": { rounds: 2, evaluatedRounds: 2, hops: 4, tokens: 400, costCents: 3, driver: "cloud", model: "qwen", durationMs: 600, startedAt: null, lastStepAt: null },
      },
    }

    const retriedJob = makeJob({
      id: "job-retry-2",
      status: "queued",
      payload: { instruction: "撰写深度解析", retry_of: "job-fail-1" },
      idempotencyKey: "retry:job-fail-1:abcd1234",
      target: { type: "content_document", id: "doc-fail", revision: 1 },
    })

    mocks.getTaskCenter
      .mockResolvedValueOnce(initialData)
      .mockResolvedValue({
        ...initialData,
        jobs: [retriedJob, ...initialData.jobs],
      })
    mocks.retryAgentJob.mockResolvedValue(retriedJob)
    mocks.resumeAgentJob.mockResolvedValue({ ...blockedJob, status: "queued" })

    const user = userEvent.setup()
    renderWithRoutes("/tasks")

    expect(await screen.findByRole("heading", { name: "任务中心" })).toBeInTheDocument()
    const table = await screen.findByRole("table")
    expect(table).toBeInTheDocument()

    // Status tabs with counts
    expect(screen.getByRole("tab", { name: /全部\s*4/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /进行中\s*1/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /待审核\s*1/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /待拍板\s*1/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /失败\s*1/ })).toBeInTheDocument()

    // All rows visible initially
    expect(within(table).getByText("失败的公众号稿件")).toBeInTheDocument()
    expect(within(table).getByText("三十秒解释注意力机制")).toBeInTheDocument()
    expect(within(table).getByText("待拍板小红书草稿")).toBeInTheDocument()
    expect(within(table).getByText("待审核母稿")).toBeInTheDocument()

    // Switch to 失败 tab
    await user.click(screen.getByRole("tab", { name: /失败/ }))
    expect(within(table).getByText("失败的公众号稿件")).toBeInTheDocument()
    expect(within(table).queryByText("待审核母稿")).not.toBeInTheDocument()

    // Click real Retry button on the failed job
    await user.click(within(table).getByRole("button", { name: "重试" }))
    await waitFor(() => expect(mocks.retryAgentJob).toHaveBeenCalledWith(failedJob))
    expect(mocks.toastSuccess).toHaveBeenCalledWith("已重新提交任务进入队列")

    // After refetch, failed job shows "已重试" link and "查看重试" instead of duplicate retry button
    expect(await within(table).findByRole("link", { name: "查看重试" })).toHaveAttribute(
      "href",
      "/tasks/job-retry-2",
    )
    expect(within(table).getByText(/已重试：/)).toBeInTheDocument()

    // Switch back to 全部 and test kind Select filter + search + resume
    await user.click(screen.getByRole("tab", { name: /全部/ }))
    await user.click(within(table).getByRole("button", { name: "继续" }))
    await waitFor(() => expect(mocks.resumeAgentJob).toHaveBeenCalledWith("job-block-1", { extraRounds: 1 }))

    const kindSelect = screen.getByRole("combobox", { name: "按任务类型筛选" })
    expect(kindSelect).toHaveTextContent("全部类型")
    await user.click(kindSelect)
    await user.click(await screen.findByRole("option", { name: "视频分镜" }))
    expect(within(table).getByText("三十秒解释注意力机制")).toBeInTheDocument()
    expect(within(table).queryByText("待审核母稿")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "重置" }))
    expect(within(table).getByText("待审核母稿")).toBeInTheDocument()

    await user.type(screen.getByLabelText("搜索任务"), "注意力机制")
    expect(within(table).getByText("三十秒解释注意力机制")).toBeInTheDocument()
    expect(within(table).queryByText("待审核母稿")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "重置" }))
    expect(within(table).getByText("待审核母稿")).toBeInTheDocument()
  })

  it("activates the matching status tab from #group-failed hash and warns when no execution node is online", async () => {
    const queuedJob = makeJob({ id: "job-q-1", status: "queued" })
    const failedJob = makeJob({ id: "job-f-1", status: "failed", error: "网络异常" })

    mocks.listRunnerNodes.mockResolvedValue([
      { id: "n1", name: "mac", revoked_at: null, last_seen_at: null, created_at: "2026-11-23T00:00:00Z" },
    ])
    mocks.getTaskCenter.mockResolvedValue({
      jobs: [queuedJob, failedJob],
      approvals: [
        {
          id: "appr-1",
          organizationId: "org-1",
          action: "paid_video_render",
          targetType: "video_plan",
          targetId: "plan-1",
          targetRevision: 1,
          status: "pending",
          summary: "云端镜头付费渲染确认",
          payload: {},
          estimatedCostCents: 35,
          requestedByJob: null,
          requestedBy: "user-1",
          decidedBy: null,
          decidedAt: null,
          reason: "",
          expiresAt: "2026-11-30T00:00:00Z",
          createdAt: "2026-11-23T08:00:00Z",
        },
      ],
      targets: {
        "doc-1": {
          targetType: "content_document",
          documentId: "doc-1",
          title: "关联稿件标题",
          platform: "master",
          workItemId: "wi-1",
        },
      },
      usage: {},
    })

    renderWithRoutes("/tasks#group-failed")

    const failedTab = await screen.findByRole("tab", { name: /失败/ })
    expect(failedTab).toHaveAttribute("aria-selected", "true")
    expect(await screen.findByText(/当前没有在线执行节点/)).toBeInTheDocument()
    expect(screen.getByText("网络异常")).toBeInTheDocument()
  })

  it("cancels an active job from the row action menu", async () => {
    const runningJob = makeJob({ id: "job-run-cancel", status: "running" })
    mocks.getTaskCenter.mockResolvedValue({
      jobs: [runningJob],
      approvals: [],
      targets: {
        "doc-1": {
          targetType: "content_document",
          documentId: "doc-1",
          title: "运行中稿件",
          platform: "master",
          workItemId: "wi-1",
        },
      },
      usage: {},
    })
    mocks.cancelAgentJob.mockResolvedValue({ ...runningJob, cancelRequestedAt: "2026-11-23T09:00:00Z" })

    const user = userEvent.setup()
    renderWithRoutes("/tasks")

    const menuTrigger = await screen.findByRole("button", { name: "更多操作 运行中稿件" })
    await user.click(menuTrigger)
    await user.click(await screen.findByRole("menuitem", { name: "取消任务" }))

    await waitFor(() => expect(mocks.cancelAgentJob).toHaveBeenCalledWith("job-run-cancel"))
    expect(mocks.toastSuccess).toHaveBeenCalledWith("已请求取消任务")
  })
})

describe("TaskDetailPage retry action", () => {
  it("retries a failed job and navigates to the new task detail page", async () => {
    const failedJob = makeJob({
      id: "job-old-detail",
      status: "failed",
      error: "模型请求失败",
      errorCode: "provider_error",
    })
    const retriedJob = makeJob({
      id: "job-new-detail",
      status: "queued",
      payload: { instruction: "撰写深度解析", retry_of: "job-old-detail" },
      idempotencyKey: "retry:job-old-detail:abcd1234",
    })

    mocks.getAgentJob.mockImplementation(async (id: string) =>
      id === "job-new-detail" ? retriedJob : failedJob,
    )
    mocks.getJobTargets.mockResolvedValue({
      "doc-1": {
        targetType: "content_document",
        documentId: "doc-1",
        title: "重试详情测试稿件",
        platform: "master",
        workItemId: "item-1",
      },
    })
    mocks.retryAgentJob.mockResolvedValue(retriedJob)

    const user = userEvent.setup()
    renderWithRoutes("/tasks/job-old-detail")

    const retryBtn = await screen.findByRole("button", { name: "重试任务" })
    await user.click(retryBtn)

    await waitFor(() => expect(mocks.retryAgentJob).toHaveBeenCalledWith(failedJob))
    expect(await screen.findByText(/重试自 #job-old-/)).toBeInTheDocument()
  })
})
