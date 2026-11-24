import type {
  CloudModelProviderKey,
  ExecutionDriverMode,
  LocalAgentCliKey,
} from "@/contracts/agent-harness"
import {
  CLOUD_MODEL_PROVIDERS,
  LOCAL_AGENT_CLI_DRIVERS,
} from "@/config/agent-runtimes"

export interface BridgeProviderStatus {
  key: CloudModelProviderKey
  configured: boolean
  maskedKey: string | null
  baseUrl: string
  model: string
  isDefault: boolean
}

export interface BridgeCliDriverStatus {
  key: LocalAgentCliKey
  binary: string
  installed: boolean
  binaryPath: string | null
  version: string | null
  /** 桥端 CLI 参数是否已在本机验证；false 表示参数未验证 */
  argsVerified?: boolean
}

export interface LocalBridgeStatusResponse {
  ok: boolean
  bridgeOnline: boolean
  envFilePath: string
  defaultProvider: CloudModelProviderKey
  providers: BridgeProviderStatus[]
  cliDrivers: BridgeCliDriverStatus[]
}

export interface SaveProviderEnvInput {
  providerKey: CloudModelProviderKey
  apiKey?: string
  baseUrl: string
  model: string
  setAsDefault?: boolean
}

export interface BridgeChatRequest {
  driverMode: ExecutionDriverMode
  providerKey?: CloudModelProviderKey
  cliKey?: LocalAgentCliKey
  model?: string
  baseUrl?: string
  systemPrompt?: string
  prompt: string
}

export interface BridgeChatResponse {
  ok: boolean
  driverMode?: ExecutionDriverMode
  engine?: string
  reply?: string
  durationMs?: number
  error?: string
  /** 本地 CLI 参数未验证时的提示 */
  warning?: string
}

const BRIDGE_TOKEN_META = "sense-bridge-token"

/** 读取 dev server 通过 transformIndexHtml 注入的桥接令牌；生产构建中不存在。 */
function getBridgeToken(): string {
  if (typeof document === "undefined") return ""
  return (
    document
      .querySelector<HTMLMetaElement>(`meta[name="${BRIDGE_TOKEN_META}"]`)
      ?.content ?? ""
  )
}

function bridgePostHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Sense-Bridge-Token": getBridgeToken(),
  }
}

export interface CliInstallGuide {
  key: LocalAgentCliKey
  installCommand: string
  authCommand: string
  verifyCommand: string
  docsHint: string
}

export const CLI_INSTALL_GUIDES: Record<LocalAgentCliKey, CliInstallGuide> = {
  "codex-cli": {
    key: "codex-cli",
    installCommand: "npm install -g @openai/codex",
    authCommand: "codex login",
    verifyCommand: "codex --version",
    docsHint: "支持直接复用你的 ChatGPT Plus/Pro 订阅或配置 OPENAI_API_KEY 进行本地调用。",
  },
  "agy-cli": {
    key: "agy-cli",
    installCommand: "# Antigravity IDE 内置 CLI：在命令面板执行 'Install agy command in PATH'",
    authCommand: "agy auth status",
    verifyCommand: "agy --version",
    docsHint: "直接复用当前本机 Antigravity IDE 的订阅模型、工作区上下文与已安装的 Skills。",
  },
  "pi-cli": {
    key: "pi-cli",
    installCommand: "npm install -g @mariozechner/pi-coding-agent",
    authCommand: "export DASHSCOPE_API_KEY=sk-xxx # 或配置 MOONSHOT_API_KEY / DEEPSEEK_API_KEY",
    verifyCommand: "pi --version",
    docsHint: "极简开源 Agent CLI，天然支持挂载国内 Qwen / Kimi / DeepSeek API Key 与本地 Skill。",
  },
  "opencode-cli": {
    key: "opencode-cli",
    installCommand: "npm install -g opencode-ai",
    authCommand: "opencode auth login",
    verifyCommand: "opencode --version",
    docsHint: "支持多模型路由与 Headless JSON 输出 (`opencode run --format json`)。",
  },
}

export function buildFallbackBridgeStatus(): LocalBridgeStatusResponse {
  return {
    ok: true,
    bridgeOnline: false,
    envFilePath: ".env.local",
    defaultProvider: "qwen",
    providers: CLOUD_MODEL_PROVIDERS.map((p, index) => ({
      key: p.key,
      configured: false,
      maskedKey: null,
      baseUrl: p.defaultBaseUrl,
      model: p.recommendedModels[0],
      isDefault: index === 0,
    })),
    cliDrivers: LOCAL_AGENT_CLI_DRIVERS.map((d) => ({
      key: d.key,
      binary: d.binary,
      installed: false,
      binaryPath: null,
      version: null,
    })),
  }
}

export async function getLocalBridgeStatus(): Promise<LocalBridgeStatusResponse> {
  try {
    const res = await fetch("/__sense_bridge/status", {
      method: "GET",
      headers: { Accept: "application/json" },
    })
    if (!res.ok) return buildFallbackBridgeStatus()
    const data = (await res.json()) as Omit<
      LocalBridgeStatusResponse,
      "bridgeOnline"
    >
    if (!data || !Array.isArray(data.providers)) {
      return buildFallbackBridgeStatus()
    }
    return {
      ...data,
      bridgeOnline: true,
    }
  } catch {
    return buildFallbackBridgeStatus()
  }
}

export async function saveProviderEnvConfig(
  input: SaveProviderEnvInput
): Promise<{ ok: boolean; maskedKey?: string | null; error?: string }> {
  const res = await fetch("/__sense_bridge/env", {
    method: "POST",
    headers: bridgePostHeaders(),
    body: JSON.stringify(input),
  })
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean
    maskedKey?: string | null
    error?: string
  } | null
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `保存 .env.local 失败 (HTTP ${res.status})`)
  }
  return { ok: true, maskedKey: data.maskedKey }
}

export async function sendBridgeChat(
  input: BridgeChatRequest
): Promise<BridgeChatResponse> {
  const res = await fetch("/__sense_bridge/chat", {
    method: "POST",
    headers: bridgePostHeaders(),
    body: JSON.stringify(input),
  })
  const data = (await res.json().catch(() => null)) as BridgeChatResponse | null
  if (!data) {
    return {
      ok: false,
      error: `本地桥接接口响应无效 (HTTP ${res.status})`,
    }
  }
  return data
}

/**
 * 生成可下载或复制的 .env.local 环境变量模板片段
 */
export function formatEnvLocalSnippet(options: {
  providerKey: CloudModelProviderKey
  apiKey: string
  baseUrl: string
  model: string
  setAsDefault?: boolean
}): string {
  const prefixMap: Record<CloudModelProviderKey, string> = {
    qwen: "SENSE_LLM_QWEN",
    kimi: "SENSE_LLM_KIMI",
    deepseek: "SENSE_LLM_DEEPSEEK",
    zhipu: "SENSE_LLM_ZHIPU",
    minimax: "SENSE_LLM_MINIMAX",
    "openai-compatible": "SENSE_LLM_CUSTOM",
  }
  const prefix = prefixMap[options.providerKey]
  const lines = [
    `# 星火工厂 (${options.providerKey}) 模型配置`,
    `${prefix}_API_KEY=${JSON.stringify(options.apiKey || "sk-your-key-here")}`,
    `${prefix}_BASE_URL=${JSON.stringify(options.baseUrl)}`,
    `${prefix}_MODEL=${JSON.stringify(options.model)}`,
  ]
  if (options.setAsDefault) {
    lines.push(
      `SENSE_DEFAULT_LLM_PROVIDER=${JSON.stringify(options.providerKey)}`,
      `CONTENT_AI_API_KEY=${JSON.stringify(options.apiKey || "sk-your-key-here")}`,
      `CONTENT_AI_BASE_URL=${JSON.stringify(options.baseUrl)}`,
      `CONTENT_AI_MODEL=${JSON.stringify(options.model)}`
    )
  }
  return lines.join("\n")
}
