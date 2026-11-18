import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { QuickCaptureForm } from "@/components/quick-capture/quick-capture-form"
import type { AgentJob, ApprovalRequest } from "@/contracts/agent-job"
import { isQuickCaptureShortcut, parseCaptureInput, type QuickCaptureRequest, type QuickCaptureResult } from "@/contracts/quick-capture"
import { attentionCount, groupStepsByRound, groupTasks } from "@/lib/task-center"

function renderForm(submit: (input: QuickCaptureRequest) => Promise<QuickCaptureResult>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <QuickCaptureForm organizationId="org-1" submit={submit} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const okResult = (over: Partial<QuickCaptureResult> = {}): QuickCaptureResult => ({
  eventId: "e1", intent: "capture_only", duplicate: false, workItemId: null, documents: [], inboxPath: "/intake", itemPath: null, ...over,
})

describe("parseCaptureInput", () => {
  it.each([
    ["", { kind: "empty", url: null, note: null }],
    ["https://example.com/a?b=1", { kind: "url", url: "https://example.com/a?b=1", note: null }],
    ["想写一篇 Agent 评估的文章", { kind: "text", url: null, note: "想写一篇 Agent 评估的文章" }],
    ["https://example.com/a 从企业落地角度写", { kind: "url_with_note", url: "https://example.com/a", note: "从企业落地角度写" }],
    ["看这个：https://example.com/x，很有意思。", { kind: "url_with_note", url: "https://example.com/x", note: "看这个： ，很有意思。" }],
    ["javascript:alert(1)", { kind: "text", url: null, note: "javascript:alert(1)" }],
    ["https://u:p@example.com/ 带凭证", { kind: "text", url: null, note: "https://u:p@example.com/ 带凭证" }],
  ])("%s", (raw, expected) => expect(parseCaptureInput(raw)).toEqual(expected))
})

describe("QuickCaptureForm", () => {
  it("routes capture_only vs auto_draft with platforms", async () => {
    const submit = vi.fn(async (i: QuickCaptureRequest) => okResult({ intent: i.intent }))
    renderForm(submit)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("链接或一句话想法"), "https://example.com/a 角度")
    await user.click(screen.getByRole("button", { name: "收录" }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(submit.mock.calls[0][0]).toMatchObject({ intent: "capture_only", url: "https://example.com/a", note: "角度", platforms: [] })
    expect(await screen.findByText("已收进收件箱")).toBeInTheDocument()

    await user.type(screen.getByLabelText("链接或一句话想法"), "一个想法")
    await user.click(screen.getByRole("button", { name: /自动出稿到待审/ }))
    await user.click(screen.getByRole("checkbox", { name: "小红书" }))
    await user.click(screen.getByRole("button", { name: "收录并自动出稿" }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls[1][0]).toMatchObject({ intent: "auto_draft", url: null, note: "一个想法", platforms: ["xiaohongshu"] })
    expect(submit.mock.calls[1][0].idempotencyKey).not.toBe(submit.mock.calls[0][0].idempotencyKey)
  })

  it("prevents double submit and reuses the key when retrying after an error", async () => {
    let release: (() => void) | null = null
    const submit = vi
      .fn<(i: QuickCaptureRequest) => Promise<QuickCaptureResult>>()
      .mockImplementationOnce(() => new Promise((_, reject) => { release = () => reject(new Error("网络超时")) }))
      .mockImplementationOnce(async () => okResult({ duplicate: true }))
    renderForm(submit)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("链接或一句话想法"), "想法")
    const button = screen.getByRole("button", { name: "收录" })
    await user.click(button)
    await user.click(button)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: /提交中/ })).toBeDisabled()
    release!()
    expect(await screen.findByText(/网络超时/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "收录" }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls[1][0].idempotencyKey).toBe(submit.mock.calls[0][0].idempotencyKey)
    expect(await screen.findByText(/已收录过/)).toBeInTheDocument()
  })

  it("disables submit on empty input", () => {
    renderForm(vi.fn())
    expect(screen.getByRole("button", { name: "收录" })).toBeDisabled()
  })
})

describe("shortcut", () => {
  it("Cmd/Ctrl+K opens the dialog", () => {
    expect(isQuickCaptureShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(true)
    expect(isQuickCaptureShortcut({ key: "K", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false })).toBe(true)
    expect(isQuickCaptureShortcut({ key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBe(false)
    expect(isQuickCaptureShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true })).toBe(false)
  })
})

const job = (id: string, status: AgentJob["status"]): AgentJob => ({
  id, organizationId: "o", workItemId: null, kind: "content_draft", status, payload: {}, result: null, idempotencyKey: id, attempts: 0, maxAttempts: 2,
  runAfter: null, nodeId: null, lockedUntil: null, leaseEpoch: 0, cancelRequestedAt: null, notifiedAt: null, error: null, errorCode: null, createdBy: null,
  createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z",
  target: { type: "content_document", id: `d-${id}`, revision: 1 }, limits: { maxRounds: 3, maxHops: 8, budgetCents: 100, tokenBudget: null }, approvalRequestId: null,
})

describe("task grouping", () => {
  it("groups by human attention and counts pending approvals under 等我拍板", () => {
    const jobs = [job("1", "pending_review"), job("2", "blocked_needs_human"), job("3", "failed"), job("4", "queued"), job("5", "running"), job("6", "succeeded"), job("7", "cancelled")]
    const approvals = [{ id: "a1", status: "pending" }, { id: "a2", status: "approved" }] as ApprovalRequest[]
    const groups = groupTasks(jobs, approvals)
    expect(groups.map((g) => [g.label, g.jobs.map((j) => j.id), g.approvals.map((a) => a.id)])).toEqual([
      ["等我审核", ["1"], []],
      ["等我拍板", ["2"], ["a1"]],
      ["异常阻塞", ["3"], []],
      ["进行中", ["4", "5"], []],
      ["已完成", ["6", "7"], []],
    ])
    expect(attentionCount(groups)).toBe(4)
  })

  it("groups steps by round", () => {
    const s = (round: number, kind: string) => ({ id: `${round}${kind}`, round, kind }) as never
    expect(groupStepsByRound([s(1, "generate"), s(0, "context"), s(1, "check")]).map((r) => [r.round, r.steps.length])).toEqual([[0, 1], [1, 2]])
  })
})
