import fs from "node:fs"
import path from "node:path"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { RuntimeNodeCatalog } from "@/modules/chat/types"

const listRuntimeCatalog = vi.fn<(orgId?: string | null, options?: { includeRevoked?: boolean }) => Promise<RuntimeNodeCatalog[]>>()

vi.mock("@/modules/chat/services/runtime-catalog-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/chat/services/runtime-catalog-service")>()
  return { ...actual, listRuntimeCatalog: (...args: Parameters<typeof listRuntimeCatalog>) => listRuntimeCatalog(...args) }
})
vi.mock("@/services/content-workspace-service", () => ({
  getContentWorkspace: () => Promise.resolve({ organization: { id: "org-1", name: "Org" }, canManage: true, canManageOrganization: false }),
}))
vi.mock("@/services/runner-node-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/runner-node-service")>()
  return { ...actual, listRunnerNodes: () => Promise.resolve([]) }
})

import { CliAgentsPage } from "@/pages/cli-agents-page"
import { ModelsIntegrationPage } from "@/pages/models-integration-page"

const CATALOG: RuntimeNodeCatalog[] = [
  {
    nodeId: "n-online",
    nodeName: "云端节点",
    online: true,
    state: "online",
    lastSeenAt: "2026-11-25T09:59:00Z",
    capabilitiesUpdatedAt: "2026-11-25T09:59:00Z",
    protocolVersion: 1,
    supportsHttpSse: true,
    httpEndpointHint: "https://worker.example",
    runtimes: [
      { id: "api:qwen:qwen3.8-flash", kind: "api", provider: "qwen", model: "qwen3.8-flash", label: "Qwen Flash", capabilities: {}, contextWindow: 131072, priced: true, status: "ready" },
      { id: "acp:opencode", kind: "acp", provider: "opencode", model: "local-default", label: "OpenCode ACP", capabilities: { sessions: true }, status: "ready" },
    ],
  },
  {
    nodeId: "n-offline",
    nodeName: "离线节点",
    online: false,
    state: "offline",
    lastSeenAt: "2026-11-24T09:00:00Z",
    protocolVersion: 1,
    supportsHttpSse: true,
    httpEndpointHint: "",
    runtimes: [
      { id: "api:deepseek:deepseek-chat", kind: "api", provider: "deepseek", model: "deepseek-chat", label: "DeepSeek Chat", capabilities: {}, priced: false, status: "unavailable" },
    ],
  },
  {
    nodeId: "n-revoked",
    nodeName: "吊销节点",
    online: false,
    state: "revoked",
    lastSeenAt: null,
    revokedAt: "2026-11-24T09:00:00Z",
    protocolVersion: 1,
    supportsHttpSse: true,
    httpEndpointHint: "",
    runtimes: [
      { id: "acp:codex", kind: "acp", provider: "codex", model: "codex-acp", label: "Codex ACP", capabilities: {}, status: "unverified" },
    ],
  },
]

function renderPage(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe("configuration pages read the node capability catalog", () => {
  const fetchSpy = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response("{}")))

  beforeEach(() => {
    listRuntimeCatalog.mockReset()
    fetchSpy.mockClear()
    vi.stubGlobal("fetch", fetchSpy)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("models page groups api runtimes by node and greys out offline nodes", async () => {
    listRuntimeCatalog.mockResolvedValue(CATALOG)
    renderPage(<ModelsIntegrationPage />)

    expect(await screen.findByText("Qwen Flash")).toBeInTheDocument()
    const groups = screen.getAllByTestId("runtime-node-group")
    expect(groups.map((g) => g.getAttribute("data-node-state"))).toEqual(["online", "offline"])
    expect(within(groups[0]).getByText("云端节点")).toBeInTheDocument()
    expect(within(groups[0]).getByText("已配单价")).toBeInTheDocument()
    expect(within(groups[0]).getByText("128K")).toBeInTheDocument()
    expect(within(groups[0]).queryByText("OpenCode ACP")).not.toBeInTheDocument()
    expect(groups[0]).not.toHaveClass("opacity-60")
    expect(groups[1]).toHaveClass("opacity-60")
    expect(within(groups[1]).getByText("离线")).toBeInTheDocument()
    expect(within(groups[1]).getByText("未计价")).toBeInTheDocument()

    expect(listRuntimeCatalog).toHaveBeenCalledWith("org-1", { includeRevoked: true })
    // No API key inputs, no writes to .env.local.
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/__sense_bridge/env"))).toBe(false)
  })

  it("cli page shows acp runtimes with revoked nodes greyed", async () => {
    listRuntimeCatalog.mockResolvedValue(CATALOG)
    renderPage(<CliAgentsPage />)

    expect(await screen.findByText("OpenCode ACP")).toBeInTheDocument()
    const groups = screen.getAllByTestId("runtime-node-group")
    expect(groups.map((g) => g.getAttribute("data-node-state"))).toEqual(["online", "revoked"])
    expect(within(groups[1]).getByText("已吊销")).toBeInTheDocument()
    expect(groups[1]).toHaveClass("opacity-60")
    expect(screen.queryByText("Qwen Flash")).not.toBeInTheDocument()
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/__sense_bridge/env"))).toBe(false)
  })

  it("shows the empty state with node configuration guidance", async () => {
    listRuntimeCatalog.mockResolvedValue([])
    renderPage(<ModelsIntegrationPage />)
    expect(await screen.findByText("还没有节点上报云端模型")).toBeInTheDocument()
    expect(screen.getAllByText(/SENSE_API_RUNTIMES/).length).toBeGreaterThan(0)

    renderPage(<CliAgentsPage />)
    expect(await screen.findByText("还没有节点上报本机 CLI")).toBeInTheDocument()
    expect(screen.getAllByText(/SENSE_ACP_CLIS/).length).toBeGreaterThan(0)
  })
})

describe("the .env.local write path is gone", () => {
  const root = path.resolve(__dirname, "../..")
  const files = [
    "src/pages/models-integration-page.tsx",
    "src/pages/cli-agents-page.tsx",
  ]

  it.each(files)("%s no longer references /__sense_bridge/env", (file) => {
    const source = fs.readFileSync(path.join(root, file), "utf-8")
    expect(source).not.toMatch(/__sense_bridge\/env/)
    expect(source).not.toMatch(/saveProviderEnvConfig|formatEnvLocalSnippet|writeEnvUpdates/)
  })

  it.each(["src/services/local-bridge-service.ts", "dev/local-bridge-plugin.ts", "dev/local-bridge-guard.ts"])(
    "%s was removed together with the Vite dev bridge (T5)",
    (file) => {
      expect(fs.existsSync(path.join(root, file))).toBe(false)
    }
  )
})
