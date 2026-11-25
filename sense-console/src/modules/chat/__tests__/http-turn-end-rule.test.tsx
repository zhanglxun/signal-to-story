import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "test-jwt" } }, error: null }) },
  }),
  isSupabaseConfigured: true,
}))

import { useChatTurn } from "@/modules/chat/hooks/use-chat-turn"
import { createMemoryChatSessionRepository } from "@/modules/chat/services/chat-session-service"
import { describePreStreamError } from "@/modules/chat/transport/errors"
import { createHttpChatTransport } from "@/modules/chat/transport/http-transport"
import { HttpTransportError } from "@/modules/chat/types"

const NODE = "11111111-1111-4111-8111-111111111111"
const TARGET = { endpointHint: "http://node.test:4310/", nodeId: NODE }
const JOB = "22222222-2222-4222-8222-222222222222"
const USER_MSG = "33333333-3333-4333-8333-333333333333"

function sse(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

const TURN_START = sse("turn_start", { jobId: JOB, userMessageId: USER_MSG, seq: 1, nodeId: NODE, runtime: "api:qwen:x" })

/** A controllable SSE body: push frames, then close or error it. */
function sseBody() {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    stream,
    push: (frame: string) => controller.enqueue(encoder.encode(frame)),
    close: () => controller.close(),
    fail: () => controller.error(new TypeError("network error")),
  }
}

interface FakeNode {
  fetch: ReturnType<typeof vi.fn>
  body: ReturnType<typeof sseBody>
  health: { ok: boolean; nodeId: string; reachable: boolean }
  preStream: { status: number; code: string; message: string } | null
}

function fakeNode(): FakeNode {
  const node: FakeNode = {
    body: sseBody(),
    health: { ok: true, nodeId: NODE, reachable: true },
    preStream: null,
    fetch: vi.fn(),
  }
  node.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/health")) {
      if (!node.health.reachable) throw new TypeError("Failed to fetch")
      return new Response(JSON.stringify({ protocol_version: 1, node_id: node.health.nodeId }), {
        status: node.health.ok ? 200 : 500,
        headers: { "content-type": "application/json" },
      })
    }
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-jwt")
    if (node.preStream) {
      return new Response(JSON.stringify({ code: node.preStream.code, message: node.preStream.message }), {
        status: node.preStream.status,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response(node.body.stream, { status: 200, headers: { "content-type": "text/event-stream" } })
  })
  return node
}

async function setup(node: FakeNode) {
  const store = createMemoryChatSessionRepository({ seed: false })
  const session = await store.createSession({ organizationId: "org-1", ownerId: "user-1" })
  const onTurnSettled = vi.fn()
  const onStreamInterrupted = vi.fn()
  const transport = createHttpChatTransport(node.fetch as unknown as typeof fetch)
  const hook = renderHook(() =>
    useChatTurn({ transport, repository: store, onTurnSettled, onStreamInterrupted })
  )
  let turn!: Promise<void>
  const send = () =>
    act(async () => {
      turn = hook.result.current.sendTurn({
        sessionId: session.id,
        content: "你好",
        target: TARGET,
        runtimeId: "api:qwen:x",
        runtimeLabel: "Qwen",
      })
      await Promise.resolve()
    })
  const settle = () => act(async () => void (await turn))
  return { store, session, hook, send, settle, onTurnSettled, onStreamInterrupted }
}

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))))

describe("stream end rule (chat.md 2.4)", () => {
  let node: FakeNode
  beforeEach(() => {
    node = fakeNode()
  })

  it("posts to the selected node's http_endpoint_hint", async () => {
    const t = await setup(node)
    await t.send()
    node.body.push(TURN_START)
    node.body.push(sse("done", { assistantMessageId: "a1", seq: 2, status: "completed" }))
    node.body.close()
    await t.settle()
    const urls = node.fetch.mock.calls.map(([url]) => url)
    expect(urls).toEqual(["http://node.test:4310/v1/health", "http://node.test:4310/v1/chat/turns"])
  })

  it("treats error as non-terminal: keeps reading and finishes on done", async () => {
    const t = await setup(node)
    await t.send()
    node.body.push(TURN_START)
    node.body.push(sse("text_delta", { delta: "半截" }))
    node.body.push(sse("error", { code: "driver_failed", message: "上游断开", retryable: true }))
    await flush()

    // The error is shown, but the turn is still streaming until done arrives.
    expect(t.hook.result.current.activeTurn?.error?.code).toBe("driver_failed")
    expect(t.hook.result.current.isStreaming).toBe(true)
    expect(t.onTurnSettled).not.toHaveBeenCalled()

    node.body.push(sse("done", { assistantMessageId: "a1", seq: 2, status: "error" }))
    node.body.close()
    await t.settle()

    expect(t.onTurnSettled).toHaveBeenCalledTimes(1)
    // Persisted: the live turn gives way to the stored message (which carries the error part).
    expect(t.hook.result.current.activeTurn).toBeNull()
    expect(t.onStreamInterrupted).not.toHaveBeenCalled()
  })

  it("error then end of stream without done = persist failed, with a regenerate retry", async () => {
    const t = await setup(node)
    await t.send()
    node.body.push(TURN_START)
    node.body.push(sse("error", { code: "persist_failed", message: "写库失败", retryable: true }))
    node.body.close()
    await t.settle()

    const turn = t.hook.result.current.activeTurn
    expect(turn?.persistFailed).toBe(true)
    expect(turn?.isStreaming).toBe(false)
    expect(turn?.error).toMatchObject({ code: "persist_failed", retryable: true })
    expect(turn?.userMessageId).toBe(USER_MSG)
    expect(t.onTurnSettled).toHaveBeenCalledTimes(1)
  })

  it("a stream that breaks off without done or error waits for the persisted turn (no cancel)", async () => {
    const t = await setup(node)
    const cancel = vi.spyOn(t.store, "cancelJob")
    await t.send()
    node.body.push(TURN_START)
    node.body.push(sse("text_delta", { delta: "部分" }))
    await flush()
    node.body.fail()
    await t.settle()

    expect(t.onStreamInterrupted).toHaveBeenCalledWith({ sessionId: t.session.id, jobId: JOB, runtimeLabel: "Qwen" })
    expect(t.hook.result.current.activeTurn).toBeNull()
    expect(cancel).not.toHaveBeenCalled()
  })

  it("ignores : ping keep-alives", async () => {
    const t = await setup(node)
    await t.send()
    node.body.push(": ping\n\n")
    node.body.push(TURN_START)
    node.body.push(": ping\n\n")
    node.body.push(sse("text_delta", { delta: "好" }))
    await flush()
    expect(t.hook.result.current.activeTurn?.textContent).toBe("好")
    node.body.push(sse("done", { assistantMessageId: "a1", seq: 2, status: "completed" }))
    node.body.close()
    await t.settle()
    expect(t.hook.result.current.activeTurn).toBeNull()
  })

  it("stop calls cancel_agent_job before aborting the read", async () => {
    const t = await setup(node)
    const order: string[] = []
    vi.spyOn(t.store, "cancelJob").mockImplementation(async () => {
      order.push("cancel")
    })
    await t.send()
    node.body.push(TURN_START)
    await flush()
    const signal = (node.fetch.mock.calls[1][1] as RequestInit).signal!
    signal.addEventListener("abort", () => order.push("abort"))
    await act(async () => {
      await t.hook.result.current.stopTurn()
    })
    await t.settle()
    expect(order).toEqual(["cancel", "abort"])
  })
})

describe("health check before the first send", () => {
  it("shows 节点不可达 without posting the turn when the node cannot be reached", async () => {
    const node = fakeNode()
    node.health.reachable = false
    const t = await setup(node)
    await t.send()
    await t.settle()
    expect(node.fetch).toHaveBeenCalledTimes(1)
    const error = t.hook.result.current.activeTurn?.error
    expect(error?.code).toBe("node_unreachable")
    expect(error?.message).toContain("节点不可达")
    expect(error?.retryable).toBe(true)
  })

  it("refuses a node whose health reports a different node_id", async () => {
    const node = fakeNode()
    node.health.nodeId = "someone-else"
    const t = await setup(node)
    await t.send()
    await t.settle()
    expect(t.hook.result.current.activeTurn?.error?.code).toBe("node_mismatch")
    expect(node.fetch).toHaveBeenCalledTimes(1)
  })

  it("checks once and reuses the result for the next sends", async () => {
    const node = fakeNode()
    const t = await setup(node)
    for (let i = 0; i < 2; i++) {
      node.body = sseBody()
      await t.send()
      node.body.push(TURN_START)
      node.body.push(sse("done", { assistantMessageId: `a${i}`, seq: 2, status: "completed" }))
      node.body.close()
      await t.settle()
    }
    const healthCalls = node.fetch.mock.calls.filter(([url]) => String(url).endsWith("/v1/health"))
    expect(healthCalls).toHaveLength(1)
  })
})

describe("pre-stream HTTP errors", () => {
  it.each([
    [401, "unauthorized", "unauthorized", "登录状态已失效"],
    [403, "forbidden", "forbidden", "没有权限"],
    [409, "turn_in_progress", "turn_in_progress", "409 turn_in_progress"],
    [409, "claim_failed", "claim_failed", "409 claim_failed"],
    [422, "invalid_request", "invalid_request", "422 invalid_request"],
    [429, "rate_limited", "rate_limited", "429 rate_limited"],
    [503, "runtime_unavailable", "runtime_unavailable", "503 runtime_unavailable"],
    [404, "not_found", "not_found", "HTTP 404"],
    [405, "method_not_allowed", "method_not_allowed", "HTTP 405"],
    [500, "internal_error", "internal_error", "HTTP 500"],
  ])("HTTP %i %s → %s", async (status, code, expectedCode, text) => {
    const node = fakeNode()
    node.preStream = { status, code, message: "服务端说明" }
    const t = await setup(node)
    await t.send()
    await t.settle()
    const error = t.hook.result.current.activeTurn?.error
    expect(error?.code).toBe(expectedCode)
    expect(error?.message).toContain(text)
    expect(t.hook.result.current.isStreaming).toBe(false)
    expect(t.hook.result.current.activeTurn?.persistFailed).toBe(false)
  })

  it("401 asks the user to sign in again; retryable codes allow a retry", () => {
    expect(describePreStreamError(new HttpTransportError(401, "unauthorized", "x"))).toMatchObject({
      action: "relogin",
      retryable: false,
    })
    expect(describePreStreamError(new HttpTransportError(409, "claim_failed", "x")).retryable).toBe(true)
    expect(describePreStreamError(new HttpTransportError(409, "turn_in_progress", "x")).retryable).toBe(false)
    expect(describePreStreamError(new HttpTransportError(422, "invalid_request", "x")).retryable).toBe(false)
    expect(describePreStreamError(new HttpTransportError(429, "rate_limited", "x")).retryable).toBe(true)
    expect(describePreStreamError(new HttpTransportError(503, "runtime_unavailable", "x")).retryable).toBe(true)
    expect(describePreStreamError(new HttpTransportError(500, "internal_error", "x")).retryable).toBe(true)
    expect(describePreStreamError(new TypeError("Failed to fetch"))).toMatchObject({
      code: "node_unreachable",
      retryable: true,
    })
  })
})
