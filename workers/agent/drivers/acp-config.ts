/**
 * The only place the ACP side reads the environment (the driver and registry take options).
 *
 *   SENSE_ACP_CLIS            comma-separated CLI keys to enable on this node, e.g. "opencode,codex"
 *   SENSE_ACP_<KEY>_COMMAND   override the adapter binary (KEY upper-cased, "-" → "_")
 *   SENSE_ACP_<KEY>_ARGS      override the adapter arguments (space-separated)
 *   SENSE_ACP_TMPDIR          parent of the per-session working directories (default: os.tmpdir())
 *
 * Launch commands below are NOT verified against real sessions yet (待真机验证); they are the
 * documented adapter entry points as of 2026-11. Pick the CLI's strictest sandbox / approval mode
 * once verified, and record it here (ACP-info §7.2).
 */
import { tmpdir } from "node:os"

import { type AcpCliSpec, AcpRegistry } from "./acp-registry"
import { AcpSessionDriver } from "./acp-driver"

export const KNOWN_ACP_CLIS: Record<string, AcpCliSpec> = {
  // `opencode acp` exists in opencode v2.4.1 (`opencode acp --help`); session behaviour 待真机验证.
  opencode: { cliKey: "opencode", command: "opencode", args: ["acp"], label: "OpenCode CLI（本机 ACP）" },
  // Codex has no native ACP entry; the separate `codex-acp` adapter is required. 待真机验证.
  codex: { cliKey: "codex", command: "codex-acp", args: [], extraEnv: ["CODEX_HOME"], label: "Codex CLI（本机 ACP 适配器）" },
  // @agentclientprotocol/claude-agent-acp adapter binary. 待真机验证.
  claude: { cliKey: "claude", command: "claude-agent-acp", args: [], label: "Claude Code（本机 ACP 适配器）" },
}

export function readAcpCliSpecs(env: Record<string, string | undefined>): AcpCliSpec[] {
  const keys = (env.SENSE_ACP_CLIS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return keys.map((key) => {
    const known = KNOWN_ACP_CLIS[key]
    const envKey = key.toUpperCase().replace(/-/g, "_")
    const command = env[`SENSE_ACP_${envKey}_COMMAND`]?.trim() || known?.command
    if (!command) throw new Error(`SENSE_ACP_CLIS 中的 ${key} 不是已知 CLI，请设置 SENSE_ACP_${envKey}_COMMAND`)
    const argsOverride = env[`SENSE_ACP_${envKey}_ARGS`]
    const args = argsOverride !== undefined ? argsOverride.split(/\s+/).filter(Boolean) : (known?.args ?? [])
    return { ...(known ?? { cliKey: key }), cliKey: key, command, args }
  })
}

/** Builds the node's ACP registry and one driver per enabled CLI; installs the exit cleanup hooks. */
export function createAcpRuntimeFromEnv(options: { nodeId: string; env?: Record<string, string | undefined> }) {
  const env = options.env ?? process.env
  const clis = readAcpCliSpecs(env)
  const registry = new AcpRegistry({ nodeId: options.nodeId, clis, baseEnv: env, tempRoot: env.SENSE_ACP_TMPDIR?.trim() || tmpdir() })
  registry.installExitHooks()
  const drivers = clis.map((cli) => new AcpSessionDriver({ registry, cliKey: cli.cliKey }))
  return { registry, drivers }
}
