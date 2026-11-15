import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { resolveNavigation } from "@/config/navigation"
import { ChatAssistantPage } from "@/pages/chat-assistant-page"
import { CliAgentsPage } from "@/pages/cli-agents-page"
import { ModelsIntegrationPage } from "@/pages/models-integration-page"
import {
  buildFallbackBridgeStatus,
  CLI_INSTALL_GUIDES,
  formatEnvLocalSnippet,
} from "@/services/local-bridge-service"

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

describe("P3: Models Integration, Local CLI Agents & Chat Assistant Pages", () => {
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

  it("formats .env.local snippet with provider and CONTENT_AI default keys", () => {
    const snippet = formatEnvLocalSnippet({
      providerKey: "qwen",
      apiKey: "sk-test-123456",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen3.7-max",
      setAsDefault: true,
    })

    expect(snippet).toContain('SENSE_LLM_QWEN_API_KEY="sk-test-123456"')
    expect(snippet).toContain('SENSE_DEFAULT_LLM_PROVIDER="qwen"')
    expect(snippet).toContain('CONTENT_AI_MODEL="qwen3.7-max"')
  })

  it("provides installation & auth commands for codex, agy, pi, and opencode CLIs", () => {
    expect(CLI_INSTALL_GUIDES["codex-cli"].installCommand).toContain(
      "@openai/codex"
    )
    expect(CLI_INSTALL_GUIDES["pi-cli"].installCommand).toContain(
      "pi-coding-agent"
    )
    expect(CLI_INSTALL_GUIDES["opencode-cli"].installCommand).toContain(
      "opencode-ai"
    )
    expect(CLI_INSTALL_GUIDES["agy-cli"].verifyCommand).toBe("agy --version")

    const fallback = buildFallbackBridgeStatus()
    expect(fallback.providers.length).toBeGreaterThanOrEqual(5)
    expect(fallback.cliDrivers.length).toBe(4)
  })

  it("renders ModelsIntegrationPage with domestic model cards and .env.local save controls", () => {
    renderWithProviders(<ModelsIntegrationPage />, "/system/models")
    expect(
      screen.getByRole("heading", { name: "国内大模型接入" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("通义千问 (Qwen / DashScope)")
    ).toBeInTheDocument()
    expect(screen.getByText("Kimi (Moonshot AI)")).toBeInTheDocument()
    expect(screen.getByText("DeepSeek (深度求索)")).toBeInTheDocument()
  })

  it("renders CliAgentsPage with CLI installation guides and test controls", () => {
    renderWithProviders(<CliAgentsPage />, "/system/cli-agents")
    expect(
      screen.getByRole("heading", { name: "本地 CLI 接入" })
    ).toBeInTheDocument()
    expect(screen.getByText("Codex CLI")).toBeInTheDocument()
    expect(screen.getByText("Antigravity CLI (agy)")).toBeInTheDocument()
    expect(screen.getByText("Pi Coding Agent CLI")).toBeInTheDocument()
    expect(screen.getByText("OpenCode CLI")).toBeInTheDocument()
  })

  it("renders ChatAssistantPage in both Console mode and standalone H5 mode", () => {
    const { unmount } = renderWithProviders(<ChatAssistantPage />, "/chat")
    expect(
      screen.getByRole("heading", { name: "星火智能对话与极简速记台" })
    ).toBeInTheDocument()
    expect(screen.getByText("打开独立 H5 版")).toBeInTheDocument()
    unmount()

    renderWithProviders(<ChatAssistantPage standaloneH5 />, "/h5/chat")
    expect(screen.getByText("H5 移动速记与对话端")).toBeInTheDocument()
    expect(screen.getByText("返回管理后台视图")).toBeInTheDocument()
  })
})
