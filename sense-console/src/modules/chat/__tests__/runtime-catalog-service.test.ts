import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const calls: Array<{ method: string; args: unknown[] }> = []
let response: { data: unknown; error: { message: string } | null } = { data: [], error: null }
let clientAvailable = true

function makeQuery() {
  const query: Record<string, unknown> = {}
  for (const method of ["select", "eq", "is"]) {
    query[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return query
    }
  }
  query.order = (...args: unknown[]) => {
    calls.push({ method: "order", args })
    return Promise.resolve(response)
  }
  return query
}

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () =>
    clientAvailable
      ? {
          from: (table: string) => {
            calls.push({ method: "from", args: [table] })
            return makeQuery()
          },
        }
      : null,
}))

import {
  filterCatalogByKind,
  listRuntimeCatalog,
  mapRunnerNodeRow,
  mapRuntimeEntry,
  sortRuntimeCatalog,
} from "@/modules/chat/services/runtime-catalog-service"

const NOW = Date.parse("2026-11-25T10:00:00Z")

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "node-1",
    organization_id: "org-1",
    name: "jarvis-mac",
    revoked_at: null,
    last_seen_at: "2026-11-25T09:59:30Z",
    created_at: "2026-11-20T00:00:00Z",
    capabilities_updated_at: "2026-11-25T09:58:00Z",
    capabilities: {
      protocol_version: 1,
      supports_http_sse: true,
      http_endpoint_hint: "http://localhost:4310",
      runtimes: [
        {
          id: "api:qwen:qwen3.8-flash",
          kind: "api",
          provider: "qwen",
          model: "qwen3.8-flash",
          label: "Qwen Flash",
          capabilities: { streaming: true, reasoning: true, tools: true },
          context_window: 131072,
          max_output_tokens: 8192,
          priced: true,
          status: "ready",
        },
        { id: "acp:opencode", kind: "acp", provider: "opencode", model: "local-default", label: "OpenCode", capabilities: { sessions: true }, status: "ready" },
      ],
    },
    ...overrides,
  }
}

describe("runtime catalog mapping", () => {
  it("maps a runner_nodes row into a node group with camelCase runtimes", () => {
    const node = mapRunnerNodeRow(row(), NOW)
    expect(node).toMatchObject({
      nodeId: "node-1",
      nodeName: "jarvis-mac",
      online: true,
      state: "online",
      protocolVersion: 1,
      supportsHttpSse: true,
      httpEndpointHint: "http://localhost:4310",
      capabilitiesUpdatedAt: "2026-11-25T09:58:00Z",
    })
    expect(node.runtimes[0]).toEqual({
      id: "api:qwen:qwen3.8-flash",
      kind: "api",
      provider: "qwen",
      model: "qwen3.8-flash",
      label: "Qwen Flash",
      capabilities: { streaming: true, reasoning: true, tools: true },
      contextWindow: 131072,
      maxOutputTokens: 8192,
      priced: true,
      status: "ready",
    })
  })

  it("computes online only within 2 minutes and never for revoked nodes", () => {
    expect(mapRunnerNodeRow(row({ last_seen_at: "2026-11-25T09:58:01Z" }), NOW).state).toBe("online")
    const stale = mapRunnerNodeRow(row({ last_seen_at: "2026-11-25T09:57:00Z" }), NOW)
    expect(stale).toMatchObject({ online: false, state: "offline" })
    const revoked = mapRunnerNodeRow(row({ revoked_at: "2026-11-25T09:00:00Z" }), NOW)
    expect(revoked).toMatchObject({ online: false, state: "revoked", revokedAt: "2026-11-25T09:00:00Z" })
    expect(mapRunnerNodeRow(row({ last_seen_at: null }), NOW)).toMatchObject({ online: false, state: "never" })
  })

  it("tolerates nodes that have not reported capabilities and drops malformed runtimes", () => {
    const empty = mapRunnerNodeRow(row({ capabilities: {}, capabilities_updated_at: null }), NOW)
    expect(empty).toMatchObject({ runtimes: [], protocolVersion: 0, supportsHttpSse: false, httpEndpointHint: "" })
    expect(mapRuntimeEntry({ id: "cli:x", kind: "cli" })).toBeNull()
    expect(mapRuntimeEntry({ kind: "api" })).toBeNull()
    expect(mapRuntimeEntry({ id: "api:deepseek:deepseek-chat", kind: "api", status: "weird" })).toMatchObject({
      provider: "deepseek",
      label: "api:deepseek:deepseek-chat",
      status: "unverified",
    })
  })

  it("filters runtimes by kind and sorts online nodes first", () => {
    const nodes = sortRuntimeCatalog([
      mapRunnerNodeRow(row({ id: "b", name: "b-offline", last_seen_at: "2026-11-25T08:00:00Z" }), NOW),
      mapRunnerNodeRow(row({ id: "c", name: "c-revoked", revoked_at: "2026-11-25T09:00:00Z" }), NOW),
      mapRunnerNodeRow(row({ id: "a", name: "z-online" }), NOW),
      mapRunnerNodeRow(row({ id: "d", name: "d-no-acp", capabilities: { runtimes: [] } }), NOW),
    ])
    expect(nodes.map((n) => n.nodeId)).toEqual(["d", "a", "b", "c"])
    const acp = filterCatalogByKind(nodes, "acp")
    expect(acp.map((n) => n.nodeId)).toEqual(["a", "b", "c"])
    expect(acp.every((n) => n.runtimes.every((r) => r.kind === "acp"))).toBe(true)
  })
})

describe("listRuntimeCatalog", () => {
  beforeEach(() => {
    calls.length = 0
    clientAvailable = true
    response = { data: [row()], error: null }
  })
  afterEach(() => vi.unstubAllEnvs())

  it("reads runner_nodes through RLS without token_hash and hides revoked nodes by default", async () => {
    const nodes = await listRuntimeCatalog("org-1", { now: NOW })
    expect(nodes).toHaveLength(1)
    expect(calls[0]).toEqual({ method: "from", args: ["runner_nodes"] })
    const select = String(calls.find((c) => c.method === "select")?.args[0])
    expect(select).toContain("capabilities")
    expect(select).not.toContain("token_hash")
    expect(calls).toContainEqual({ method: "eq", args: ["organization_id", "org-1"] })
    expect(calls).toContainEqual({ method: "is", args: ["revoked_at", null] })
  })

  it("keeps revoked nodes for the configuration pages", async () => {
    await listRuntimeCatalog("org-1", { includeRevoked: true, now: NOW })
    expect(calls.some((c) => c.method === "is")).toBe(false)
  })

  it("throws database errors", async () => {
    response = { data: null, error: { message: "boom" } }
    await expect(listRuntimeCatalog("org-1")).rejects.toThrow("boom")
  })

  it("returns the mock catalog in mock mode or without Supabase", async () => {
    vi.stubEnv("VITE_CHAT_TRANSPORT", "mock")
    const mock = await listRuntimeCatalog("org-1")
    expect(mock.length).toBeGreaterThan(0)
    expect(calls).toHaveLength(0)
    vi.unstubAllEnvs()
    clientAvailable = false
    expect((await listRuntimeCatalog()).map((n) => n.nodeId)).toEqual(mock.map((n) => n.nodeId))
    expect(calls).toHaveLength(0)
  })
})
