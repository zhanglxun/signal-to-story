/**
 * 本地桥（dev only）的纯函数校验层：不依赖 Node 内置模块，便于单元测试。
 * 威胁模型：用户浏览的任意网页向 localhost 发请求（CSRF / DNS rebinding）。
 */

export const BRIDGE_PREFIX = "/__sense_bridge/"
export const BRIDGE_TOKEN_HEADER = "x-sense-bridge-token"
export const MAX_BODY_BYTES = 256 * 1024
export const MAX_PROMPT_CHARS = 32_000

export interface ProviderDefault {
  envPrefix: string
  baseUrl: string
  model: string
}

export const PROVIDER_DEFAULTS: Record<string, ProviderDefault> = {
  qwen: {
    envPrefix: "SENSE_LLM_QWEN",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-max",
  },
  kimi: {
    envPrefix: "SENSE_LLM_KIMI",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2",
  },
  deepseek: {
    envPrefix: "SENSE_LLM_DEEPSEEK",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  zhipu: {
    envPrefix: "SENSE_LLM_ZHIPU",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-plus",
  },
  minimax: {
    envPrefix: "SENSE_LLM_MINIMAX",
    baseUrl: "https://api.minimax.chat/v1",
    model: "MiniMax-Text-01",
  },
  "openai-compatible": {
    envPrefix: "SENSE_LLM_CUSTOM",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1",
  },
}

/** /env 允许写入的全部键（其余一律拒绝）。 */
export const ALLOWED_ENV_KEYS: ReadonlySet<string> = new Set([
  "SENSE_DEFAULT_LLM_PROVIDER",
  "CONTENT_AI_API_KEY",
  "CONTENT_AI_BASE_URL",
  "CONTENT_AI_MODEL",
  ...Object.values(PROVIDER_DEFAULTS).flatMap((d) => [
    `${d.envPrefix}_API_KEY`,
    `${d.envPrefix}_BASE_URL`,
    `${d.envPrefix}_MODEL`,
  ]),
])

export interface GuardInput {
  method: string
  url: string
  remoteAddress: string | undefined
  headers: Record<string, string | string[] | undefined>
  token: string
}

export type GuardResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

function header(
  headers: GuardInput["headers"],
  name: string
): string | undefined {
  const v = headers[name]
  return Array.isArray(v) ? v[0] : v
}

export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false
  if (addr === "::1") return true
  const v4 = addr.startsWith("::ffff:") ? addr.slice(7) : addr
  return /^127(\.\d{1,3}){3}$/.test(v4)
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])

/** 从 Host 头（host[:port]）中取 hostname，保留 IPv6 方括号。 */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase()
  if (h.startsWith("[")) {
    const end = h.indexOf("]")
    return end === -1 ? h : h.slice(0, end + 1)
  }
  const idx = h.lastIndexOf(":")
  return idx === -1 ? h : h.slice(0, idx)
}

export function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  return LOOPBACK_HOSTNAMES.has(hostnameOf(hostHeader))
}

/** Origin 必须与 Host 同源（scheme 仅 http/https，host:port 完全一致）。 */
export function isSameOrigin(origin: string, hostHeader: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
  return parsed.host.toLowerCase() === hostHeader.trim().toLowerCase()
}

/** 常量时间字符串比较（长度不同时仍遍历较长者）。 */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

export function bridgePathname(url: string): string {
  const q = url.indexOf("?")
  return q === -1 ? url : url.slice(0, q)
}

export function validateBridgeRequest(input: GuardInput): GuardResult {
  const deny = (status: number, error: string): GuardResult => ({
    ok: false,
    status,
    error,
  })
  const { headers } = input

  if (!isLoopbackAddress(input.remoteAddress)) {
    return deny(403, "仅允许本机回环地址访问")
  }
  const host = header(headers, "host")
  if (!isAllowedHost(host)) {
    return deny(403, "Host 头不在允许列表")
  }
  const origin = header(headers, "origin")
  if (origin !== undefined && !isSameOrigin(origin, host as string)) {
    return deny(403, "Origin 与 Host 不同源")
  }
  const fetchSite = header(headers, "sec-fetch-site")
  if (
    fetchSite !== undefined &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none"
  ) {
    return deny(403, "拒绝跨站请求")
  }

  const method = input.method.toUpperCase()
  if (method === "GET") return { ok: true }
  if (method !== "POST") return deny(405, "不支持的请求方法")

  const contentType = (header(headers, "content-type") ?? "").toLowerCase()
  if (!/^application\/json\s*(;|$)/.test(contentType)) {
    return deny(415, "POST 必须使用 Content-Type: application/json")
  }
  const supplied = header(headers, BRIDGE_TOKEN_HEADER)
  if (!supplied || !constantTimeEqual(supplied, input.token)) {
    return deny(403, "缺少或无效的桥接令牌，请刷新页面")
  }
  return { ok: true }
}

// ---------------------------------------------------------------- 值校验

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value)
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string }

/** https 必需；仅 localhost/127.0.0.1/[::1] 允许 http；禁止内嵌凭据、query、hash。返回去掉末尾斜杠的规范形式。 */
export function validateBaseUrl(raw: string): Validated<string> {
  const value = raw.trim()
  if (!value || value.length > 300 || hasControlChars(value)) {
    return { ok: false, error: "baseUrl 无效" }
  }
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return { ok: false, error: "baseUrl 不是合法 URL" }
  }
  if (u.username || u.password) {
    return { ok: false, error: "baseUrl 不允许包含用户名或密码" }
  }
  if (u.search || u.hash) {
    return { ok: false, error: "baseUrl 不允许包含 query 或 hash" }
  }
  const loopback = LOOPBACK_HOSTNAMES.has(u.hostname.toLowerCase())
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) {
    return { ok: false, error: "baseUrl 必须使用 https（仅 localhost 可用 http）" }
  }
  return { ok: true, value: value.replace(/\/+$/, "") }
}

export function validateEnvValue(
  key: string,
  value: string
): Validated<string> {
  if (!ALLOWED_ENV_KEYS.has(key)) {
    return { ok: false, error: `不允许写入的环境变量键：${key}` }
  }
  if (hasControlChars(value)) {
    return { ok: false, error: `${key} 含换行或控制字符` }
  }
  if (value.length > 1024) {
    return { ok: false, error: `${key} 过长` }
  }
  if (key.endsWith("_BASE_URL")) return validateBaseUrl(value)
  return { ok: true, value }
}

export interface EnvSaveResult {
  updates: Record<string, string>
  apiKey: string
}

/** 把 /env 请求体转成待写入键值；任何键/值不合规则整体拒绝。 */
export function buildEnvUpdates(
  body: Record<string, unknown>,
  existingEnv: Record<string, string>
): Validated<EnvSaveResult> {
  const providerKey = String(body.providerKey ?? "")
  const def = Object.hasOwn(PROVIDER_DEFAULTS, providerKey)
    ? PROVIDER_DEFAULTS[providerKey]
    : undefined
  if (!def) return { ok: false, error: "不支持的模型提供商标识" }

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const apiKey = str(body.apiKey) || existingEnv[`${def.envPrefix}_API_KEY`] || ""
  const baseUrl = str(body.baseUrl) || def.baseUrl
  const model = str(body.model) || def.model

  const raw: Record<string, string> = {
    [`${def.envPrefix}_BASE_URL`]: baseUrl,
    [`${def.envPrefix}_MODEL`]: model,
  }
  if (apiKey) raw[`${def.envPrefix}_API_KEY`] = apiKey
  if (body.setAsDefault === true) {
    raw.SENSE_DEFAULT_LLM_PROVIDER = providerKey
    raw.CONTENT_AI_BASE_URL = baseUrl
    raw.CONTENT_AI_MODEL = model
    if (apiKey) raw.CONTENT_AI_API_KEY = apiKey
  }

  const updates: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const checked = validateEnvValue(k, v)
    if (!checked.ok) return checked
    updates[k] = checked.value
  }
  return { ok: true, value: { updates, apiKey } }
}

/**
 * /chat（cloud_api）：请求体自带的 baseUrl 必须与已保存（或默认）配置一致，
 * 否则拒绝，避免把已保存 Key 发往任意地址。返回最终使用的 baseUrl。
 */
export function resolveChatBaseUrl(
  requested: unknown,
  savedBaseUrl: string
): Validated<string> {
  const saved = validateBaseUrl(savedBaseUrl)
  if (!saved.ok) return { ok: false, error: `已保存的 baseUrl 无效：${saved.error}` }
  const req = typeof requested === "string" ? requested.trim() : ""
  if (!req) return saved
  const checked = validateBaseUrl(req)
  if (!checked.ok) return checked
  if (checked.value !== saved.value) {
    return {
      ok: false,
      error: "请求中的 baseUrl 与已保存配置不一致，请先在「大模型接入」保存后再调用",
    }
  }
  return saved
}

export function validatePrompt(value: unknown): Validated<string> {
  const prompt = typeof value === "string" ? value.trim() : ""
  if (!prompt) return { ok: false, error: "请输入对话或测试内容" }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { ok: false, error: `内容过长（上限 ${MAX_PROMPT_CHARS} 字符）` }
  }
  if (prompt.includes("\0")) return { ok: false, error: "内容含非法字符" }
  return { ok: true, value: prompt }
}

// ---------------------------------------------------------------- CLI 表

export interface BridgeCliSpec {
  binary: string
  /** 非交互执行参数；prompt 一律走 stdin，不进 argv。 */
  args: readonly string[]
  /** 除 PATH/HOME/LANG/LC_ALL 外允许透传给该 CLI 的环境变量。 */
  extraEnv: readonly string[]
  /** 参数（含 stdin 读取方式）是否已在本机用 --help 验证。 */
  argsVerified: boolean
  note: string
}

const PROXY_ENV = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]

export const CLI_SPECS: Record<string, BridgeCliSpec> = {
  "codex-cli": {
    binary: "codex",
    // 已验证（codex-cli 0.167.2 exec --help）：PROMPT 为 `-` 时从 stdin 读取；-s read-only 只读沙箱
    args: ["exec", "-s", "read-only", "--skip-git-repo-check", "-"],
    extraEnv: ["CODEX_HOME", ...PROXY_ENV],
    argsVerified: true,
    note: "参数已验证",
  },
  "pi-cli": {
    binary: "pi",
    // --print/-p 已在 --help 验证；help 未说明 stdin 读取，管道输入未验证
    args: ["-p"],
    extraEnv: [
      "DASHSCOPE_API_KEY",
      "MOONSHOT_API_KEY",
      "DEEPSEEK_API_KEY",
      ...PROXY_ENV,
    ],
    argsVerified: false,
    note: "参数未验证：pi -p 通过 stdin 读取 prompt 的行为 help 未说明",
  },
  "opencode-cli": {
    binary: "opencode",
    // `run` 子命令已在 --help 验证；help 未说明 stdin 读取，管道输入未验证
    args: ["run"],
    extraEnv: ["XDG_CONFIG_HOME", "XDG_DATA_HOME", ...PROXY_ENV],
    argsVerified: false,
    note: "参数未验证：opencode run 通过 stdin 读取 message 的行为 help 未说明",
  },
  "agy-cli": {
    binary: "agy",
    // --print 已在 --help 验证存在；它是否从 stdin 取 prompt 未验证
    args: ["--print"],
    extraEnv: PROXY_ENV,
    argsVerified: false,
    note: "参数未验证：agy --print 通过 stdin 读取 prompt 的行为 help 未说明",
  },
}

/** 构造子进程环境变量：白名单，不继承完整 process.env。 */
export function buildChildEnv(
  source: Record<string, string | undefined>,
  extraEnv: readonly string[],
  pathValue: string
): Record<string, string> {
  const env: Record<string, string> = { PATH: pathValue }
  for (const k of ["HOME", "LANG", "LC_ALL", ...extraEnv]) {
    const v = source[k]
    if (typeof v === "string" && v !== "") env[k] = v
  }
  return env
}
