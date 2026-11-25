/**
 * PiCloudDriver against a scripted fake streamFn: no network, no keys. Each fake response replays
 * pi-ai AssistantMessageEvents the way openai-completions would, so the real pi-agent-core loop
 * (tool execution, finishTurn, abort handling) runs unchanged.
 */
import type { StreamFn } from "@earendil-works/pi-agent-core"
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai"
import { describe, expect, it } from "vitest"

import {
  type ChatStreamEvent,
  type ChatToolResult,
  type ChatToolSpec,
  type ChatTurnPorts,
  type DriverEvent,
  type ModelCallGate,
  runChatTurn,
  type TurnHost,
  type TurnInput,
  TurnBudget,
  type UsageEvent,
} from "../loop/chat"
import {
  buildPiModel,
  classifyProviderError,
  costCentsFor,
  PiCloudDriver,
  type PiRuntimeSpec,
  piReasoningFor,
  sanitizeProviderMessage,
} from "./pi-cloud"

// ── Fake provider stream ─────────────────────────────────────────────────────────────────────────

interface FakeResponse {
  thinking?: string[]
  text?: string[]
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]
  usage?: Partial<Usage>
  /** Ends the response with stopReason "error" and this message. */
  error?: string
  /** Called after each text chunk is pushed (lets a test abort mid-stream). */
  afterChunk?: (index: number) => void
}

interface FakeCall {
  model: Model<"openai-completions">
  messages: Message[]
  options: SimpleStreamOptions | undefined
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function fakeStream(responses: FakeResponse[]) {
  const calls: FakeCall[] = []
  const streamFn: StreamFn = (model, context, options) => {
    calls.push({ model: model as Model<"openai-completions">, messages: [...context.messages], options })
    const script = responses[calls.length - 1]
    if (!script) throw new Error(`unexpected request #${calls.length}`)
    const stream = createAssistantMessageEventStream()
    const usage: Usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      ...script.usage,
    }
    const partial: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage,
      stopReason: "pending",
      timestamp: Date.now(),
    }
    const finish = (stopReason: AssistantMessage["stopReason"], errorMessage?: string) => {
      const message: AssistantMessage = { ...partial, content: [...partial.content], stopReason, ...(errorMessage ? { errorMessage } : {}) }
      if (stopReason === "aborted" || stopReason === "error") stream.push({ type: "error", reason: stopReason, error: message })
      else stream.push({ type: "done", reason: stopReason as "stop" | "toolUse", message })
    }
    void (async () => {
      await tick()
      stream.push({ type: "start", partial })
      const signal = options?.signal
      if (script.thinking?.length) {
        const index = partial.content.push({ type: "thinking", thinking: "" }) - 1
        stream.push({ type: "thinking_start", contentIndex: index, partial })
        for (const delta of script.thinking) {
          ;(partial.content[index] as { thinking: string }).thinking += delta
          stream.push({ type: "thinking_delta", contentIndex: index, delta, partial })
          await tick()
        }
        stream.push({ type: "thinking_end", contentIndex: index, content: (partial.content[index] as { thinking: string }).thinking, partial })
      }
      if (script.text?.length) {
        const index = partial.content.push({ type: "text", text: "" }) - 1
        stream.push({ type: "text_start", contentIndex: index, partial })
        for (const [i, delta] of script.text.entries()) {
          if (signal?.aborted) return finish("aborted", "Request was aborted")
          ;(partial.content[index] as { text: string }).text += delta
          stream.push({ type: "text_delta", contentIndex: index, delta, partial })
          script.afterChunk?.(i)
          await tick()
        }
        if (signal?.aborted) return finish("aborted", "Request was aborted")
        stream.push({ type: "text_end", contentIndex: index, content: (partial.content[index] as { text: string }).text, partial })
      }
      for (const call of script.toolCalls ?? []) {
        const toolCall: ToolCall = { type: "toolCall", id: call.id, name: call.name, arguments: call.args as ToolCall["arguments"] }
        const index = partial.content.push(toolCall) - 1
        stream.push({ type: "toolcall_start", contentIndex: index, partial })
        stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial })
      }
      if (script.error) return finish("error", script.error)
      finish(script.toolCalls?.length ? "toolUse" : "stop")
    })()
    return stream
  }
  return { streamFn, calls }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

const spec = (overrides: Partial<PiRuntimeSpec> = {}): PiRuntimeSpec => ({
  runtimeId: "api:qwen:qwen3.8-flash",
  provider: "qwen",
  model: "qwen3.8-flash",
  label: "Qwen 3.8 Flash",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKey: "test-key-not-real",
  reasoning: true,
  contextWindow: 131_072,
  maxOutputTokens: 8192,
  pricing: null,
  ...overrides,
})

const schema = { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }
const tool = (name: string): ChatToolSpec => ({ name, description: `${name} tool`, inputSchema: schema })

const input = (overrides: Partial<TurnInput> = {}): TurnInput => ({
  sessionId: "sess-1",
  runtimeId: "api:qwen:qwen3.8-flash",
  thinkingEffort: "medium",
  messages: [
    { role: "system", content: "你是助手" },
    { role: "user", content: "上一问" },
    { role: "assistant", content: "上一答" },
    { role: "user", content: "你好" },
  ],
  turn: { userText: "你好", references: [] },
  tools: [],
  maxOutputTokens: 1024,
  execSession: null,
  ...overrides,
})

function fakeHost(options: { gates?: ModelCallGate[]; executeTool?: TurnHost["executeTool"] } = {}) {
  const events: DriverEvent[] = []
  const toolCalls: { name: string; input: unknown }[] = []
  let gateCalls = 0
  const host: TurnHost = {
    emit: (e) => { events.push(e) },
    beforeModelCall: () => {
      const gate = options.gates?.[gateCalls]
      gateCalls += 1
      return gate ?? { ok: true }
    },
    executeTool: options.executeTool ?? (async (name, toolInput) => {
      toolCalls.push({ name, input: toolInput })
      return { ok: true, outputSummary: `${name} ok`, output: { title: "事项 W1" } }
    }),
    requestPermission: async () => { throw new Error("drivers must not ask permission for platform tools") },
  }
  return { host, events, toolCalls, gateCalls: () => gateCalls }
}

const types = (events: DriverEvent[]) => events.map((e) => e.type)

// ── Tests ────────────────────────────────────────────────────────────────────────────────────────

describe("PiCloudDriver streaming", () => {
  it("maps thinking and text deltas, emits usage and completes", async () => {
    const { streamFn, calls } = fakeStream([{ thinking: ["想", "一想"], text: ["你", "好"], usage: { input: 40, output: 12 } }])
    const driver = new PiCloudDriver({ spec: spec(), streamFn })
    const { host, events } = fakeHost()
    const outcome = await driver.runTurn(input(), host, new AbortController().signal)

    expect(outcome).toEqual({ status: "completed" })
    expect(types(events)).toEqual(["reasoning_delta", "reasoning_delta", "text_delta", "text_delta", "usage"])
    expect(events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join("")).toBe("你好")
    expect(events.at(-1)).toMatchObject({ type: "usage", inputTokens: 40, outputTokens: 12, costCents: 0, model: "qwen3.8-flash" })
    expect(calls).toHaveLength(1)
    // System prompt is a leading role:"system" message, history and current turn follow, all timestamped.
    const sent = calls[0].messages
    expect(sent.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"])
    expect(sent[0]).toMatchObject({ role: "system", content: "你是助手" })
    expect(sent.every((m) => typeof m.timestamp === "number")).toBe(true)
    expect(calls[0].options).toMatchObject({ reasoning: "medium", apiKey: "test-key-not-real", maxTokens: 1024 })
  })

  it("thinking off passes reasoning undefined while model.reasoning stays true", async () => {
    const { streamFn, calls } = fakeStream([{ text: ["好"] }])
    const driver = new PiCloudDriver({ spec: spec(), streamFn })
    await driver.runTurn(input({ thinkingEffort: "off" }), fakeHost().host, new AbortController().signal)
    expect(calls[0].options?.reasoning).toBeUndefined()
    expect(calls[0].model.reasoning).toBe(true)
    expect(piReasoningFor("high", true)).toBe("high")
    expect(piReasoningFor("high", false)).toBeUndefined()
  })
})

describe("PiCloudDriver tools", () => {
  it("runs a multi-round tool loop only through host.executeTool", async () => {
    const { streamFn, calls } = fakeStream([
      { toolCalls: [{ id: "call-1", name: "read_work_item", args: { id: "w1" } }], usage: { input: 10, output: 5 } },
      { toolCalls: [{ id: "call-2", name: "capture_intake", args: { id: "w2" } }], usage: { input: 20, output: 5 } },
      { text: ["已读取事项"], usage: { input: 30, output: 8 } },
    ])
    const driver = new PiCloudDriver({ spec: spec(), streamFn })
    const executed: { name: string; input: unknown }[] = []
    const { host, events, gateCalls } = fakeHost({
      executeTool: async (name, toolInput): Promise<ChatToolResult> => {
        executed.push({ name, input: toolInput })
        if (name === "capture_intake") return { ok: false, outputSummary: "收录失败", output: null, error: "rpc failed", stackTrace: "Error: rpc failed\n    at x" }
        return { ok: true, outputSummary: "读取到 1 个事项", output: { title: "事项 W1" } }
      },
    })
    const outcome = await driver.runTurn(input({ tools: [tool("read_work_item"), tool("capture_intake")] }), host, new AbortController().signal)

    expect(outcome.status).toBe("completed")
    expect(calls).toHaveLength(3)
    expect(gateCalls()).toBe(3)
    expect(executed).toEqual([{ name: "read_work_item", input: { id: "w1" } }, { name: "capture_intake", input: { id: "w2" } }])
    expect(types(events)).toEqual(["usage", "tool_start", "tool_end", "usage", "tool_start", "tool_end", "text_delta", "usage"])
    expect(events[1]).toEqual({ type: "tool_start", callId: "call-1", name: "read_work_item", inputSummary: '{"id":"w1"}' })
    expect(events[2]).toEqual({ type: "tool_end", callId: "call-1", status: "succeeded", outputSummary: "读取到 1 个事项" })
    expect(events[5]).toEqual({ type: "tool_end", callId: "call-2", status: "failed", outputSummary: "收录失败", error: "rpc failed", stackTrace: "Error: rpc failed\n    at x" })
    // The JSON Schema went through unchanged, folded into the leading system message.
    const system = calls[0].messages[0] as Extract<Message, { role: "system" }>
    expect(system.toolsAdded?.map((t) => t.name)).toEqual(["read_work_item", "capture_intake"])
    expect(system.toolsAdded?.[0].parameters).toEqual(schema)
    // The second request carries the tool result back to the model.
    const toolResult = calls[1].messages.find((m) => m.role === "toolResult")
    expect(toolResult).toMatchObject({ toolCallId: "call-1", isError: false, content: [{ type: "text", text: '{"title":"事项 W1"}' }] })
    expect(calls[2].messages.find((m) => m.role === "toolResult" && m.toolCallId === "call-2")).toMatchObject({ isError: true })
  })

  it("reports a tool call that never reached the host (invalid arguments) as failed", async () => {
    const { streamFn } = fakeStream([
      { toolCalls: [{ id: "call-1", name: "read_work_item", args: { nope: 1 } }] },
      { text: ["参数不对"] },
    ])
    const driver = new PiCloudDriver({ spec: spec(), streamFn })
    const { host, events, toolCalls } = fakeHost()
    const outcome = await driver.runTurn(input({ tools: [tool("read_work_item")] }), host, new AbortController().signal)
    expect(outcome.status).toBe("completed")
    expect(toolCalls).toEqual([])
    expect(events.find((e) => e.type === "tool_end")).toMatchObject({ callId: "call-1", status: "failed", error: expect.stringContaining("Validation failed") })
  })
})

describe("PiCloudDriver gates and failures", () => {
  it("stops at round 2 via finishTurn without issuing another request", async () => {
    const { streamFn, calls } = fakeStream([
      { toolCalls: [{ id: "call-1", name: "read_work_item", args: { id: "w1" } }], text: ["先查一下"] },
      { text: ["不应出现"] },
    ])
    const driver = new PiCloudDriver({ spec: spec(), streamFn })
    const { host, events, toolCalls } = fakeHost({
      gates: [{ ok: true }, { ok: false, code: "max_rounds", message: "本轮已达模型调用轮次上限（1 轮）" }],
    })
    const outcome = await driver.runTurn(input({ tools: [tool("read_work_item")] }), host, new AbortController().signal)
    expect(outcome).toEqual({ status: "error", error: { code: "max_rounds", message: "本轮已达模型调用轮次上限（1 轮）", retryable: false } })
    expect(calls).toHaveLength(1)
    expect(toolCalls).toHaveLength(1)
    expect(events.some((e) => e.type === "text_delta" && e.delta === "不应出现")).toBe(false)
  })

  it("does not call the model when the first gate fails", async () => {
    const { streamFn, calls } = fakeStream([{ text: ["x"] }])
    const driver = new PiCloudDriver({ spec: spec(), streamFn })
    const { host } = fakeHost({ gates: [{ ok: false, code: "budget_exceeded", message: "超预算" }] })
    const outcome = await driver.runTurn(input(), host, new AbortController().signal)
    expect(outcome).toMatchObject({ status: "error", error: { code: "budget_exceeded" } })
    expect(calls).toHaveLength(0)
  })

  it("cancels mid-stream, keeps the partial text and still reports usage", async () => {
    const controller = new AbortController()
    const { streamFn, calls } = fakeStream([{ text: ["写到", "一半", "不应出现"], usage: { input: 5, output: 2 }, afterChunk: (i) => { if (i === 1) controller.abort() } }])
    const driver = new PiCloudDriver({ spec: spec(), streamFn })
    const { host, events } = fakeHost()
    const outcome = await driver.runTurn(input(), host, controller.signal)
    expect(outcome).toEqual({ status: "cancelled" })
    expect(calls).toHaveLength(1)
    expect(events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta).join("")).toBe("写到一半")
    expect(events.at(-1)).toMatchObject({ type: "usage", inputTokens: 5, outputTokens: 2 })
  })

  it("turns an upstream error into status error with a retryable classification", async () => {
    const { streamFn } = fakeStream([{ text: ["半"], error: "429 Too Many Requests (key sk-abcdefghijklmnop)" }])
    const driver = new PiCloudDriver({ spec: spec(), streamFn })
    const { host, events } = fakeHost()
    const outcome = await driver.runTurn(input(), host, new AbortController().signal)
    expect(outcome.status).toBe("error")
    expect(outcome.error).toMatchObject({ code: "rate_limited", retryable: true })
    expect(outcome.error?.message).not.toContain("sk-abcdefghijklmnop")
    expect(types(events)).toEqual(["text_delta", "usage"])

    expect(classifyProviderError("401 Incorrect API key provided")).toEqual({ code: "provider_error", retryable: false })
    expect(classifyProviderError("400 developer is not one of ['system', 'assistant']")).toEqual({ code: "provider_error", retryable: false })
    expect(classifyProviderError("503 Service Unavailable")).toEqual({ code: "provider_unavailable", retryable: true })
    expect(sanitizeProviderMessage("Bearer abcdefghijklmnop failed")).toBe("[REDACTED] failed")
  })

  it("turns a throwing streamFn into an error instead of hanging", async () => {
    const streamFn: StreamFn = () => { throw new Error("socket hang up") }
    const driver = new PiCloudDriver({ spec: spec(), streamFn })
    const outcome = await driver.runTurn(input(), fakeHost().host, new AbortController().signal)
    expect(outcome).toMatchObject({ status: "error", error: { code: "provider_unavailable", message: "socket hang up", retryable: true } })
  })
})

describe("PiCloudDriver cost and models", () => {
  it("computes costCents from per-model unit prices, 0 when unpriced", async () => {
    const usage = { input: 1000, output: 500, cacheRead: 1000, cacheWrite: 0 }
    expect(costCentsFor(usage, null)).toBe(0)
    expect(costCentsFor(usage, { inputCentsPer1k: 0.08, outputCentsPer1k: 0.2 })).toBeCloseTo(0.26, 6)

    const { streamFn } = fakeStream([{ text: ["好"], usage: { input: 2000, output: 1000 } }])
    const priced = new PiCloudDriver({ spec: spec({ pricing: { inputCentsPer1k: 0.5, outputCentsPer1k: 1 } }), streamFn })
    const { host, events } = fakeHost()
    await priced.runTurn(input(), host, new AbortController().signal)
    expect(events.find((e): e is UsageEvent => e.type === "usage")?.costCents).toBe(2)
  })

  it("gives DashScope endpoints the full explicit Qwen compat", () => {
    const qwen = buildPiModel(spec())
    expect(qwen.compat).toEqual({ thinkingFormat: "qwen", supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" })
    expect(qwen).toMatchObject({ api: "openai-completions", reasoning: true, contextWindow: 131_072, maxTokens: 8192, cost: { input: 0, output: 0 } })
    // Detected by host as well, whatever the provider key says.
    const gateway = buildPiModel(spec({ provider: "openai-compatible", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" }))
    expect(gateway.compat?.thinkingFormat).toBe("qwen")
    const deepseek = buildPiModel(spec({ provider: "deepseek", model: "deepseek-reasoner", baseUrl: "https://api.deepseek.com/v1" }))
    expect(deepseek.compat).toMatchObject({ thinkingFormat: "deepseek", supportsDeveloperRole: false })
    expect(buildPiModel(spec({ provider: "kimi", baseUrl: "https://api.moonshot.cn/v1" })).compat).toEqual({ supportsDeveloperRole: false })
    expect(buildPiModel(spec({ provider: "openai-compatible", baseUrl: "https://api.openai.com/v1" })).compat).toBeUndefined()
  })

  it("refuses an incomplete spec", () => {
    expect(() => new PiCloudDriver({ spec: spec({ apiKey: "" }) })).toThrow(/配置不完整/)
  })
})

describe("PiCloudDriver through runChatTurn", () => {
  it("runs one end-to-end turn with fake ports: tool, budget, usage, persistence", async () => {
    const { streamFn, calls } = fakeStream([
      { thinking: ["查事项"], toolCalls: [{ id: "call-1", name: "read_work_item", args: { id: "w1" } }], usage: { input: 1000, output: 100 } },
      { text: ["事项 W1 ", "已读取。"], usage: { input: 1200, output: 50 } },
    ])
    const driver = new PiCloudDriver({ spec: spec({ pricing: { inputCentsPer1k: 1, outputCentsPer1k: 2 } }), streamFn })
    const events: ChatStreamEvent[] = []
    const usage: UsageEvent[] = []
    const finished: Parameters<ChatTurnPorts["finish"]>[0][] = []
    const ports: ChatTurnPorts = {
      emit: (e) => { events.push(e) },
      recordUsage: async (u) => { usage.push(u) },
      executeTool: async () => ({ ok: true, outputSummary: "读取到事项 W1", output: { title: "W1" } }),
      awaitPermission: async () => "allow",
      finish: async (r) => { finished.push(r); return { assistantMessageId: "msg-a", seq: 2 } },
      newRequestId: () => "req-1",
    }
    const result = await runChatTurn(
      {
        jobId: "job-1",
        sessionId: "sess-1",
        userMessageId: "msg-u",
        seq: 1,
        nodeId: "node-1",
        driver,
        messages: input().messages,
        turn: { userText: "你好", references: [] },
        contextTruncated: false,
        tools: [tool("read_work_item")],
        thinkingEffort: "low",
        maxOutputTokens: 2048,
        execSession: null,
        budget: new TurnBudget({ budgetCents: 50, maxRounds: 4 }),
        signal: new AbortController().signal,
      },
      ports,
    )
    expect(result).toMatchObject({ status: "completed", assistantMessageId: "msg-a", rounds: 2 })
    expect(result.costCents).toBeCloseTo(1.2 + 1.3, 6)
    expect(calls).toHaveLength(2)
    expect(calls[0].options?.reasoning).toBe("low")
    expect(events[0]).toMatchObject({ type: "turn_start", runtime: "api:qwen:qwen3.8-flash" })
    expect(events.at(-1)).toEqual({ type: "done", assistantMessageId: "msg-a", seq: 2, status: "completed" })
    expect(usage).toHaveLength(2)
    expect(finished[0].content).toBe("事项 W1 已读取。")
    expect(finished[0].parts.map((p) => p.type)).toEqual(["reasoning", "tool_call", "text"])
    expect(finished[0].parts[1]).toMatchObject({ state: "succeeded", outputSummary: "读取到事项 W1" })
  })
})
