import { hostname } from "node:os"

import type { LocalAgentCliKey } from "../../src/contracts/agent-harness"
import type { LlmClient } from "../../src/harness/llm"
import { getCloudModelProvider, LOCAL_AGENT_CLI_DRIVERS } from "../../src/harness/providers"
import { CliLlmClient } from "./drivers/cli-driver"
import { CloudLlmClient } from "./drivers/cloud-llm"

/** Reads ONLY from the process environment (never from sense-console/.env.local). */
export interface WorkerConfig {
  supabaseUrl: string
  serviceRoleKey: string
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

export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    supabaseUrl: required(env, "SUPABASE_URL"),
    serviceRoleKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
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
