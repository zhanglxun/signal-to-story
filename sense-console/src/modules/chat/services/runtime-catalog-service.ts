import { getSupabaseClient } from "@/lib/supabase"
import type {
  ChatRuntimeConfig,
  RuntimeCapabilityFlags,
  RuntimeEntry,
  RuntimeNodeCatalog,
} from "@/modules/chat/types"
import { isMockChatMode } from "@/modules/chat/transport/transport"
import { nodeState } from "@/services/runner-node-service"

const MOCK_RUNTIME_CATALOG: RuntimeNodeCatalog[] = [
  {
    nodeId: "node-cloud-1",
    nodeName: "云端常驻节点 · Cloud Worker",
    online: true,
    state: "online",
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
    state: "online",
    lastSeenAt: new Date().toISOString(),
    protocolVersion: 1,
    supportsHttpSse: true,
    httpEndpointHint: "http://localhost:4310",
    runtimes: [
      {
        id: "acp:opencode",
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
        id: "acp:codex",
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
    state: "never",
    lastSeenAt: null,
    protocolVersion: 1,
    supportsHttpSse: true,
    httpEndpointHint: "http://localhost:4311",
    runtimes: [
      {
        id: "acp:claude",
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
 * Columns the browser may read from runner_nodes (20261124100000 + 20261127100000 grants).
 * token_hash is never selected.
 */
export const RUNNER_NODE_CATALOG_COLUMNS =
  "id, organization_id, name, revoked_at, last_seen_at, created_at, capabilities, capabilities_updated_at"

export interface ListRuntimeCatalogOptions {
  /** Keep revoked nodes (greyed out on the configuration pages). The Chat selector leaves them out. */
  includeRevoked?: boolean
  /** Clock override for tests. */
  now?: number
}

const RUNTIME_KINDS = new Set<RuntimeEntry["kind"]>(["api", "acp", "exec"])
const RUNTIME_STATUSES = new Set<RuntimeEntry["status"]>(["ready", "unavailable", "unverified"])

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function mapCapabilityFlags(value: unknown): RuntimeCapabilityFlags {
  const raw = asRecord(value)
  const flags: RuntimeCapabilityFlags = {}
  for (const key of ["streaming", "reasoning", "tools", "sessions"] as const) {
    if (typeof raw[key] === "boolean") flags[key] = raw[key]
  }
  return flags
}

/** Maps one `capabilities.runtimes[]` entry (snake_case, chat.md 3.4); returns null for malformed entries. */
export function mapRuntimeEntry(value: unknown): RuntimeEntry | null {
  const raw = asRecord(value)
  const id = optionalString(raw.id)
  const kind = raw.kind as RuntimeEntry["kind"]
  if (!id || !RUNTIME_KINDS.has(kind)) return null
  const status = RUNTIME_STATUSES.has(raw.status as RuntimeEntry["status"])
    ? (raw.status as RuntimeEntry["status"])
    : "unverified"
  const provider = optionalString(raw.provider) ?? id.split(":")[1] ?? ""
  const model = optionalString(raw.model) ?? ""
  return {
    id,
    kind,
    provider,
    model,
    label: optionalString(raw.label) ?? id,
    capabilities: mapCapabilityFlags(raw.capabilities),
    contextWindow: optionalPositiveNumber(raw.context_window),
    maxOutputTokens: optionalPositiveNumber(raw.max_output_tokens),
    priced: typeof raw.priced === "boolean" ? raw.priced : undefined,
    status,
  }
}

/** Maps a runner_nodes row to a catalog node; online = last_seen_at within 2 minutes and not revoked. */
export function mapRunnerNodeRow(row: Record<string, unknown>, now = Date.now()): RuntimeNodeCatalog {
  const capabilities = asRecord(row.capabilities)
  const revokedAt = optionalString(row.revoked_at)
  const lastSeenAt = optionalString(row.last_seen_at)
  const state = nodeState(
    {
      id: String(row.id),
      name: String(row.name ?? ""),
      revoked_at: revokedAt,
      last_seen_at: lastSeenAt,
      created_at: String(row.created_at ?? ""),
    },
    now
  )
  const runtimes = Array.isArray(capabilities.runtimes)
    ? capabilities.runtimes.map(mapRuntimeEntry).filter((r): r is RuntimeEntry => r !== null)
    : []
  return {
    nodeId: String(row.id),
    nodeName: String(row.name ?? ""),
    online: state === "online",
    state,
    lastSeenAt,
    revokedAt,
    capabilitiesUpdatedAt: optionalString(row.capabilities_updated_at),
    protocolVersion: typeof capabilities.protocol_version === "number" ? capabilities.protocol_version : 0,
    supportsHttpSse: capabilities.supports_http_sse === true,
    httpEndpointHint: optionalString(capabilities.http_endpoint_hint) ?? "",
    runtimes,
  }
}

const STATE_ORDER: Record<NonNullable<RuntimeNodeCatalog["state"]>, number> = {
  online: 0,
  offline: 1,
  never: 2,
  revoked: 3,
}

/** Online nodes first, then by name; stable for rendering. */
export function sortRuntimeCatalog(nodes: RuntimeNodeCatalog[]): RuntimeNodeCatalog[] {
  return [...nodes].sort(
    (a, b) =>
      STATE_ORDER[a.state ?? (a.online ? "online" : "offline")] -
        STATE_ORDER[b.state ?? (b.online ? "online" : "offline")] ||
      a.nodeName.localeCompare(b.nodeName)
  )
}

/** Keeps only nodes that report at least one runtime of `kind`, with only those runtimes. */
export function filterCatalogByKind(
  catalog: readonly RuntimeNodeCatalog[],
  kind: RuntimeEntry["kind"]
): RuntimeNodeCatalog[] {
  return catalog
    .map((node) => ({ ...node, runtimes: node.runtimes.filter((r) => r.kind === kind) }))
    .filter((node) => node.runtimes.length > 0)
}

/** The demo catalog (VITE_CHAT_TRANSPORT=mock preview and unit tests only). */
export function listMockRuntimeCatalog(): RuntimeNodeCatalog[] {
  return MOCK_RUNTIME_CATALOG.map((node) => ({
    ...node,
    runtimes: node.runtimes.map((r) => ({ ...r, capabilities: { ...r.capabilities } })),
  }))
}

/**
 * Runtime & Model Catalog (docs/modules/chat.md 3.4), shared by the Chat model selector and the
 * system configuration pages. Reads runner_nodes.capabilities through RLS. The mock catalog is
 * served only under VITE_CHAT_TRANSPORT=mock; without Supabase the real catalog is simply empty.
 */
export async function listRuntimeCatalog(
  organizationId?: string | null,
  options: ListRuntimeCatalogOptions = {}
): Promise<RuntimeNodeCatalog[]> {
  if (isMockChatMode()) return listMockRuntimeCatalog()
  const client = getSupabaseClient()
  if (!client) return []

  let query = client.from("runner_nodes").select(RUNNER_NODE_CATALOG_COLUMNS)
  if (organizationId) query = query.eq("organization_id", organizationId)
  if (!options.includeRevoked) query = query.is("revoked_at", null)
  const { data, error } = await query.order("created_at", { ascending: true })
  if (error) throw new Error(error.message)
  const now = options.now ?? Date.now()
  return sortRuntimeCatalog(
    ((data ?? []) as Record<string, unknown>[]).map((row) => mapRunnerNodeRow(row, now))
  )
}

export interface SelectedRuntimeTarget {
  node: RuntimeNodeCatalog
  runtime: RuntimeEntry
}

/** Why a node cannot take a chat turn right now, or null when it can. */
export function nodeUnavailableReason(node: RuntimeNodeCatalog): string | null {
  if (!node.online) return "离线"
  if (!node.supportsHttpSse) return "不支持对话"
  if (!node.httpEndpointHint.trim()) return "未配置地址"
  return null
}

/**
 * A runtime can be chosen in the Chat selector only on an online node that serves the HTTP/SSE
 * entry at a known address (docs/modules/chat.md 2.4: the browser POSTs to that node directly).
 */
export function isRuntimeSelectable(node: RuntimeNodeCatalog, runtime: RuntimeEntry): boolean {
  return nodeUnavailableReason(node) === null && runtime.status === "ready"
}

export function findRuntimeTarget(
  catalog: readonly RuntimeNodeCatalog[],
  config?: ChatRuntimeConfig | null
): SelectedRuntimeTarget | null {
  if (config?.node_id && config.runtime_id) {
    const node = catalog.find((n) => n.nodeId === config.node_id)
    const runtime = node?.runtimes.find((r) => r.id === config.runtime_id)
    if (node && runtime && isRuntimeSelectable(node, runtime)) return { node, runtime }
  }
  if (config?.runtime_id) {
    for (const node of catalog) {
      const runtime = node.runtimes.find((r) => r.id === config.runtime_id)
      if (runtime && isRuntimeSelectable(node, runtime)) return { node, runtime }
    }
  }
  return pickDefaultRuntime(catalog)
}

export function pickDefaultRuntime(catalog: readonly RuntimeNodeCatalog[]): SelectedRuntimeTarget | null {
  for (const node of catalog) {
    const runtime = node.runtimes.find((r) => isRuntimeSelectable(node, r))
    if (runtime) return { node, runtime }
  }
  return null
}
