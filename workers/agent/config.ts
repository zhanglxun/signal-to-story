import { hostname } from "node:os"

import type { LocalAgentCliKey } from "./loop/contracts/agent-harness"
import type { LlmClient } from "./loop/llm"
import { getCloudModelProvider, LOCAL_AGENT_CLI_DRIVERS } from "./loop/providers"
import { CliLlmClient } from "./drivers/cli-driver"
import { CloudLlmClient } from "./drivers/cloud-llm"

/** Reads ONLY from the process environment (never from sense-console/.env.local). */
export interface WorkerConfig {
  supabaseUrl: string
  /** Publishable (anon) key: the worker never holds service_role (DB2c-2). */
  publishableKey: string
  /** Revocable node token from the console (系统 → 执行节点); the credential for every node_* RPC. */
  nodeToken: string
  workerId: string
  jobTypes: string[]
  leaseSeconds: number
  pollIntervalMs: number
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`缺少环境变量 ${key}（见 workers/agent/.env.example）`)
  return value
}

function nodeToken(env: NodeJS.ProcessEnv): string {
  const token = required(env, "SENSE_NODE_TOKEN")
  if (!/^stn_[a-f0-9]{64}$/.test(token)) throw new Error("SENSE_NODE_TOKEN 格式不对：应为控制台「执行节点」生成的 stn_ 开头令牌")
  return token
}

export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    supabaseUrl: required(env, "SUPABASE_URL"),
    publishableKey: required(env, "SUPABASE_PUBLISHABLE_KEY"),
    nodeToken: nodeToken(env),
    workerId: env.SENSE_WORKER_ID?.trim() || `${hostname()}-${process.pid}`,
    jobTypes: (env.SENSE_WORKER_JOB_TYPES ?? "content_draft,video_storyboard").split(",").map((s) => s.trim()).filter(Boolean),
    leaseSeconds: Number(env.SENSE_WORKER_LEASE_SECONDS ?? 120),
    pollIntervalMs: Number(env.SENSE_WORKER_POLL_MS ?? 5000),
  }
}

/**
 * Build an LLM client from SENSE_LLM_* (generator) or SENSE_EVAL_LLM_* (evaluator) variables.
 *   <P>_DRIVER = cloud | cli          (default cloud)
 *   <P>_PROVIDER = qwen|kimi|deepseek|zhipu|minimax|openai-compatible
 *   <P>_BASE_URL (default: provider default), <P>_API_KEY, <P>_MODEL
 *   <P>_INPUT_CENTS_PER_1K / <P>_OUTPUT_CENTS_PER_1K (budget accounting)
 *   <P>_CLI = codex-cli (only verified CLI), <P>_TIMEOUT_MS
 * The evaluator falls back to the generator settings when SENSE_EVAL_LLM_* is not set.
 */
export function buildLlmClientFromEnv(prefix: "SENSE_LLM" | "SENSE_EVAL_LLM", env: NodeJS.ProcessEnv = process.env): LlmClient | null {
  const get = (name: string) => env[`${prefix}_${name}`]?.trim() || undefined
  const driver = get("DRIVER")
  const anySet = Object.keys(env).some((k) => k.startsWith(`${prefix}_`))
  if (!anySet) return null
  const timeoutMs = get("TIMEOUT_MS") ? Number(get("TIMEOUT_MS")) : undefined
  if (driver === "cli") {
    const cliKey = (get("CLI") ?? "codex-cli") as LocalAgentCliKey
    if (!LOCAL_AGENT_CLI_DRIVERS.some((d) => d.key === cliKey)) throw new Error(`未知 CLI: ${cliKey}`)
    return new CliLlmClient({ cliKey, model: get("MODEL"), timeoutMs, binary: get("CLI_BINARY") })
  }
  const providerKey = (get("PROVIDER") ?? "openai-compatible") as Parameters<typeof getCloudModelProvider>[0]
  const provider = getCloudModelProvider(providerKey)
  const apiKey = get("API_KEY")
  if (!apiKey) throw new Error(`缺少 ${prefix}_API_KEY`)
  return new CloudLlmClient({
    provider: provider.key,
    baseUrl: get("BASE_URL") ?? provider.defaultBaseUrl,
    apiKey,
    model: get("MODEL") ?? provider.recommendedModels[0],
    timeoutMs,
    inputCentsPer1k: get("INPUT_CENTS_PER_1K") ? Number(get("INPUT_CENTS_PER_1K")) : undefined,
    outputCentsPer1k: get("OUTPUT_CENTS_PER_1K") ? Number(get("OUTPUT_CENTS_PER_1K")) : undefined,
  })
}

/**
 * Chat HTTP/SSE entry (docs/modules/chat.md 2.4). Disabled unless SENSE_HTTP_PORT is set.
 *   SENSE_HTTP_PORT                 port to listen on (enables the entry)
 *   SENSE_HTTP_HOST                 bind address, default 127.0.0.1 (0.0.0.0 in a container)
 *   SENSE_NODE_ID                   this node's runner_nodes.id (console 执行节点), required with the HTTP entry
 *   SENSE_HTTP_PUBLIC_URL           public base URL reported as http_endpoint_hint (tunnel / HTTPS address)
 *   SENSE_HTTP_ALLOWED_ORIGINS      comma-separated console origins; localhost is always allowed
 *   SENSE_HTTP_MAX_TURNS_PER_USER   concurrent turns per user, default 2
 *   SENSE_HTTP_TURNS_PER_MINUTE     turn requests per user per minute, default 20
 *   SENSE_CHAT_BUDGET_CENTS / SENSE_CHAT_MAX_ROUNDS   per-turn limits (database defaults 50 / 8 when unset)
 */
export interface HttpEntryConfig {
  port: number
  host: string
  nodeId: string
  publicUrl: string
  allowedOrigins: string[]
  maxConcurrentTurnsPerUser: number
  turnsPerMinute: number
  budgetCents?: number
  maxRounds?: number
}

function intEnv(env: NodeJS.ProcessEnv, key: string, min: number, max: number): number | undefined {
  const raw = env[key]?.trim()
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${key} 应为 ${min}–${max} 之间的整数`)
  return n
}

export function readHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpEntryConfig | null {
  const port = intEnv(env, "SENSE_HTTP_PORT", 1, 65535)
  if (port === undefined) return null
  const nodeId = required(env, "SENSE_NODE_ID")
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId)) {
    throw new Error("SENSE_NODE_ID 应为控制台「执行节点」显示的节点 id（uuid）")
  }
  const allowedOrigins = (env.SENSE_HTTP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean)
  for (const origin of allowedOrigins) {
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      throw new Error(`SENSE_HTTP_ALLOWED_ORIGINS 中的 ${origin} 不是合法来源`)
    }
    if (url.origin !== origin) throw new Error(`SENSE_HTTP_ALLOWED_ORIGINS 只写来源（协议 + 域名 + 端口），不要带路径：${origin}`)
  }
  return {
    port,
    host: env.SENSE_HTTP_HOST?.trim() || "127.0.0.1",
    nodeId: nodeId.toLowerCase(),
    publicUrl: env.SENSE_HTTP_PUBLIC_URL?.trim() || `http://localhost:${port}`,
    allowedOrigins,
    maxConcurrentTurnsPerUser: intEnv(env, "SENSE_HTTP_MAX_TURNS_PER_USER", 1, 20) ?? 2,
    turnsPerMinute: intEnv(env, "SENSE_HTTP_TURNS_PER_MINUTE", 1, 600) ?? 20,
    budgetCents: intEnv(env, "SENSE_CHAT_BUDGET_CENTS", 1, 500),
    maxRounds: intEnv(env, "SENSE_CHAT_MAX_ROUNDS", 1, 20),
  }
}
