import type {
  CloudModelProviderDefinition,
  CloudModelProviderKey,
  LocalAgentCliDefinition,
  LocalAgentCliKey,
  SafeContextPack,
} from "./contracts/agent-harness"

export const CLOUD_MODEL_PROVIDERS: readonly CloudModelProviderDefinition[] = [
  {
    key: "qwen",
    name: "通义千问 (Qwen / DashScope)",
    vendor: "阿里云百炼",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    recommendedModels: ["qwen3.7-max", "qwen-max-latest", "qwen-plus"],
    supportsJsonSchema: true,
    notes: "主力剧本拆解、母稿生成与多模态分镜规划模型。",
  },
  {
    key: "kimi",
    name: "Kimi (Moonshot AI)",
    vendor: "月之暗面",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    recommendedModels: ["kimi-k2", "moonshot-v1-128k"],
    supportsJsonSchema: true,
    notes: "适合超长信源聚合、深度长文改写与多来源交叉核查。",
  },
  {
    key: "deepseek",
    name: "DeepSeek (深度求索)",
    vendor: "深度求索",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    recommendedModels: ["deepseek-chat", "deepseek-reasoner"],
    supportsJsonSchema: true,
    notes: "高性价比日常出稿、逻辑推理与只读 Evaluator 独立审查。",
  },
  {
    key: "zhipu",
    name: "智谱清言 (GLM)",
    vendor: "智谱 AI",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    recommendedModels: ["glm-4-plus", "glm-4-air"],
    supportsJsonSchema: true,
    notes: "国内高速备选通道，适合快速意图分类与标签提取。",
  },
  {
    key: "minimax",
    name: "MiniMax (海螺 AI)",
    vendor: "MiniMax",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    recommendedModels: ["MiniMax-Text-01", "abab6.5s-chat"],
    supportsJsonSchema: true,
    notes: "适合故事脚本、角色对话台词与拟人化表达。",
  },
  {
    key: "openai-compatible",
    name: "通用 OpenAI 兼容网关",
    vendor: "自定义 / OneAPI / LiteLLM",
    defaultBaseUrl: "https://api.openai.com/v1",
    recommendedModels: ["gpt-4.1", "claude-3-7-sonnet"],
    supportsJsonSchema: true,
    notes: "支持挂载企业私有网关、海外模型或自建推理服务。",
  },
] as const

/**
 * CLI registry. The prompt is NEVER passed on argv (size limits, visible in `ps`);
 * it goes through stdin. Only `codex-cli` flags were verified against the installed
 * `codex exec --help` (codex-cli 0.167.2). Others are unverified placeholders and the
 * worker refuses to run them until verified.
 */
export const LOCAL_AGENT_CLI_DRIVERS: readonly LocalAgentCliDefinition[] = [
  {
    key: "pi-cli",
    name: "Pi Coding Agent CLI",
    binary: "pi",
    // `pi --help` lists --print/-p, --mode json, --no-session, --no-tools; stdin prompt handling unverified.
    headlessArgsTemplate: ["-p", "--mode", "json", "--no-session", "--no-tools"],
    outputFormat: "jsonl",
    supportsSkills: true,
    promptTransport: "stdin",
    verified: false,
    notes: "极简开源 Agent 内核（参数未在 worker 中验证，暂不可用）。",
  },
  {
    key: "opencode-cli",
    name: "OpenCode CLI",
    binary: "opencode",
    // `opencode run --help` lists --format json; stdin prompt handling unverified.
    headlessArgsTemplate: ["run", "--format", "json"],
    outputFormat: "json",
    supportsSkills: true,
    promptTransport: "stdin",
    verified: false,
    notes: "开源多模型终端 Agent（参数未在 worker 中验证，暂不可用）。",
  },
  {
    key: "codex-cli",
    name: "Codex CLI",
    binary: "codex",
    // Verified: `codex exec [OPTIONS] [PROMPT]`; PROMPT "-" (or omitted) reads stdin.
    // -o/--output-last-message writes the final message to a file the worker reads back.
    headlessArgsTemplate: ["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--color", "never"],
    outputFormat: "json",
    supportsSkills: true,
    promptTransport: "stdin",
    verified: true,
    notes: "已验证 `codex exec` 无交互模式：prompt 走 stdin，最终消息写入临时文件。",
  },
  {
    key: "agy-cli",
    name: "Antigravity CLI (agy)",
    binary: "agy",
    headlessArgsTemplate: [],
    outputFormat: "json",
    supportsSkills: true,
    promptTransport: "stdin",
    verified: false,
    notes: "本机未能验证无交互参数（参数未验证，暂不可用）。",
  },
] as const

export function getCloudModelProvider(key: CloudModelProviderKey): CloudModelProviderDefinition {
  const found = CLOUD_MODEL_PROVIDERS.find((item) => item.key === key)
  if (!found) throw new Error(`未注册的云端模型提供商: ${key}`)
  return found
}

export function getLocalAgentCliDriver(key: LocalAgentCliKey): LocalAgentCliDefinition {
  const found = LOCAL_AGENT_CLI_DRIVERS.find((item) => item.key === key)
  if (!found) throw new Error(`未注册的本地 Agent CLI 驱动: ${key}`)
  return found
}

/** OpenAI-compatible request descriptor for a cloud provider. */
export function buildCloudModelRequest(options: {
  providerKey: CloudModelProviderKey
  model?: string
  customBaseUrl?: string
  contextPack: SafeContextPack
  maxTokens?: number
}) {
  const provider = getCloudModelProvider(options.providerKey)
  const baseUrl = (options.customBaseUrl?.trim() || provider.defaultBaseUrl).replace(/\/$/, "")
  const model = options.model?.trim() || provider.recommendedModels[0]
  return {
    providerKey: provider.key,
    endpoint: `${baseUrl}/chat/completions`,
    model,
    payload: {
      model,
      max_tokens: options.maxTokens ?? 4096,
      stream: false,
      enable_thinking: false,
      messages: [
        { role: "system" as const, content: options.contextPack.systemPrompt },
        { role: "user" as const, content: options.contextPack.userPayloadPrompt },
      ],
    },
  }
}

export const CLI_ENV_ALLOWLIST = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "CODEX_HOME"] as const

/** Process descriptor for a headless CLI. The prompt travels on stdin, never argv. */
export function buildLocalCliInvocation(options: {
  cliKey: LocalAgentCliKey
  workspaceDir: string
  contextPack: SafeContextPack
  timeoutMs?: number
}) {
  const driver = getLocalAgentCliDriver(options.cliKey)
  const workspaceDir = options.workspaceDir.trim()
  if (!workspaceDir || workspaceDir.includes("\0") || workspaceDir.split(/[\\/]/).includes("..")) {
    throw new Error("无效或存在路径穿越风险的工作目录")
  }
  const stdin = [
    "[SYSTEM_HARNESS_INSTRUCTION]",
    options.contextPack.systemPrompt,
    "[TASK_PAYLOAD]",
    options.contextPack.userPayloadPrompt,
  ].join("\n\n")
  const args = driver.key === "codex-cli" ? [...driver.headlessArgsTemplate, "-C", workspaceDir, "-"] : [...driver.headlessArgsTemplate]
  return {
    cliKey: driver.key,
    binary: driver.binary,
    args,
    stdin,
    cwd: workspaceDir,
    outputFormat: driver.outputFormat,
    verified: driver.verified,
    timeoutMs: Math.min(Math.max(options.timeoutMs ?? 60_000, 5_000), 300_000),
    envAllowlist: CLI_ENV_ALLOWLIST,
  }
}
