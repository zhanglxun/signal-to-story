/**
 * ACP subprocess registry (docs/ACP-info.md §7.5, docs/modules/chat.md 3.4 point 5).
 *
 * Owns every ACP adapter subprocess on this node, keyed by chat session id:
 * - at most one subprocess per chat session;
 * - idle subprocesses are shut down after `idleTimeoutMs` (default 10 minutes);
 * - at most `maxConcurrent` subprocesses per node (default 3); when full, the oldest idle one is
 *   evicted, and if every one is busy the new turn is rejected with AcpRegistryError("acp_capacity");
 * - every subprocess is killed when the worker exits.
 *
 * Security (ACP-info §7): the child env is built from CLI_ENV_ALLOWLIST plus names the CLI table
 * declares, and names that look like platform or model credentials are always dropped. Each chat
 * session gets its own private working directory under `tempRoot` (deterministic, so session/load
 * finds the same cwd after an idle shutdown). The registry never reads process.env itself; the
 * caller passes `baseEnv` (see createAcpRegistryFromEnv in acp-driver.ts).
 */
import { type ChildProcess, spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { Readable, Writable } from "node:stream"

import { type ClientConnection, client, ndJsonStream, type RequestPermissionRequest, type RequestPermissionResponse, type SessionNotification } from "@agentclientprotocol/sdk"

import { CLI_ENV_ALLOWLIST } from "../loop/providers"

export const ACP_IDLE_TIMEOUT_MS = 10 * 60_000
export const ACP_MAX_CONCURRENT = 3
const KILL_GRACE_MS = 2_000
const STDERR_TAIL_BYTES = 4_096

/** One local CLI that speaks ACP over stdio. */
export interface AcpCliSpec {
  /** Short key, e.g. "opencode" or "codex". Runtime id becomes `acp:<cliKey>`. */
  cliKey: string
  command: string
  args: string[]
  /** Extra env names passed through on top of CLI_ENV_ALLOWLIST (e.g. a CLI config dir or proxy). */
  extraEnv?: string[]
  label?: string
}

export interface AcpRegistryOptions {
  nodeId: string
  clis: AcpCliSpec[]
  /** Source env to filter (the factory passes process.env); never forwarded as a whole. */
  baseEnv: Record<string, string | undefined>
  /** Parent directory of the per-session working directories. */
  tempRoot: string
  idleTimeoutMs?: number
  maxConcurrent?: number
}

export class AcpRegistryError extends Error {
  readonly code: string
  readonly retryable: boolean
  constructor(code: string, message: string, retryable: boolean) {
    super(message)
    this.name = "AcpRegistryError"
    this.code = code
    this.retryable = retryable
  }
}

/** Env names that must never reach a local CLI, even when a CLI spec asks for them. */
const FORBIDDEN_ENV = /^(SENSE_|SUPABASE_)|(API_?KEY|TOKEN|SECRET|PASSWORD|SERVICE_ROLE)/i

export function buildAcpEnv(baseEnv: Record<string, string | undefined>, extra: readonly string[] = []): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of [...CLI_ENV_ALLOWLIST, ...extra]) {
    if (FORBIDDEN_ENV.test(key)) continue
    const value = baseEnv[key]
    if (typeof value === "string") env[key] = value
  }
  return env
}

const SESSION_KEY = /^[A-Za-z0-9_-]{1,128}$/

/** Per-turn callbacks the driver installs while it owns the process. */
export interface AcpTurnHooks {
  onUpdate(notification: SessionNotification): void
  onPermission(request: RequestPermissionRequest, signal: AbortSignal): Promise<RequestPermissionResponse>
}

export interface AcpExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
  stderrTail: string
}

/** A live ACP adapter subprocess bound to one chat session. */
export class AcpProcess {
  readonly sessionKey: string
  readonly cli: AcpCliSpec
  readonly cwd: string
  readonly connection: ClientConnection
  /** Resolves when the subprocess exits (for any reason). */
  readonly exited: Promise<AcpExitInfo>
  /** Set by the driver after initialize. */
  initialized: { protocolVersion: number; loadSession: boolean } | null = null
  /** ACP session currently open inside this subprocess (after session/new or session/load). */
  acpSessionId: string | null = null
  busy = false
  turn: AcpTurnHooks | null = null
  exitInfo: AcpExitInfo | null = null
  lastUsed = Date.now()
  idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly child: ChildProcess
  private stderrTail = ""

  constructor(sessionKey: string, cli: AcpCliSpec, cwd: string, env: Record<string, string>) {
    this.sessionKey = sessionKey
    this.cli = cli
    this.cwd = cwd
    // detached: own process group, so adapters that spawn the real CLI are killed with it.
    this.child = spawn(cli.command, cli.args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" })
    const child = this.child
    this.exited = new Promise((resolve) => {
      let settled = false
      const finish = (code: number | null, signal: NodeJS.Signals | null, extra = "") => {
        if (settled) return
        settled = true
        this.exitInfo = { code, signal, stderrTail: (this.stderrTail + extra).slice(-STDERR_TAIL_BYTES) }
        resolve(this.exitInfo)
      }
      child.once("exit", (code, signal) => finish(code, signal))
      child.once("error", (error) => finish(null, null, `\n${error.message}`))
    })
    child.stdin?.on("error", () => {}) // EPIPE after the child died; surfaced through `exited`
    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES)
    })

    const app = client({ name: "signal-to-story" })
      .onNotification("session/update", ({ params }) => {
        this.turn?.onUpdate(params)
      })
      .onRequest("session/request_permission", async ({ params, signal }) => {
        // No turn owns the process: nobody can answer, so the request is cancelled (never allowed).
        if (!this.turn) return { outcome: { outcome: "cancelled" } }
        return this.turn.onPermission(params, signal)
      })
    // fs/* and terminal/* are deliberately not registered (and not advertised in initialize).
    const output = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>
    const input = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>
    this.connection = app.connect(ndJsonStream(output, input))
    void this.exited.then(() => this.connection.close(new Error("ACP 子进程已退出")))
  }

  get pid(): number | undefined {
    return this.child.pid
  }

  get alive(): boolean {
    return this.exitInfo === null
  }

  /** SIGTERM the process group, SIGKILL after a grace period. */
  async kill(): Promise<void> {
    if (!this.alive) return
    this.signal("SIGTERM")
    const timer = setTimeout(() => this.signal("SIGKILL"), KILL_GRACE_MS)
    timer.unref?.()
    await this.exited
    clearTimeout(timer)
  }

  killSync(): void {
    if (this.alive) this.signal("SIGKILL")
  }

  private signal(sig: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && this.child.pid) process.kill(-this.child.pid, sig)
      else this.child.kill(sig)
    } catch {
      try {
        this.child.kill(sig)
      } catch {
        // already gone
      }
    }
  }
}

export class AcpRegistry {
  readonly nodeId: string
  private readonly clis: Map<string, AcpCliSpec>
  private readonly baseEnv: Record<string, string | undefined>
  private readonly tempRoot: string
  private readonly idleTimeoutMs: number
  private readonly maxConcurrent: number
  private readonly processes = new Map<string, AcpProcess>()
  private exitHookInstalled = false

  constructor(options: AcpRegistryOptions) {
    if (!options.nodeId) throw new Error("AcpRegistry 需要 nodeId")
    this.nodeId = options.nodeId
    this.clis = new Map(options.clis.map((c) => [c.cliKey, c]))
    this.baseEnv = options.baseEnv
    this.tempRoot = path.resolve(options.tempRoot)
    this.idleTimeoutMs = options.idleTimeoutMs ?? ACP_IDLE_TIMEOUT_MS
    this.maxConcurrent = options.maxConcurrent ?? ACP_MAX_CONCURRENT
  }

  cli(cliKey: string): AcpCliSpec | undefined {
    return this.clis.get(cliKey)
  }

  get size(): number {
    return this.processes.size
  }

  /** The private working directory of a chat session (created on demand, mode 0700). */
  sessionCwd(sessionKey: string): string {
    if (!SESSION_KEY.test(sessionKey)) throw new AcpRegistryError("acp_invalid_session", "会话 id 格式不合法", false)
    const dir = path.join(this.tempRoot, `sts-acp-${sessionKey}`)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    return dir
  }

  /**
   * Returns the session's live subprocess for `cliKey`, or spawns one. Marks it busy; pair every
   * acquire with release() or dispose().
   */
  async acquire(sessionKey: string, cliKey: string): Promise<AcpProcess> {
    const cli = this.clis.get(cliKey)
    if (!cli) throw new AcpRegistryError("acp_cli_not_configured", `本节点未配置 ACP CLI：${cliKey}`, false)
    const existing = this.processes.get(sessionKey)
    if (existing) {
      if (existing.busy) throw new AcpRegistryError("acp_session_busy", "该会话已有进行中的回合", true)
      if (existing.alive && existing.cli.cliKey === cliKey) {
        this.markBusy(existing)
        return existing
      }
      await this.dispose(sessionKey)
    }
    if (this.processes.size >= this.maxConcurrent) {
      const idle = [...this.processes.values()].filter((p) => !p.busy).sort((a, b) => a.lastUsed - b.lastUsed)[0]
      if (!idle) {
        throw new AcpRegistryError("acp_capacity", `本节点同时运行的本地 CLI 会话已达上限（${this.maxConcurrent} 个），请稍后再试`, true)
      }
      await this.dispose(idle.sessionKey)
    }
    const cwd = this.sessionCwd(sessionKey)
    const proc = new AcpProcess(sessionKey, cli, cwd, buildAcpEnv(this.baseEnv, cli.extraEnv))
    this.processes.set(sessionKey, proc)
    void proc.exited.then(() => {
      if (this.processes.get(sessionKey) === proc) {
        if (proc.idleTimer) clearTimeout(proc.idleTimer)
        this.processes.delete(sessionKey)
      }
    })
    this.markBusy(proc)
    return proc
  }

  /** The turn is over; keep the process for the idle period. */
  release(proc: AcpProcess): void {
    proc.busy = false
    proc.turn = null
    proc.lastUsed = Date.now()
    if (!proc.alive || this.processes.get(proc.sessionKey) !== proc) return
    if (proc.idleTimer) clearTimeout(proc.idleTimer)
    proc.idleTimer = setTimeout(() => {
      if (!proc.busy) void this.dispose(proc.sessionKey)
    }, this.idleTimeoutMs)
    proc.idleTimer.unref?.()
  }

  /** Kill and forget the session's subprocess. */
  async dispose(sessionKey: string): Promise<void> {
    const proc = this.processes.get(sessionKey)
    if (!proc) return
    this.processes.delete(sessionKey)
    if (proc.idleTimer) clearTimeout(proc.idleTimer)
    proc.turn = null
    await proc.kill()
  }

  async shutdownAll(): Promise<void> {
    await Promise.all([...this.processes.keys()].map((k) => this.dispose(k)))
  }

  /** Synchronous last resort for process "exit": SIGKILL every process group. */
  killAllSync(): void {
    for (const proc of this.processes.values()) proc.killSync()
    this.processes.clear()
  }

  /** Kill every subprocess when the worker exits. Idempotent. */
  installExitHooks(): void {
    if (this.exitHookInstalled) return
    this.exitHookInstalled = true
    process.once("exit", () => this.killAllSync())
    // A default SIGINT/SIGTERM exit skips "exit" listeners, and the children live in their own
    // process groups, so kill them here. Re-raise only when nobody else handles the signal, to keep
    // the default "terminate" behaviour without overriding an entry point's graceful shutdown.
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.once(sig, () => {
        this.killAllSync()
        if (process.listenerCount(sig) === 0) process.kill(process.pid, sig)
      })
    }
  }

  private markBusy(proc: AcpProcess): void {
    if (proc.idleTimer) clearTimeout(proc.idleTimer)
    proc.idleTimer = null
    proc.busy = true
    proc.lastUsed = Date.now()
  }
}
