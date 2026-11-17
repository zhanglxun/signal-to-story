import { type LlmClient, LlmCallError, type LlmRequest, type LlmResponse } from "../../../sense-console/src/harness/llm"

export interface CloudLlmConfig {
  /** e.g. "qwen", "deepseek", "openai-compatible" — used only for labelling. */
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs?: number
  /** Optional pricing in cents per 1k tokens, for budget accounting. */
  inputCentsPer1k?: number
  outputCentsPer1k?: number
  /** Send `enable_thinking: false` (DashScope/Qwen). Default true for qwen. */
  disableThinking?: boolean
  fetchImpl?: typeof fetch
}

const PRE_SEND_ERRORS = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET_BEFORE_SEND", "UND_ERR_CONNECT_TIMEOUT"])

function causeCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } })?.cause
  return cause?.code
}

/** OpenAI-compatible /chat/completions driver (Qwen, Kimi, DeepSeek, GLM, MiniMax, gateways). */
export class CloudLlmClient implements LlmClient {
  readonly driver: string
  readonly model: string
  private readonly config: CloudLlmConfig
  constructor(config: CloudLlmConfig) {
    if (!config.baseUrl || !config.apiKey || !config.model) throw new Error("云端模型配置不完整 (baseUrl/apiKey/model)")
    this.config = config
    this.driver = `cloud:${config.provider}`
    this.model = config.model
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const fetchImpl = this.config.fetchImpl ?? fetch
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 90_000)
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? 4096,
      stream: false,
    }
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.responseFormat === "json_object") body.response_format = { type: "json_object" }
    if (this.config.disableThinking ?? this.config.provider === "qwen") body.enable_thinking = false

    let response: Response
    try {
      response = await fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    } catch (error) {
      const name = (error as Error)?.name
      if (name === "TimeoutError" || name === "AbortError") {
        // The provider may still bill for this request: never auto-retry.
        throw new LlmCallError("模型请求超时", { code: "timeout", retryable: false, billable: true, cause: error })
      }
      const code = causeCode(error)
      const preSend = code !== undefined && PRE_SEND_ERRORS.has(code)
      throw new LlmCallError(`无法连接模型服务${code ? ` (${code})` : ""}`, { code: "network", retryable: preSend, billable: !preSend, cause: error })
    }

    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
      if (failure?.error?.code === "AccessDenied.Unpurchased") {
        throw new LlmCallError("模型尚未开通使用权限，请更换已授权模型或开通服务", { code: "unpurchased", retryable: false, billable: false })
      }
      if (response.status === 429) throw new LlmCallError("模型服务限流 (429)", { code: "rate_limited", retryable: true, billable: false })
      if (response.status === 401 || response.status === 403) throw new LlmCallError(`模型鉴权失败 (${response.status})`, { code: "auth", retryable: false, billable: false })
      if (response.status >= 400 && response.status < 500) throw new LlmCallError(`模型请求无效 (${response.status})`, { code: "bad_request", retryable: false, billable: false })
      throw new LlmCallError(`模型服务返回 ${response.status}`, { code: "provider_error", retryable: false, billable: true })
    }

    const json = (await response.json().catch(() => null)) as {
      model?: string
      choices?: Array<{ message?: { content?: unknown } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    } | null
    const text = json?.choices?.[0]?.message?.content
    if (typeof text !== "string" || !text.trim()) {
      throw new LlmCallError("模型没有返回有效内容", { code: "empty_output", retryable: false, billable: true })
    }
    const inputTokens = json?.usage?.prompt_tokens ?? 0
    const outputTokens = json?.usage?.completion_tokens ?? 0
    const costCents = (inputTokens / 1000) * (this.config.inputCentsPer1k ?? 0) + (outputTokens / 1000) * (this.config.outputCentsPer1k ?? 0)
    return { text, model: json?.model ?? this.config.model, driver: this.driver, usage: { inputTokens, outputTokens, costCents } }
  }
}
