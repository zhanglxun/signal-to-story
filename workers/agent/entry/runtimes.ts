/**
 * Which driver runs a chat turn (docs/modules/chat.md 6.3): `api:*` through runtime-registry
 * (PiCloudDriver), `acp:*` through drivers/acp-config + acp-registry. Tests inject their own resolver.
 */
import type { AgentSessionDriver } from "../loop/chat/driver"
import type { ResolvedRuntime } from "../handlers/chat-turn"
import type { AcpCliSpec, AcpRegistry } from "../drivers/acp-registry"
import { RUNTIME_ID_PATTERN, type RuntimeCatalogEntry, type RuntimeRegistry } from "../runtime-registry"

export type { ResolvedRuntime }
export type RuntimeAvailability = "ready" | "unknown" | "unavailable"

export interface ChatRuntimeResolver {
  availability(runtimeId: string): RuntimeAvailability
  /** A driver for one turn. Only called after availability() returned "ready". */
  create(runtimeId: string): ResolvedRuntime
  /**
   * Regenerating on a runtime that keeps its own session (ACP) must start clean: close the session's
   * subprocess so the CLI does not continue on a context that still holds the replaced reply (T2 report).
   */
  prepareRegenerate(sessionId: string, runtimeId: string): Promise<void>
}

/** Catalog entries for the node's ACP CLIs. Status stays "unverified" until a real session was checked. */
export function acpCatalogEntries(clis: readonly AcpCliSpec[]): RuntimeCatalogEntry[] {
  return clis
    .map((cli): RuntimeCatalogEntry => ({
      id: `acp:${cli.cliKey.toLowerCase()}`,
      kind: "acp",
      provider: cli.cliKey,
      model: cli.cliKey,
      label: (cli.label ?? `${cli.cliKey}（本机 ACP）`).slice(0, 120),
      capabilities: { streaming: true, reasoning: true, tools: false, sessions: true },
      status: "unverified",
    }))
    .filter((entry) => RUNTIME_ID_PATTERN.test(entry.id))
}

export interface NodeRuntimeResolverOptions {
  registry: RuntimeRegistry
  acp?: { registry: AcpRegistry; drivers: AgentSessionDriver[] } | null
}

export class NodeRuntimeResolver implements ChatRuntimeResolver {
  private readonly registry: RuntimeRegistry
  private readonly acpRegistry: AcpRegistry | null
  private readonly acpDrivers: Map<string, AgentSessionDriver>
  private readonly limits: Map<string, { contextWindow: number | null; maxOutputTokens: number | null }>

  constructor(options: NodeRuntimeResolverOptions) {
    this.registry = options.registry
    this.acpRegistry = options.acp?.registry ?? null
    this.acpDrivers = new Map((options.acp?.drivers ?? []).map((d) => [d.runtimeId, d]))
    this.limits = new Map(
      options.registry.buildCatalog().runtimes.map((r) => [r.id, { contextWindow: r.context_window ?? null, maxOutputTokens: r.max_output_tokens ?? null }]),
    )
  }

  availability(runtimeId: string): RuntimeAvailability {
    if (runtimeId.startsWith("acp:")) return this.acpDrivers.has(runtimeId) ? "ready" : "unknown"
    if (!this.registry.has(runtimeId)) return "unknown"
    return this.registry.isReady(runtimeId) ? "ready" : "unavailable"
  }

  create(runtimeId: string): ResolvedRuntime {
    const acp = this.acpDrivers.get(runtimeId)
    if (acp) return { driver: acp, kind: "acp", contextWindow: null, maxOutputTokens: null }
    const limits = this.limits.get(runtimeId)
    return { driver: this.registry.createDriver(runtimeId), kind: "api", contextWindow: limits?.contextWindow ?? null, maxOutputTokens: limits?.maxOutputTokens ?? null }
  }

  async prepareRegenerate(sessionId: string): Promise<void> {
    await this.acpRegistry?.dispose(sessionId)
  }
}
