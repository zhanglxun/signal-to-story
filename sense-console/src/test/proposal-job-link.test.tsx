import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/services/agent-job-service", () => ({ getAgentJob: vi.fn().mockResolvedValue({ id: "j1", rounds: 3 }) }))

import { ProposalJobLink } from "@/components/content/proposal-job-link"

describe("ProposalJobLink", () => {
  it("shows the task origin, evaluated rounds and a /tasks/:id link", async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ProposalJobLink jobId="j1" /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByText(/评估了 3 轮/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "查看任务" })).toHaveAttribute("href", "/tasks/j1")
  })
})
