import { describe, expect, it } from "vitest"

import { CLOUD_MODEL_PROVIDERS, LOCAL_AGENT_CLI_DRIVERS } from "@/config/agent-runtimes"

describe("agent runtime display metadata", () => {
  it("registers domestic cloud LLM providers and local Agent CLI drivers", () => {
    const cloudKeys = CLOUD_MODEL_PROVIDERS.map((p) => p.key)
    expect(cloudKeys).toEqual(
      expect.arrayContaining(["qwen", "kimi", "deepseek", "zhipu", "minimax"])
    )

    const cliKeys = LOCAL_AGENT_CLI_DRIVERS.map((d) => d.key)
    expect(cliKeys).toEqual(
      expect.arrayContaining(["pi-cli", "opencode-cli", "codex-cli", "agy-cli"])
    )
  })
})
