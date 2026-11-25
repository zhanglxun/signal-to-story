import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { resolveNavigation } from "@/config/navigation"
import { CliAgentsPage } from "@/pages/cli-agents-page"
import { ModelsIntegrationPage } from "@/pages/models-integration-page"

function renderWithProviders(ui: React.ReactElement, initialRoute = "/") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe("P3: Models Integration and Local CLI Agents pages", () => {
  it("resolves navigation routes for /chat, /system/models, /system/cli-agents, and /h5/chat", () => {
    expect(resolveNavigation("/chat").activeItem?.id).toBe("chat-assistant")
    expect(resolveNavigation("/system/models").activeItem?.id).toBe(
      "models-integration"
    )
    expect(resolveNavigation("/system/cli-agents").activeItem?.id).toBe(
      "cli-agents"
    )
    expect(resolveNavigation("/h5/chat").activeModule.id).toBe("workspace")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("renders the configuration pages from the node capability catalog", async () => {
    // The mock catalog is only served under VITE_CHAT_TRANSPORT=mock (T5); tests run without Supabase.
    vi.stubEnv("VITE_CHAT_TRANSPORT", "mock")
    const { unmount } = renderWithProviders(<ModelsIntegrationPage />, "/system/models")
    expect(
      screen.getByRole("heading", { name: "国内大模型接入" })
    ).toBeInTheDocument()
    expect(await screen.findByText("通义千问 Qwen 3.8 Flash")).toBeInTheDocument()
    unmount()

    renderWithProviders(<CliAgentsPage />, "/system/cli-agents")
    expect(
      screen.getByRole("heading", { name: "本地 CLI 接入" })
    ).toBeInTheDocument()
    expect(await screen.findByText("OpenCode CLI (本机 ACP)")).toBeInTheDocument()
  })
})
