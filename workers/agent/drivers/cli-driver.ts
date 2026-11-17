import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { LocalAgentCliKey } from "../../../sense-console/src/contracts/agent-harness"
import { approxTokens, type LlmClient, LlmCallError, type LlmRequest, type LlmResponse } from "../../../sense-console/src/harness/llm"
import { CLI_ENV_ALLOWLIST, getLocalAgentCliDriver } from "../../../sense-console/src/harness/providers"

export interface CliLlmConfig {
  cliKey: LocalAgentCliKey
  /** Override the binary path (default: registry binary resolved via PATH). */
  binary?: string
  model?: string
  timeoutMs?: number
  /** Extra env var names to pass through (on top of the allowlist). Values come from the worker env. */
  extraEnv?: string[]
  /** Refuse CLIs whose flags were not verified against `--help`. Default false. */
  allowUnverified?: boolean
  spawnImpl?: typeof spawn
}

export function buildChildEnv(source: NodeJS.ProcessEnv, extra: string[] = []): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of [...CLI_ENV_ALLOWLIST, ...extra]) {
    const value = source[key]
    if (typeof value === "string") env[key] = value
  }
  return env
}

export function renderMessagesForCli(request: LlmRequest): string {
  return request.messages.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join("\n\n")
}

/**
 * Headless CLI driver. Prompt -> stdin (never argv). Child env is an allowlist (no service_role,
 * no Supabase keys). Runs in an empty temp workspace with `--sandbox read-only`. Killed on timeout.
 * Only codex is verified; others throw unless allowUnverified.
 */
export class CliLlmClient implements LlmClient {
  readonly driver: string
  readonly model: string
  private readonly config: CliLlmConfig
  constructor(config: CliLlmConfig) {
    const definition = getLocalAgentCliDriver(config.cliKey)
    if (!definition.verified && !config.allowUnverified) {
      throw new Error(`CLI 驱动 ${config.cliKey} 的无交互参数尚未验证，worker 拒绝调用（见 workers/agent/README.md）`)
    }
    this.config = config
    this.driver = `cli:${config.cliKey}`
    this.model = config.model ?? `${definition.binary}-default`
  }

  buildArgs(workspaceDir: string, lastMessageFile: string): string[] {
    const definition = getLocalAgentCliDriver(this.config.cliKey)
    const args = [...definition.headlessArgsTemplate]
    if (this.config.cliKey === "codex-cli") {
      args.push("-C", workspaceDir, "-o", lastMessageFile)
      if (this.config.model) args.push("-m", this.config.model)
      args.push("-")
    }
    return args
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const definition = getLocalAgentCliDriver(this.config.cliKey)
    const workspace = await mkdtemp(path.join(tmpdir(), "sense-agent-"))
    const lastMessageFile = path.join(workspace, "last-message.txt")
    const prompt = renderMessagesForCli(request)
    try {
      const { code, stdout, stderr, timedOut } = await this.runChild(this.config.binary ?? definition.binary, this.buildArgs(workspace, lastMessageFile), workspace, prompt, request.signal)
      if (timedOut) throw new LlmCallError("CLI 执行超时，已终止子进程", { code: "timeout", retryable: false, billable: true })
      if (code !== 0) throw new LlmCallError(`CLI 退出码 ${code}: ${stderr.slice(-500)}`, { code: "cli_exit", retryable: false, billable: true })
      const text = this.config.cliKey === "codex-cli" ? await readFile(lastMessageFile, "utf8").catch(() => "") : stdout
      if (!text.trim()) throw new LlmCallError("CLI 没有返回最终消息", { code: "empty_output", retryable: false, billable: true })
      return { text, model: this.model, driver: this.driver, usage: { inputTokens: approxTokens(prompt), outputTokens: approxTokens(text), costCents: 0 } }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }

  private runChild(binary: string, args: string[], cwd: string, stdin: string, signal?: AbortSignal) {
    const spawnImpl = this.config.spawnImpl ?? spawn
    const timeoutMs = Math.min(Math.max(this.config.timeoutMs ?? 300_000, 5_000), 900_000)
    return new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
      const child = spawnImpl(binary, args, { cwd, env: buildChildEnv(process.env, this.config.extraEnv), stdio: ["pipe", "pipe", "pipe"] })
      let stdout = ""
      let stderr = ""
      let timedOut = false
      const kill = () => {
        timedOut = true
        child.kill("SIGTERM")
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref()
      }
      const timer = setTimeout(kill, timeoutMs)
      signal?.addEventListener("abort", kill, { once: true })
      child.stdout?.on("data", (chunk: Buffer) => { if (stdout.length < 2_000_000) stdout += chunk.toString() })
      child.stderr?.on("data", (chunk: Buffer) => { if (stderr.length < 200_000) stderr += chunk.toString() })
      child.on("error", (error) => {
        clearTimeout(timer)
        reject(new LlmCallError(`无法启动 CLI ${binary}: ${error.message}`, { code: "spawn", retryable: false, billable: false, cause: error }))
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        resolve({ code, stdout, stderr, timedOut })
      })
      child.stdin?.end(stdin)
    })
  }
}
