import { describe, expect, it } from "vitest"

import { FakeAgentSessionDriver } from "./loop/chat"
import { PiCloudDriver, type PiRuntimeSpec } from "./drivers/pi-cloud"
import {
  apiRuntimeId,
  assertCatalogSafe,
  InMemoryCapabilityReporter,
  readApiRuntimeProfiles,
  RUNTIME_ID_PATTERN,
  RuntimeRegistry,
  sanitizeEndpointHint,
} from "./runtime-registry"

// Obviously fake values; the tests assert none of them leak into the catalog.
const QWEN_KEY = "sk-fake-qwen-0000000000000000"
const DEEPSEEK_KEY = "sk-fake-deepseek-11111111111111"
const GATEWAY_BASE = "https://gateway.example.test/v1"

const env = (): NodeJS.ProcessEnv => ({
  SENSE_API_RUNTIMES: "qwen_flash, deepseek_chat ,deepseek_reasoner,kimi",
  SENSE_RUNTIME_QWEN_FLASH_PROVIDER: "qwen",
  SENSE_RUNTIME_QWEN_FLASH_MODEL: "qwen3.8-flash",
  SENSE_RUNTIME_QWEN_FLASH_API_KEY: QWEN_KEY,
  SENSE_RUNTIME_QWEN_FLASH_LABEL: "通义千问 Qwen 3.8 Flash",
  SENSE_RUNTIME_QWEN_FLASH_REASONING: "true",
  SENSE_RUNTIME_QWEN_FLASH_CONTEXT_WINDOW: "131072",
  SENSE_RUNTIME_QWEN_FLASH_MAX_OUTPUT_TOKENS: "8192",
  SENSE_RUNTIME_QWEN_FLASH_INPUT_CENTS_PER_1K: "0.02",
  SENSE_RUNTIME_QWEN_FLASH_OUTPUT_CENTS_PER_1K: "0.2",
  SENSE_PROVIDER_DEEPSEEK_API_KEY: DEEPSEEK_KEY,
  SENSE_PROVIDER_DEEPSEEK_BASE_URL: GATEWAY_BASE,
  SENSE_RUNTIME_DEEPSEEK_CHAT_PROVIDER: "deepseek",
  SENSE_RUNTIME_DEEPSEEK_CHAT_MODEL: "deepseek-chat",
  SENSE_RUNTIME_DEEPSEEK_REASONER_PROVIDER: "deepseek",
  SENSE_RUNTIME_DEEPSEEK_REASONER_MODEL: "deepseek-reasoner",
  SENSE_RUNTIME_DEEPSEEK_REASONER_REASONING: "yes",
  SENSE_RUNTIME_KIMI_PROVIDER: "kimi",
  SENSE_RUNTIME_KIMI_MODEL: "Kimi-K2/Preview",
})

describe("readApiRuntimeProfiles", () => {
  it("reads several providers, shared provider keys and defaults", () => {
    const profiles = readApiRuntimeProfiles(env())
    expect(profiles.map((p) => p.runtimeId)).toEqual(["api:qwen:qwen3.8-flash", "api:deepseek:deepseek-chat", "api:deepseek:deepseek-reasoner", "api:kimi:kimi-k2-preview"])
    const [qwen, chat, reasoner, kimi] = profiles
    expect(qwen).toMatchObject({
      provider: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      reasoning: true,
      contextWindow: 131_072,
      maxOutputTokens: 8192,
      pricing: { inputCentsPer1k: 0.02, outputCentsPer1k: 0.2 },
      status: "ready",
    })
    expect(chat).toMatchObject({ apiKey: DEEPSEEK_KEY, baseUrl: GATEWAY_BASE, reasoning: false, contextWindow: 32_768, maxOutputTokens: 4096, pricing: null })
    expect(reasoner.reasoning).toBe(true)
    expect(kimi).toMatchObject({ model: "Kimi-K2/Preview", apiKey: "", status: "unavailable", baseUrl: "https://api.moonshot.cn/v1" })
  })

  it("returns nothing when no profile is listed", () => {
    expect(readApiRuntimeProfiles({})).toEqual([])
  })

  it("fails fast on configuration mistakes", () => {
    expect(() => readApiRuntimeProfiles({ SENSE_API_RUNTIMES: "x", SENSE_RUNTIME_X_PROVIDER: "openai", SENSE_RUNTIME_X_MODEL: "m" })).toThrow(/PROVIDER/)
    expect(() => readApiRuntimeProfiles({ SENSE_API_RUNTIMES: "x", SENSE_RUNTIME_X_PROVIDER: "qwen" })).toThrow(/MODEL/)
    expect(() => readApiRuntimeProfiles({ SENSE_API_RUNTIMES: "bad-name" })).toThrow(/字母/)
    expect(() => readApiRuntimeProfiles({ SENSE_API_RUNTIMES: "x", SENSE_RUNTIME_X_PROVIDER: "qwen", SENSE_RUNTIME_X_MODEL: "m", SENSE_RUNTIME_X_CONTEXT_WINDOW: "-1" })).toThrow(/正整数/)
    expect(() => readApiRuntimeProfiles({ SENSE_API_RUNTIMES: "x", SENSE_RUNTIME_X_PROVIDER: "qwen", SENSE_RUNTIME_X_MODEL: "m", SENSE_RUNTIME_X_BASE_URL: "https://user:pw@h.test/v1" })).toThrow(/账号密码/)
    expect(() =>
      readApiRuntimeProfiles({ SENSE_API_RUNTIMES: "a,b", SENSE_RUNTIME_A_PROVIDER: "qwen", SENSE_RUNTIME_A_MODEL: "m", SENSE_RUNTIME_B_PROVIDER: "qwen", SENSE_RUNTIME_B_MODEL: "M" }),
    ).toThrow(/重复/)
  })

  it("builds ids the database accepts", () => {
    expect(apiRuntimeId("openai-compatible", "Org/Model Name:v2")).toBe("api:openai-compatible:org-model-name-v2")
    expect(RUNTIME_ID_PATTERN.test(apiRuntimeId("qwen", "qwen3.7-max"))).toBe(true)
  })
})

describe("capability catalog", () => {
  it("has exactly the chat.md 3.4 shape", () => {
    const catalog = RuntimeRegistry.fromEnv(env()).buildCatalog({ supportsHttpSse: true, httpEndpointHint: "http://localhost:4310" })
    expect(Object.keys(catalog)).toEqual(["protocol_version", "supports_http_sse", "http_endpoint_hint", "runtimes"])
    expect(catalog).toMatchObject({ protocol_version: 1, supports_http_sse: true, http_endpoint_hint: "http://localhost:4310" })
    expect(catalog.runtimes[0]).toEqual({
      id: "api:qwen:qwen3.8-flash",
      kind: "api",
      provider: "qwen",
      model: "qwen3.8-flash",
      label: "通义千问 Qwen 3.8 Flash",
      capabilities: { streaming: true, reasoning: true, tools: true },
      context_window: 131_072,
      max_output_tokens: 8192,
      priced: true,
      status: "ready",
    })
    expect(catalog.runtimes.find((r) => r.id === "api:deepseek:deepseek-chat")).toMatchObject({ priced: false, status: "ready" })
    expect(catalog.runtimes.find((r) => r.id === "api:kimi:kimi-k2-preview")).toMatchObject({ status: "unavailable" })
  })

  it("never contains keys, base URLs or tokens", () => {
    const catalog = RuntimeRegistry.fromEnv(env()).buildCatalog({ httpEndpointHint: "https://user:token@node.example.test/agent/?key=abc#x" })
    const json = JSON.stringify(catalog)
    for (const secret of [QWEN_KEY, DEEPSEEK_KEY, GATEWAY_BASE, "gateway.example.test", "dashscope", "moonshot", "sk-", "user:token", "key=abc"]) {
      expect(json).not.toContain(secret)
    }
    expect(json).not.toMatch(/api_?key|secret|password|authorization|base_?url/i)
    expect(catalog.http_endpoint_hint).toBe("https://node.example.test/agent")
    const allowed = new Set(["id", "kind", "provider", "model", "label", "capabilities", "context_window", "max_output_tokens", "priced", "status"])
    for (const r of catalog.runtimes) expect(Object.keys(r).every((k) => allowed.has(k))).toBe(true)
  })

  it("refuses to build a catalog that would leak a secret", () => {
    const leaky = new RuntimeRegistry(readApiRuntimeProfiles({ ...env(), SENSE_RUNTIME_QWEN_FLASH_LABEL: `Qwen ${QWEN_KEY}` }))
    expect(() => leaky.buildCatalog()).toThrow()
    expect(() => assertCatalogSafe({ runtimes: [{ api_key: "x" }] })).toThrow(/禁用字段/)
    expect(() => assertCatalogSafe({ runtimes: [{ note: "stn_abc" }] })).toThrow(/密钥/)
    // Exact key names only: token counts are legal fields.
    expect(() => assertCatalogSafe({ max_tokens: 1, inputTokens: 2 })).not.toThrow()
    const registry = RuntimeRegistry.fromEnv(env())
    expect(() => registry.buildCatalog({ extraRuntimes: [{ id: "acp:opencode", kind: "acp", provider: "opencode", model: "local-default", label: "OpenCode", capabilities: { streaming: true, reasoning: true, tools: true, sessions: true }, status: "ready" }] })).not.toThrow()
    expect(() => registry.buildCatalog({ extraRuntimes: [{ id: "ACP:Bad", kind: "acp", provider: "x", model: "x", label: "x", capabilities: { streaming: true, reasoning: false, tools: false }, status: "ready" }] })).toThrow(/不合法/)
  })

  it("strips everything but scheme, host and path from the endpoint hint", () => {
    expect(sanitizeEndpointHint(undefined)).toBe("")
    expect(sanitizeEndpointHint("javascript:alert(1)")).toBe("")
    expect(sanitizeEndpointHint("https://node.example.test/")).toBe("https://node.example.test")
  })

  it("reports through the CapabilityReporter interface (in-memory fake)", async () => {
    const reporter = new InMemoryCapabilityReporter()
    const catalog = await RuntimeRegistry.fromEnv(env()).report(reporter)
    expect(reporter.reports).toHaveLength(1)
    expect(reporter.latest).toEqual(catalog)
  })
})

describe("createDriver", () => {
  it("returns a PiCloudDriver for ready api runtimes", () => {
    const driver = RuntimeRegistry.fromEnv(env()).createDriver("api:qwen:qwen3.8-flash")
    expect(driver).toBeInstanceOf(PiCloudDriver)
    expect(driver).toMatchObject({ kind: "api", runtimeId: "api:qwen:qwen3.8-flash" })
    expect((driver as PiCloudDriver).model.compat?.thinkingFormat).toBe("qwen")
  })

  it("passes the plain spec to an injected factory and rejects unknown or unavailable runtimes", () => {
    const specs: PiRuntimeSpec[] = []
    const registry = RuntimeRegistry.fromEnv(env(), {
      driverFactory: (spec) => { specs.push(spec); return new FakeAgentSessionDriver([], { runtimeId: spec.runtimeId }) },
    })
    expect(registry.createDriver("api:deepseek:deepseek-reasoner").runtimeId).toBe("api:deepseek:deepseek-reasoner")
    expect(specs[0]).toMatchObject({ model: "deepseek-reasoner", reasoning: true, apiKey: DEEPSEEK_KEY })
    expect(specs[0]).not.toHaveProperty("status")
    expect(() => registry.createDriver("api:nope:x")).toThrow(/未知运行时/)
    expect(() => registry.createDriver("api:kimi:kimi-k2-preview")).toThrow(/不可用/)
    expect(registry.isReady("api:kimi:kimi-k2-preview")).toBe(false)
    expect(registry.runtimeIds).toHaveLength(4)
  })
})
