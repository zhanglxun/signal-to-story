import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

const svc = vi.hoisted(() => ({ getTaskCenter: vi.fn(), getContentWorkspace: vi.fn() }))
vi.mock("@/services/task-center-service", () => ({ getTaskCenter: svc.getTaskCenter }))
vi.mock("@/services/content-workspace-service", () => ({ getContentWorkspace: svc.getContentWorkspace }))

import { TaskAttentionCard } from "@/components/task-attention-card"

const job = (id: string, status: string) => ({ id, status })

beforeEach(() => {
  svc.getContentWorkspace.mockResolvedValue({ organization: { id: "o1" } })
  svc.getTaskCenter.mockResolvedValue({
    jobs: [job("1", "pending_review"), job("2", "pending_review"), job("3", "blocked_needs_human"), job("4", "failed"), job("5", "running"), job("6", "succeeded")],
    approvals: [{ id: "a", status: "pending" }],
    targets: {},
  })
})

describe("TaskAttentionCard", () => {
  it("counts the three human-attention groups and links to the matching /tasks group", async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><TaskAttentionCard /></MemoryRouter></QueryClientProvider>)
    await waitFor(() => expect(screen.getByTestId("attention-review")).toHaveTextContent("2"))
    expect(screen.getByTestId("attention-decide")).toHaveTextContent("2") // 1 job + 1 pending approval
    expect(screen.getByTestId("attention-failed")).toHaveTextContent("1")
    expect(screen.getByText("等我审核").closest("a")).toHaveAttribute("href", "/tasks#group-review")
    expect(screen.getByText("异常阻塞").closest("a")).toHaveAttribute("href", "/tasks#group-failed")
  })
})
