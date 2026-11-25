/**
 * PiCloudDriver — AgentSessionDriver for cloud OpenAI-compatible APIs, built on
 * @earendil-works/pi-agent-core@1.5.2 (agent loop) + @earendil-works/pi-ai@1.5.2 (provider streams).
 *
 * Contract: workers/agent/loop/chat/driver.ts rules 1–6. Design: docs/modules/chat.md 4.2 and
 * docs/modules/chat.md 6.2.
 *
 * All pi-* types stay inside drivers/pi-*.ts; the rest of the worker only sees the loop's own types
 * (AgentSessionDriver, DriverEvent, …) and the plain PiRuntimeSpec below.
 */
import {
  type AgentEvent,
  type AgentLoopConfig,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
  runAgentLoop,
  type StreamFn,
} from "@earendil-works/pi-agent-core"
import type { AssistantMessage, Message, Model, OpenAICompletionsCompat, ThinkingLevel, Usage } from "@earendil-works/pi-ai"
import { streamSimple } from "@earendil-works/pi-ai/compat"

import type { ChatMessage } from "../loop/llm"
import type {
  AgentSessionDriver,
  ChatToolResult,
  ChatToolSpec,
  ModelCallGate,
  TurnHost,
  TurnInput,
  TurnOutcome,
} from "../loop/chat/driver"
import type { ThinkingEffort } from "../loop/chat/events"

/** Per-model unit prices from node configuration (never stored in the database). */
export interface PiModelPricing {
  inputCentsPer1k: number
  outputCentsPer1k: number
}

/** Plain description of one cloud runtime; the registry builds it from env, no pi types involved. */
export interface PiRuntimeSpec {
  /** "api:<provider>:<model>" — matches runtimes[].id in the capability catalog. */
  runtimeId: string
  /** Registry provider key, e.g. "qwen", "deepseek", "kimi", "zhipu", "minimax", "openai-compatible". */
  provider: string
  /** Model id sent to the provider, e.g. "qwen3.8-flash". */
  model: string
  label: string
  baseUrl: string
  apiKey: string
  /** Thinking-capable model. Stays true even when a turn turns thinking off (spike 4.2 #2). */
  reasoning: boolean
  contextWindow: number
  maxOutputTokens: number
  pricing: PiModelPricing | null
  timeoutMs?: number
  /** Client-side retries of the provider SDK (before any token is streamed). Default 1. */
  maxRetries?: number
}

export interface PiCloudDriverOptions {
  spec: PiRuntimeSpec
  /** Injectable for tests; defaults to pi-ai's streamSimple. */
  streamFn?: StreamFn
  now?: () => number
}

// ── Model construction ───────────────────────────────────────────────────────────────────────────

const QWEN_COMPAT: OpenAICompletionsCompat = {
  thinkingFormat: "qwen",
  supportsDeveloperRole: false,
  supportsStore: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
}

const DEEPSEEK_COMPAT: OpenAICompletionsCompat = {
  thinkingFormat: "deepseek",
  supportsDeveloperRole: false,
  supportsStore: false,
  maxTokensField: "max_tokens",
  requiresReasoningContentOnAssistantMessages: true,
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return ""
  }
}

export function isDashScopeEndpoint(spec: Pick<PiRuntimeSpec, "provider" | "baseUrl">): boolean {
  const host = hostOf(spec.baseUrl)
  return spec.provider === "qwen" || host.endsWith("dashscope.aliyuncs.com") || host.includes("dashscope")
}

export function isDeepSeekEndpoint(spec: Pick<PiRuntimeSpec, "provider" | "baseUrl">): boolean {
  return spec.provider === "deepseek" || hostOf(spec.baseUrl).endsWith("deepseek.com")
}

/**
 * pi-ai's detectCompat does not know DashScope: without the full explicit compat a reasoning model
 * gets `developer` instead of `system` and DashScope answers 400 (spike 4.2 #1). DeepSeek is detected
 * by host, but behind a gateway it would not be, so it is pinned too. Any other non-OpenAI endpoint
 * keeps the `system` role, the one every OpenAI-compatible server accepts.
 */
export function piCompatFor(spec: Pick<PiRuntimeSpec, "provider" | "baseUrl">): OpenAICompletionsCompat | undefined {
  if (isDashScopeEndpoint(spec)) return { ...QWEN_COMPAT }
  if (isDeepSeekEndpoint(spec)) return { ...DEEPSEEK_COMPAT }
  if (hostOf(spec.baseUrl) === "api.openai.com") return undefined
  return { supportsDeveloperRole: false }
}

export function buildPiModel(spec: PiRuntimeSpec): Model<"openai-completions"> {
  const compat = piCompatFor(spec)
  return {
    id: spec.model,
    name: spec.label,
    api: "openai-completions",
    provider: spec.provider,
    baseUrl: spec.baseUrl,
    reasoning: spec.reasoning,
    input: ["text"],
    // Budget accounting uses PiModelPricing; pi's own catalog cost stays 0 (spike 4.2 #5).
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: spec.contextWindow,
    maxTokens: spec.maxOutputTokens,
    ...(compat ? { compat } : {}),
  }
}

// ── Pure mapping helpers ─────────────────────────────────────────────────────────────────────────

/** "off" → undefined turns thinking off; model.reasoning stays true (spike 4.2 #2). */
export function piReasoningFor(effort: ThinkingEffort, modelReasons: boolean): ThinkingLevel | undefined {
  if (!modelReasons || effort === "off") return undefined
  return effort
}

export function costCentsFor(usage: Pick<Usage, "input" | "output" | "cacheRead" | "cacheWrite">, pricing: PiModelPricing | null): number {
  if (!pricing) return 0
  // Cached input is billed at the input price: an overestimate is the safe side for a budget gate.
  const input = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
  const cents = (input / 1000) * pricing.inputCentsPer1k + ((usage.output ?? 0) / 1000) * pricing.outputCentsPer1k
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents * 10_000) / 10_000 : 0 // numeric(14,4)
}

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

/** TurnInput.messages (first is system) → pi messages, each with a timestamp (spike 5 #2). */
export function toPiMessages(messages: ChatMessage[], model: Model<"openai-completions">, now: number): Message[] {
  const base = now - messages.length
  return messages.map((m, i): Message => {
    const timestamp = base + i
    if (m.role === "system") return { role: "system", content: m.content, timestamp }
    if (m.role === "user") return { role: "user", content: m.content, timestamp }
    return {
      role: "assistant",
      content: [{ type: "text", text: m.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: ZERO_USAGE,
      stopReason: "stop",
      timestamp,
    }
  })
}

const SECRET_LIKE = /\b(sk-[A-Za-z0-9_-]{8,}|stn_[a-f0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{8,})/g

/** Provider error text goes to the user and the database: drop anything key-shaped and cap it. */
export function sanitizeProviderMessage(message: string | undefined): string {
  const text = (message ?? "").replace(SECRET_LIKE, "[REDACTED]").trim()
  if (!text) return "模型服务返回错误"
  return text.length > 500 ? `${text.slice(0, 500)}…` : text
}

export function classifyProviderError(message: string | undefined): { code: string; retryable: boolean } {
  const text = message ?? ""
  if (/\b429\b|rate.?limit|too many requests|throttl/i.test(text)) return { code: "rate_limited", retryable: true }
  if (/\b(500|502|503|504|529)\b|overload|unavailable|timed? ?out|timeout|ECONN|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed/i.test(text)) {
    return { code: "provider_unavailable", retryable: true }
  }
  return { code: "provider_error", retryable: false }
}

const summarize = (value: unknown, max = 200): string => {
  let text: string
  try {
    text = typeof value === "string" ? value : JSON.stringify(value ?? {})
  } catch {
    text = String(value)
  }
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function toolResultText(result: unknown): string {
  const content = (result as AgentToolResult<unknown> | undefined)?.content
  if (!Array.isArray(content)) return ""
  return content.map((c) => (c.type === "text" ? c.text : "")).join("\n").trim()
}

// ── Driver ───────────────────────────────────────────────────────────────────────────────────────

type GateFailure = Extract<ModelCallGate, { ok: false }>

export class PiCloudDriver implements AgentSessionDriver {
  readonly kind = "api" as const
  readonly runtimeId: string
  readonly model: Model<"openai-completions">
  private readonly spec: PiRuntimeSpec
  private readonly streamFn: StreamFn
  private readonly now: () => number

  constructor(options: PiCloudDriverOptions) {
    const { spec } = options
    if (!spec.baseUrl || !spec.apiKey || !spec.model) throw new Error(`运行时 ${spec.runtimeId} 配置不完整 (baseUrl/apiKey/model)`)
    this.spec = spec
    this.runtimeId = spec.runtimeId
    this.model = buildPiModel(spec)
    this.streamFn = options.streamFn ?? streamSimple
    this.now = options.now ?? Date.now
  }

  async runTurn(input: TurnInput, host: TurnHost, signal: AbortSignal): Promise<TurnOutcome> {
    if (signal.aborted) return { status: "cancelled" }

    // Rule 1: gate the first request before the loop starts.
    const first = host.beforeModelCall()
    if (!first.ok) return gateError(first)

    // Platform tool results keyed by call id, so tool_end can carry the host's summary / error / stack.
    const toolResults = new Map<string, ChatToolResult>()
    const tools = input.tools.map((spec) => this.toAgentTool(spec, host, toolResults))

    let gateFailure: GateFailure | null = null
    let last: AssistantMessage | null = null

    const config: AgentLoopConfig = {
      model: this.model,
      apiKey: this.spec.apiKey,
      reasoning: piReasoningFor(input.thinkingEffort, this.model.reasoning),
      maxTokens: Math.max(1, Math.min(input.maxOutputTokens || this.model.maxTokens, this.model.maxTokens)),
      maxRetries: this.spec.maxRetries ?? 1,
      ...(this.spec.timeoutMs ? { timeoutMs: this.spec.timeoutMs } : {}),
      // Permission prompts and tool side effects stay in call order.
      toolExecution: "sequential",
      // No custom message kinds: everything is already an LLM message.
      convertToLlm: (messages: AgentMessage[]) => messages as Message[],
      // Rule 1: gate every further request. Only a turn with tool results triggers another request;
      // error/aborted turns are hard exits and ignore the decision.
      finishTurn: (turn) => {
        const stop = turn.message.stopReason
        if (stop === "error" || stop === "aborted") return undefined
        if (turn.toolResults.length === 0) return undefined
        if (signal.aborted) return { action: "end" }
        const gate = host.beforeModelCall()
        if (!gate.ok) {
          gateFailure = gate
          return { action: "end" }
        }
        return undefined
      },
    }

    // Everything goes in as prompts so the system message comes first and pi folds the tool
    // declarations into it (no mid-conversation system message).
    const prompts = toPiMessages(input.messages, this.model, this.now())
    const replayed = new WeakSet<object>(prompts)

    const emit = (event: AgentEvent): void => {
      switch (event.type) {
        case "message_update": {
          const e = event.assistantMessageEvent
          if (e.type === "thinking_delta" && e.delta) host.emit({ type: "reasoning_delta", delta: e.delta })
          else if (e.type === "text_delta" && e.delta) host.emit({ type: "text_delta", delta: e.delta })
          return
        }
        case "tool_execution_start":
          host.emit({ type: "tool_start", callId: event.toolCallId, name: event.toolName, inputSummary: summarize(event.args) })
          return
        case "tool_execution_end": {
          const r = toolResults.get(event.toolCallId)
          if (r) {
            host.emit({
              type: "tool_end",
              callId: event.toolCallId,
              status: r.ok && !event.isError ? "succeeded" : "failed",
              outputSummary: r.outputSummary,
              ...(r.error ? { error: r.error } : {}),
              ...(r.stackTrace ? { stackTrace: r.stackTrace } : {}),
            })
          } else {
            // Never reached host.executeTool: unknown tool, invalid arguments, or aborted.
            const text = toolResultText(event.result) || "工具未执行"
            host.emit({ type: "tool_end", callId: event.toolCallId, status: "failed", outputSummary: summarize(text), error: summarize(text, 2000) })
          }
          return
        }
        case "message_end": {
          // History replayed as prompts also passes through message_end; only live responses count.
          if (event.message.role !== "assistant" || replayed.has(event.message)) return
          const m = event.message
          last = m
          // Rule 2: one usage event per model response, aborted / failed ones included.
          host.emit({
            type: "usage",
            inputTokens: (m.usage?.input ?? 0) + (m.usage?.cacheRead ?? 0) + (m.usage?.cacheWrite ?? 0),
            outputTokens: m.usage?.output ?? 0,
            costCents: costCentsFor(m.usage ?? ZERO_USAGE, this.spec.pricing),
            durationMs: m.durationMs ?? Math.max(0, this.now() - m.timestamp),
            model: m.responseModel || m.model || this.spec.model,
          })
          return
        }
        default:
          return
      }
    }

    try {
      // runAgentLoop (not agentLoop) so a failure rejects here instead of leaving the stream open.
      await runAgentLoop(prompts, { messages: [], tools }, config, emit, signal, this.streamFn)
    } catch (error) {
      if (signal.aborted) return { status: "cancelled" }
      const message = error instanceof Error ? error.message : String(error)
      const { code, retryable } = classifyProviderError(message)
      return {
        status: "error",
        error: { code, message: sanitizeProviderMessage(message), retryable, ...(error instanceof Error && error.stack ? { stack: error.stack } : {}) },
      }
    }

    const failed = gateFailure as GateFailure | null
    if (failed) return gateError(failed)
    const final = last as AssistantMessage | null
    // Rule 4: an abort ends the stream with stopReason "aborted" instead of throwing (spike 4.2 #4).
    if (signal.aborted || final?.stopReason === "aborted") return { status: "cancelled" }
    if (final?.stopReason === "error") {
      const { code, retryable } = classifyProviderError(final.errorMessage)
      return { status: "error", error: { code, message: sanitizeProviderMessage(final.errorMessage), retryable } }
    }
    if (!final) return { status: "error", error: { code: "provider_error", message: "模型没有返回内容", retryable: true } }
    return { status: "completed" }
  }

  /** Rule 3: a platform tool is a pi AgentTool whose execute goes through host.executeTool only. */
  private toAgentTool(spec: ChatToolSpec, host: TurnHost, results: Map<string, ChatToolResult>): AgentTool {
    return {
      name: spec.name,
      label: spec.name,
      description: spec.description,
      // JSON Schema passes through as-is (spike 5 #3).
      parameters: spec.inputSchema,
      execute: async (toolCallId, params, signal) => {
        const r = await host.executeTool(spec.name, params, signal ?? new AbortController().signal)
        results.set(toolCallId, r)
        let text: string
        try {
          text = typeof r.output === "string" ? r.output : JSON.stringify(r.output ?? null)
        } catch {
          text = r.outputSummary
        }
        if (!r.ok) text = JSON.stringify({ ok: false, error: r.error ?? "failed", summary: r.outputSummary, output: r.output ?? null })
        return { content: [{ type: "text", text }], details: { ok: r.ok }, isError: !r.ok }
      },
    }
  }
}

function gateError(gate: GateFailure): TurnOutcome {
  return { status: "error", error: { code: gate.code, message: gate.message, retryable: false } }
}

export function createPiCloudDriver(spec: PiRuntimeSpec, options: Omit<PiCloudDriverOptions, "spec"> = {}): PiCloudDriver {
  return new PiCloudDriver({ spec, ...options })
}
