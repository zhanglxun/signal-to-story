/** Injectable LLM client interface shared by the browser-safe harness and the Node worker. */

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  /** Cost in cents when the driver knows pricing; 0 otherwise. */
  costCents: number
}

export interface LlmRequest {
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  /** Ask OpenAI-compatible providers for a JSON object (evaluator). */
  responseFormat?: "text" | "json_object"
  signal?: AbortSignal
}

export interface LlmResponse {
  text: string
  model: string
  driver: string
  usage: LlmUsage
}

export interface LlmClient {
  /** e.g. "cloud:qwen", "cli:codex-cli", "fake". */
  readonly driver: string
  readonly model: string
  complete(request: LlmRequest): Promise<LlmResponse>
}

/**
 * Classified driver failure.
 * - retryable: the job may be re-queued (e.g. connection refused, 429).
 * - billable: the provider may have charged for this call (timeout after send, 5xx, bad output).
 *   Billable failures are never retried automatically — a human re-runs them.
 */
export class LlmCallError extends Error {
  readonly retryable: boolean
  readonly billable: boolean
  readonly code: string
  constructor(message: string, options: { code: string; retryable: boolean; billable: boolean; cause?: unknown }) {
    super(message, { cause: options.cause })
    this.name = "LlmCallError"
    this.code = options.code
    this.retryable = options.retryable && !options.billable
    this.billable = options.billable
  }
}

export const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, costCents: 0 }

export type FakeLlmScript = (request: LlmRequest, callIndex: number) => string | Partial<LlmResponse> | Promise<string | Partial<LlmResponse>>

/** Deterministic test double. Records every request. */
export class FakeLlmClient implements LlmClient {
  readonly driver: string
  readonly model: string
  readonly calls: LlmRequest[] = []
  private readonly script: FakeLlmScript
  constructor(script: FakeLlmScript, options: { model?: string; driver?: string } = {}) {
    this.script = script
    this.model = options.model ?? "fake-model"
    this.driver = options.driver ?? "fake"
  }
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const index = this.calls.length
    this.calls.push(request)
    const out = await this.script(request, index)
    const partial = typeof out === "string" ? { text: out } : out
    const text = partial.text ?? ""
    return {
      text,
      model: partial.model ?? this.model,
      driver: partial.driver ?? this.driver,
      usage: partial.usage ?? { inputTokens: approxTokens(request.messages.map((m) => m.content).join("")), outputTokens: approxTokens(text), costCents: 0 },
    }
  }
}

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 2)
}

/** Strip a single wrapping ``` fence (```markdown / ```json) if the model added one. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/)
  return match ? match[1].trim() : trimmed
}
