/**
 * Runtime registry: cloud API profiles from the process environment → PiCloudDriver instances and
 * the sanitized capability catalog reported to runner_nodes.capabilities (docs/modules/chat.md 3.4).
 *
 * Environment (documented in workers/agent/README.md「运行时目录」):
 *   SENSE_API_RUNTIMES=qwen_flash,deepseek_chat            profile names, [A-Za-z0-9_]
 *   SENSE_RUNTIME_<PROFILE>_PROVIDER                        qwen|kimi|deepseek|zhipu|minimax|openai-compatible
 *   SENSE_RUNTIME_<PROFILE>_MODEL                           model id sent to the provider
 *   SENSE_RUNTIME_<PROFILE>_API_KEY                         falls back to SENSE_PROVIDER_<PROVIDER>_API_KEY
 *   SENSE_RUNTIME_<PROFILE>_BASE_URL                        falls back to SENSE_PROVIDER_<PROVIDER>_BASE_URL, then the provider default
 *   SENSE_RUNTIME_<PROFILE>_LABEL / _REASONING / _CONTEXT_WINDOW / _MAX_OUTPUT_TOKENS
 *   SENSE_RUNTIME_<PROFILE>_INPUT_CENTS_PER_1K / _OUTPUT_CENTS_PER_1K / _TIMEOUT_MS
 *
 * The catalog is built from a whitelist of fields only; keys, base URLs and tokens never enter it.
 * pi-* types stay in drivers/pi-*.ts: this module only sees the plain PiRuntimeSpec.
 */
import type { CloudModelProviderKey } from "./loop/contracts/agent-harness"
import type { AgentSessionDriver } from "./loop/chat/driver"
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_OUTPUT_TOKENS } from "./loop/chat/context"
import { CLOUD_MODEL_PROVIDERS } from "./loop/providers"
import { createPiCloudDriver, type PiModelPricing, type PiRuntimeSpec } from "./drivers/pi-cloud"

// ── Catalog shape (chat.md 3.4; sense-console reads it as RuntimeNodeCatalog) ────────────────────

export const CATALOG_PROTOCOL_VERSION = 1
export type RuntimeKind = "api" | "acp" | "exec"
export type RuntimeStatus = "ready" | "unavailable" | "unverified"

export interface RuntimeCatalogEntry {
  id: string
  kind: RuntimeKind
  provider: string
  model: string
  label: string
  capabilities: { streaming: boolean; reasoning: boolean; tools: boolean; sessions?: boolean }
  context_window?: number
  max_output_tokens?: number
  priced?: boolean
  status: RuntimeStatus
}

export interface RuntimeCatalog {
  protocol_version: number
  supports_http_sse: boolean
  http_endpoint_hint: string
  runtimes: RuntimeCatalogEntry[]
}

/** Same rule as node_report_capabilities (DB3b requirement 5). */
export const RUNTIME_ID_PATTERN = /^(api|acp|exec):[a-z0-9._:-]{1,120}$/

/** Pushes the catalog to the database. The real one (node_report_capabilities) arrives with T3b. */
export interface CapabilityReporter {
  report(catalog: RuntimeCatalog): Promise<void>
}

export class InMemoryCapabilityReporter implements CapabilityReporter {
  readonly reports: RuntimeCatalog[] = []
  async report(catalog: RuntimeCatalog): Promise<void> {
    this.reports.push(structuredClone(catalog))
  }
  get latest(): RuntimeCatalog | undefined {
    return this.reports.at(-1)
  }
}

// ── Profiles ─────────────────────────────────────────────────────────────────────────────────────

export interface ApiRuntimeProfile extends PiRuntimeSpec {
  /** Name from SENSE_API_RUNTIMES, for error messages only. */
  profile: string
  /** "unavailable" when no API key is configured; such a runtime is listed but cannot run. */
  status: RuntimeStatus
}

const PROFILE_NAME = /^[A-Za-z0-9_]{1,40}$/

const envKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "_")

/** "api:<provider>:<model>" with the model lowercased and reduced to the characters the database accepts. */
export function apiRuntimeId(provider: string, model: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  const id = `api:${slug(provider)}:${slug(model)}`
  if (!RUNTIME_ID_PATTERN.test(id)) throw new Error(`运行时 id 不合法：${id}`)
  return id
}

function positiveInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} 应为正整数`)
  return n
}

function nonNegative(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} 应为非负数`)
  return n
}

function bool(raw: string | undefined, name: string): boolean {
  if (raw === undefined) return false
  if (/^(1|true|yes|on)$/i.test(raw)) return true
  if (/^(0|false|no|off)$/i.test(raw)) return false
  throw new Error(`${name} 应为 true 或 false`)
}

function httpUrl(raw: string, name: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${name} 不是合法 URL`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} 只支持 http(s)`)
  if (url.username || url.password) throw new Error(`${name} 不能内嵌账号密码，请改用 API_KEY 变量`)
  return raw.replace(/\/+$/, "")
}

/**
 * Reads every profile listed in SENSE_API_RUNTIMES. Configuration mistakes throw at startup; a missing
 * API key only marks the runtime "unavailable" so the console can show it greyed out.
 */
export function readApiRuntimeProfiles(env: NodeJS.ProcessEnv = process.env): ApiRuntimeProfile[] {
  const names = (env.SENSE_API_RUNTIMES ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  const profiles: ApiRuntimeProfile[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (!PROFILE_NAME.test(name)) throw new Error(`SENSE_API_RUNTIMES 中的名称 ${name} 只能包含字母、数字和下划线`)
    const prefix = `SENSE_RUNTIME_${envKey(name)}_`
    const get = (field: string) => env[`${prefix}${field}`]?.trim() || undefined
    const providerKey = get("PROVIDER")
    const provider = CLOUD_MODEL_PROVIDERS.find((p) => p.key === providerKey)
    if (!provider) {
      throw new Error(`${prefix}PROVIDER 应为 ${CLOUD_MODEL_PROVIDERS.map((p) => p.key).join(" / ")} 之一`)
    }
    const model = get("MODEL")
    if (!model) throw new Error(`缺少 ${prefix}MODEL`)
    const providerPrefix = `SENSE_PROVIDER_${envKey(provider.key)}_`
    const apiKey = get("API_KEY") ?? (env[`${providerPrefix}API_KEY`]?.trim() || "")
    const baseUrl = httpUrl(get("BASE_URL") ?? (env[`${providerPrefix}BASE_URL`]?.trim() || provider.defaultBaseUrl), `${prefix}BASE_URL`)
    const inputPrice = nonNegative(get("INPUT_CENTS_PER_1K"), `${prefix}INPUT_CENTS_PER_1K`)
    const outputPrice = nonNegative(get("OUTPUT_CENTS_PER_1K"), `${prefix}OUTPUT_CENTS_PER_1K`)
    const pricing: PiModelPricing | null =
      inputPrice === undefined && outputPrice === undefined ? null : { inputCentsPer1k: inputPrice ?? 0, outputCentsPer1k: outputPrice ?? 0 }
    const runtimeId = apiRuntimeId(provider.key, model)
    if (seen.has(runtimeId)) throw new Error(`运行时 ${runtimeId} 重复配置（${name}）`)
    seen.add(runtimeId)
    const label = get("LABEL") ?? `${provider.name} · ${model}`
    const timeoutMs = get("TIMEOUT_MS") ? positiveInt(get("TIMEOUT_MS"), `${prefix}TIMEOUT_MS`, 0) : undefined
    profiles.push({
      profile: name,
      runtimeId,
      provider: provider.key satisfies CloudModelProviderKey,
      model,
      label: label.slice(0, 120),
      baseUrl,
      apiKey,
      reasoning: bool(get("REASONING"), `${prefix}REASONING`),
      contextWindow: positiveInt(get("CONTEXT_WINDOW"), `${prefix}CONTEXT_WINDOW`, DEFAULT_CONTEXT_WINDOW),
      maxOutputTokens: positiveInt(get("MAX_OUTPUT_TOKENS"), `${prefix}MAX_OUTPUT_TOKENS`, DEFAULT_MAX_OUTPUT_TOKENS),
      pricing,
      ...(timeoutMs ? { timeoutMs } : {}),
      status: apiKey ? "ready" : "unavailable",
    })
  }
  return profiles
}

// ── Catalog safety ───────────────────────────────────────────────────────────────────────────────

/** Exact key names node_report_capabilities rejects (DB3b requirement 5); checked here first. */
const FORBIDDEN_KEYS = new Set(["api_key", "apikey", "secret", "password", "authorization", "access_token", "refresh_token"])
const SECRET_VALUE = /^(sk-|stn_)|bearer\s/i

/** Only scheme, host, port and path survive; anything else (credentials, query, fragment) is dropped. */
export function sanitizeEndpointHint(raw: string | undefined): string {
  if (!raw) return ""
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" && url.protocol !== "http:") return ""
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")}`
  } catch {
    return ""
  }
}

/** Throws when the catalog contains a forbidden key, a secret-looking value or any known secret. */
export function assertCatalogSafe(catalog: unknown, secrets: readonly string[] = []): void {
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (SECRET_VALUE.test(value.trim())) throw new Error(`能力目录 ${path} 含疑似密钥`)
      return
    }
    if (Array.isArray(value)) return value.forEach((v, i) => visit(v, `${path}[${i}]`))
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(k.toLowerCase())) throw new Error(`能力目录含禁用字段 ${path}.${k}`)
        visit(v, `${path}.${k}`)
      }
    }
  }
  visit(catalog, "$")
  const json = JSON.stringify(catalog)
  for (const secret of secrets) {
    if (secret && secret.length >= 8 && json.includes(secret)) throw new Error("能力目录含已配置的密钥")
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────────────────────────

export interface RuntimeRegistryOptions {
  /** Builds the driver for a ready profile; tests inject a fake stream through it. */
  driverFactory?: (spec: PiRuntimeSpec) => AgentSessionDriver
}

export interface CatalogOptions {
  /** True once the HTTP/SSE entry runs (T3b). */
  supportsHttpSse?: boolean
  /** Public base URL of this node's HTTP entry; credentials, query and fragment are stripped. */
  httpEndpointHint?: string
  /** Entries from other registries (ACP), already sanitized by their owner; checked again here. */
  extraRuntimes?: RuntimeCatalogEntry[]
}

export class RuntimeRegistry {
  private readonly profiles: Map<string, ApiRuntimeProfile>
  private readonly driverFactory: (spec: PiRuntimeSpec) => AgentSessionDriver

  constructor(profiles: ApiRuntimeProfile[], options: RuntimeRegistryOptions = {}) {
    this.profiles = new Map(profiles.map((p) => [p.runtimeId, p]))
    this.driverFactory = options.driverFactory ?? ((spec) => createPiCloudDriver(spec))
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, options: RuntimeRegistryOptions = {}): RuntimeRegistry {
    return new RuntimeRegistry(readApiRuntimeProfiles(env), options)
  }

  get runtimeIds(): string[] {
    return [...this.profiles.keys()]
  }

  has(runtimeId: string): boolean {
    return this.profiles.has(runtimeId)
  }

  isReady(runtimeId: string): boolean {
    return this.profiles.get(runtimeId)?.status === "ready"
  }

  /** A fresh driver for one turn. Throws for unknown or unavailable runtimes (HTTP maps it to 422 / 503). */
  createDriver(runtimeId: string): AgentSessionDriver {
    const profile = this.profiles.get(runtimeId)
    if (!profile) throw new Error(`未知运行时 ${runtimeId}`)
    if (profile.status !== "ready") throw new Error(`运行时 ${runtimeId} 不可用（未配置 API Key）`)
    const spec: PiRuntimeSpec = {
      runtimeId: profile.runtimeId,
      provider: profile.provider,
      model: profile.model,
      label: profile.label,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      reasoning: profile.reasoning,
      contextWindow: profile.contextWindow,
      maxOutputTokens: profile.maxOutputTokens,
      pricing: profile.pricing,
      ...(profile.timeoutMs ? { timeoutMs: profile.timeoutMs } : {}),
      ...(profile.maxRetries !== undefined ? { maxRetries: profile.maxRetries } : {}),
    }
    return this.driverFactory(spec)
  }

  /** The zero-secret catalog: whitelisted fields only, then checked against every configured key. */
  buildCatalog(options: CatalogOptions = {}): RuntimeCatalog {
    const api: RuntimeCatalogEntry[] = [...this.profiles.values()].map((p) => ({
      id: p.runtimeId,
      kind: "api",
      provider: p.provider,
      model: p.model,
      label: p.label,
      capabilities: { streaming: true, reasoning: p.reasoning, tools: true },
      context_window: p.contextWindow,
      max_output_tokens: p.maxOutputTokens,
      priced: p.pricing !== null,
      status: p.status,
    }))
    const catalog: RuntimeCatalog = {
      protocol_version: CATALOG_PROTOCOL_VERSION,
      supports_http_sse: options.supportsHttpSse ?? false,
      http_endpoint_hint: sanitizeEndpointHint(options.httpEndpointHint),
      runtimes: [...api, ...(options.extraRuntimes ?? []).map((r) => ({ ...r, capabilities: { ...r.capabilities } }))],
    }
    for (const r of catalog.runtimes) {
      if (!RUNTIME_ID_PATTERN.test(r.id)) throw new Error(`运行时 id 不合法：${r.id}`)
    }
    assertCatalogSafe(catalog, [...this.profiles.values()].map((p) => p.apiKey))
    return catalog
  }

  async report(reporter: CapabilityReporter, options: CatalogOptions = {}): Promise<RuntimeCatalog> {
    const catalog = this.buildCatalog(options)
    await reporter.report(catalog)
    return catalog
  }
}
