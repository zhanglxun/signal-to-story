/**
 * Deterministic AgentSessionDriver for tests and demos. Each step is replayed in order; a step can
 * call a tool through the host, ask for permission, or fail. Honours beforeModelCall before each
 * "model" step and the abort signal between steps, like a real driver must.
 */
import type { AgentSessionDriver, PermissionAsk, TurnHost, TurnInput, TurnOutcome } from "./driver"
import type { DriverEvent } from "./events"

export type FakeStep =
  | { kind: "model"; events: DriverEvent[]; costCents?: number }
  | { kind: "tool"; callId: string; name: string; input: unknown }
  | { kind: "permission"; ask: PermissionAsk; onDeny?: "stop" | "continue" }
  | { kind: "throw"; message: string }
  | { kind: "wait"; ms: number }

export class FakeAgentSessionDriver implements AgentSessionDriver {
  readonly kind: "api" | "acp"
  readonly runtimeId: string
  readonly inputs: TurnInput[] = []
  private readonly steps: FakeStep[]
  private readonly finalExecSession: Record<string, unknown> | null | undefined

  constructor(steps: FakeStep[], options: { runtimeId?: string; kind?: "api" | "acp"; execSession?: Record<string, unknown> | null } = {}) {
    this.steps = steps
    this.runtimeId = options.runtimeId ?? "api:fake:fake-model"
    this.kind = options.kind ?? "api"
    this.finalExecSession = options.execSession
  }

  async runTurn(input: TurnInput, host: TurnHost, signal: AbortSignal): Promise<TurnOutcome> {
    this.inputs.push(input)
    for (const step of this.steps) {
      if (signal.aborted) return { status: "cancelled" }
      switch (step.kind) {
        case "model": {
          const gate = host.beforeModelCall()
          if (!gate.ok) return { status: "error", error: { code: gate.code, message: gate.message, retryable: false } }
          for (const e of step.events) host.emit(e)
          host.emit({ type: "usage", inputTokens: 100, outputTokens: 50, costCents: step.costCents ?? 0, durationMs: 1, model: "fake-model" })
          break
        }
        case "tool": {
          host.emit({ type: "tool_start", callId: step.callId, name: step.name, inputSummary: JSON.stringify(step.input).slice(0, 200) })
          const r = await host.executeTool(step.name, step.input, signal)
          host.emit({ type: "tool_end", callId: step.callId, status: r.ok ? "succeeded" : "failed", outputSummary: r.outputSummary, ...(r.error ? { error: r.error } : {}), ...(r.stackTrace ? { stackTrace: r.stackTrace } : {}) })
          break
        }
        case "permission": {
          const decision = await host.requestPermission(step.ask, signal)
          if (decision === "deny" && (step.onDeny ?? "stop") === "stop") {
            host.emit({ type: "text_delta", delta: "（操作未获允许，已停止。）" })
            return { status: "completed", ...(this.finalExecSession !== undefined ? { execSession: this.finalExecSession } : {}) }
          }
          break
        }
        case "throw":
          throw new Error(step.message)
        case "wait":
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, step.ms)
            signal.addEventListener("abort", () => { clearTimeout(t); resolve() }, { once: true })
          })
          break
      }
    }
    if (signal.aborted) return { status: "cancelled" }
    return { status: "completed", ...(this.finalExecSession !== undefined ? { execSession: this.finalExecSession } : {}) }
  }
}
