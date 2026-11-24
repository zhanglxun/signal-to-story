import type { ChatRuntimeConfig, RuntimeEntry, RuntimeNodeCatalog } from "@/modules/chat/types"

const MOCK_RUNTIME_CATALOG: RuntimeNodeCatalog[] = [
  {
    nodeId: "node-cloud-1",
    nodeName: "云端常驻节点 · Cloud Worker",
    online: true,
    lastSeenAt: new Date().toISOString(),
    protocolVersion: 1,
    supportsHttpSse: true,
    httpEndpointHint: "https://worker-mock.local",
    runtimes: [
      {
        id: "api:qwen:qwen3.8-flash",
        kind: "api",
        provider: "qwen",
        model: "qwen3.8-flash",
        label: "通义千问 Qwen 3.8 Flash",
        capabilities: { streaming: true, reasoning: true, tools: true },
        contextWindow: 131072,
        maxOutputTokens: 8192,
        priced: true,
        status: "ready",
      },
      {
        id: "api:deepseek:deepseek-chat",
        kind: "api",
        provider: "deepseek",
        model: "deepseek-chat",
        label: "DeepSeek Chat",
        capabilities: { streaming: true, reasoning: false, tools: true },
        contextWindow: 65536,
        maxOutputTokens: 8192,
        priced: true,
        status: "ready",
      },
      {
        id: "api:deepseek:deepseek-reasoner",
        kind: "api",
        provider: "deepseek",
        model: "deepseek-reasoner",
        label: "DeepSeek Reasoner",
        capabilities: { streaming: true, reasoning: true, tools: true },
        contextWindow: 65536,
        maxOutputTokens: 8192,
        priced: true,
        status: "ready",
      },
    ],
  },
  {
    nodeId: "node-local-acp-1",
    nodeName: "本机开发节点 · MacBook ACP",
    online: true,
    lastSeenAt: new Date().toISOString(),
    protocolVersion: 1,
    supportsHttpSse: true,
    httpEndpointHint: "http://localhost:4310",
    runtimes: [
      {
        id: "acp:opencode-cli",
        kind: "acp",
        provider: "opencode",
        model: "local-default",
        label: "OpenCode CLI (本机 ACP)",
        capabilities: { streaming: true, reasoning: true, tools: true, sessions: true },
        contextWindow: 128000,
        priced: false,
        status: "ready",
      },
      {
        id: "acp:codex-cli",
        kind: "acp",
        provider: "codex",
        model: "codex-acp",
        label: "Codex CLI (本机 ACP)",
        capabilities: { streaming: true, reasoning: true, tools: true, sessions: true },
        contextWindow: 200000,
        priced: false,
        status: "ready",
      },
    ],
  },
  {
    nodeId: "node-local-offline-1",
    nodeName: "备用节点 · Studio Workstation",
    online: false,
    lastSeenAt: null,
    protocolVersion: 1,
    supportsHttpSse: true,
    httpEndpointHint: "http://localhost:4311",
    runtimes: [
      {
        id: "acp:claude-cli",
        kind: "acp",
        provider: "claude",
        model: "claude-agent-acp",
        label: "Claude Code (ACP)",
        capabilities: { streaming: true, reasoning: true, tools: true, sessions: true },
        contextWindow: 200000,
        priced: false,
        status: "unavailable",
      },
    ],
  },
]

/**
 * Runtime & Model Catalog data source abstraction.
 * Wave 1 returns a mock catalog shaped identically to docs/modules/chat.md §3.4;
 * Wave 2 will read `runner_nodes.capabilities` from Supabase after DB3b lands.
 */
export async function listRuntimeCatalog(_organizationId?: string | null): Promise<RuntimeNodeCatalog[]> {
  void _organizationId
  return MOCK_RUNTIME_CATALOG.map((node) => ({
    ...node,
    runtimes: node.runtimes.map((r) => ({ ...r, capabilities: { ...r.capabilities } })),
  }))
}

export interface SelectedRuntimeTarget {
  node: RuntimeNodeCatalog
  runtime: RuntimeEntry
}

export function findRuntimeTarget(
  catalog: readonly RuntimeNodeCatalog[],
  config?: ChatRuntimeConfig | null
): SelectedRuntimeTarget | null {
  if (config?.node_id && config.runtime_id) {
    const node = catalog.find((n) => n.nodeId === config.node_id && n.online)
    const runtime = node?.runtimes.find((r) => r.id === config.runtime_id && r.status === "ready")
    if (node && runtime) return { node, runtime }
  }
  if (config?.runtime_id) {
    for (const node of catalog) {
      if (!node.online) continue
      const runtime = node.runtimes.find((r) => r.id === config.runtime_id && r.status === "ready")
      if (runtime) return { node, runtime }
    }
  }
  return pickDefaultRuntime(catalog)
}

export function pickDefaultRuntime(catalog: readonly RuntimeNodeCatalog[]): SelectedRuntimeTarget | null {
  for (const node of catalog) {
    if (!node.online || !node.supportsHttpSse) continue
    const runtime = node.runtimes.find((r) => r.status === "ready")
    if (runtime) return { node, runtime }
  }
  return null
}
