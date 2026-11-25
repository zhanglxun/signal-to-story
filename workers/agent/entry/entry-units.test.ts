// Unit tests for the pieces of the chat HTTP entry that need no database (T3b).
import { EventEmitter } from "node:events"

import { describe, expect, it, vi } from "vitest"

import { CHAT_TOOL_BACKING, chatToolSpecs } from "../handlers/chat-tools"
import { autoTitle } from "../handlers/chat-turn"
import { assertSafeToolset, CHAT_TOOL_ALLOWLIST } from "../loop/chat/tools"
import { readHttpConfig } from "../config"
import { mapDbError } from "./errors"
import { isAllowedOrigin, parseRegenerateRequest, parseTurnRequest, UserRateLimiter } from "./http"
import { PermissionBroker } from "./permissions"
import { assertQueueJobTypes, SUPPORTED_JOB_TYPES } from "./queue"
import { acpCatalogEntries } from "./runtimes"
import { formatSseEvent, SSE_PING, type SseSink, SseWriter } from "./sse"

class FakeSink extends EventEmitter implements SseSink {
  chunks: string[] = []
  writableEnded = false
  destroyed = false
  failWrites = false
  write(chunk: string) {
    if (this.failWrites) throw new Error("EPIPE")
    this.chunks.push(chunk)
    return true
  }
  end() {
    this.writableEnded = true
  }
}

describe("SSE writer", () => {
  it("formats `event: <type>\\ndata: <one-line JSON>\\n\\n` without the type in data", () => {
    expect(formatSseEvent({ type: "text_delta", delta: "第一行\n第二行" })).toBe('event: text_delta\ndata: {"delta":"第一行\\n第二行"}\n\n')
    expect(formatSseEvent({ type: "done", assistantMessageId: "m", seq: 2, status: "completed" }).split("\n").filter(Boolean)).toHaveLength(2)
  })

  it("pings, swallows writes after a disconnect and notifies once", () => {
    vi.useFakeTimers()
    try {
      const sink = new FakeSink()
      const writer = new SseWriter(sink, { pingIntervalMs: 15_000 })
      const onDisconnect = vi.fn()
      writer.onDisconnect(onDisconnect)
      writer.send({ type: "text_delta", delta: "a" })
      vi.advanceTimersByTime(15_000)
      expect(sink.chunks).toEqual([formatSseEvent({ type: "text_delta", delta: "a" }), SSE_PING])
      sink.emit("close")
      sink.emit("close")
      expect(onDisconnect).toHaveBeenCalledTimes(1)
      expect(writer.isClosed).toBe(true)
      expect(() => writer.send({ type: "text_delta", delta: "b" })).not.toThrow()
      vi.advanceTimersByTime(60_000)
      expect(sink.chunks).toHaveLength(2)
      writer.end()
      expect(sink.writableEnded).toBe(false) // already gone, nothing to end
    } finally {
      vi.useRealTimers()
    }
  })

  it("a failing socket write marks the stream closed instead of throwing", () => {
    const sink = new FakeSink()
    const writer = new SseWriter(sink, { pingIntervalMs: 0 })
    const onDisconnect = vi.fn()
    writer.onDisconnect(onDisconnect)
    sink.failWrites = true
    expect(() => writer.send({ type: "text_delta", delta: "x" })).not.toThrow()
    expect(writer.isClosed).toBe(true)
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it("ending the stream ourselves is not a disconnect", () => {
    const sink = new FakeSink()
    const writer = new SseWriter(sink, { pingIntervalMs: 0 })
    const onDisconnect = vi.fn()
    writer.onDisconnect(onDisconnect)
    writer.end()
    sink.emit("close")
    expect(sink.writableEnded).toBe(true)
    expect(onDisconnect).not.toHaveBeenCalled()
  })
})

describe("database error mapping (next-phase.md T3b)", () => {
  it("maps the agreed SQLSTATEs", () => {
    expect(mapDbError({ message: "上一轮还在生成", code: "23505", hint: "turn_in_progress" })).toMatchObject({ code: "turn_in_progress", status: 409 })
    expect(mapDbError({ message: "dup", code: "23505" })).toMatchObject({ code: "internal_error", status: 500 })
    expect(mapDbError({ message: "没有调度 Agent 任务的权限", code: "42501" })).toMatchObject({ code: "forbidden", status: 403 })
    expect(mapDbError({ message: "会话已归档", code: "23514" })).toMatchObject({ code: "invalid_request", status: 422 })
    const internal = mapDbError({ message: "relation secret_table does not exist", code: "42P01" })
    expect(internal).toMatchObject({ code: "internal_error", status: 500 })
    expect(internal.message).not.toContain("secret_table")
  })
})

describe("request validation", () => {
  const id = "00000000-0000-4000-8000-000000000001"
  it("accepts a valid turn and regenerate body", () => {
    expect(parseTurnRequest({ session_id: id, content: "你好", runtime_id: "api:qwen:qwen3.8-flash", parts: [{ type: "context_ref", kind: "document", id, label: "@稿" }] }))
      .toMatchObject({ sessionId: id, thinkingEffort: "off", parts: [{ kind: "document", id }] })
    expect(parseRegenerateRequest({ session_id: id, user_message_id: id, runtime_id: "acp:opencode", thinking_effort: "high" })).toMatchObject({ userMessageId: id, thinkingEffort: "high" })
  })
  it("rejects malformed bodies with invalid_request", () => {
    for (const body of [null, [], { session_id: id, content: "x" }, { session_id: id, content: "x", runtime_id: "API:Q" }, { session_id: id, content: "x".repeat(200_001), runtime_id: "api:a:b" }]) {
      expect(() => parseTurnRequest(body)).toThrow(expect.objectContaining({ code: "invalid_request", status: 422 }))
    }
    expect(() => parseRegenerateRequest({ session_id: id, runtime_id: "api:a:b" })).toThrow(expect.objectContaining({ code: "invalid_request" }))
  })
  it("CORS allowlist: exact console origins plus localhost", () => {
    const allowed = ["https://story.example.test"]
    expect(isAllowedOrigin("https://story.example.test", allowed)).toBe(true)
    expect(isAllowedOrigin("http://localhost:5173", allowed)).toBe(true)
    expect(isAllowedOrigin("http://127.0.0.1:4173", allowed)).toBe(true)
    expect(isAllowedOrigin("https://story.example.test.evil.test", allowed)).toBe(false)
    expect(isAllowedOrigin("http://story.example.test", allowed)).toBe(false)
    expect(isAllowedOrigin("null", allowed)).toBe(false)
  })
  it("rate limiter: N per user per minute", () => {
    let t = 0
    const limiter = new UserRateLimiter(2, () => t)
    expect([limiter.take("u"), limiter.take("u"), limiter.take("u"), limiter.take("v")]).toEqual([true, true, false, true])
    t = 60_001
    expect(limiter.take("u")).toBe(true)
  })
})

describe("permission broker", () => {
  it("answers only for the same user; times out; denies on disconnect; rejects on abort", async () => {
    const broker = new PermissionBroker({ timeoutMs: 50 })
    const ctrl = new AbortController()
    const p1 = broker.wait("job", "r1", "u1", ctrl.signal)
    expect(broker.answer("job", "r1", "u2", "allow")).toBe("forbidden")
    expect(broker.answer("job", "nope", "u1", "allow")).toBe("not_found")
    expect(broker.answer("job", "r1", "u1", "allow")).toBe("answered")
    await expect(p1).resolves.toBe("allow")
    await expect(broker.wait("job", "r2", "u1", ctrl.signal)).resolves.toBe("timeout")
    const p3 = broker.wait("job", "r3", "u1", ctrl.signal)
    broker.denyJob("job")
    await expect(p3).resolves.toBe("deny")
    const p4 = broker.wait("job", "r4", "u1", ctrl.signal)
    ctrl.abort()
    await expect(p4).rejects.toThrow()
    expect(broker.size).toBe(0)
  })
})

describe("queue entry never claims chat_turn", () => {
  it("rejects chat_turn in any job type list", () => {
    expect(assertQueueJobTypes([...SUPPORTED_JOB_TYPES, "video_storyboard"])).toEqual(["content_draft", "video_storyboard"])
    expect(() => assertQueueJobTypes(["content_draft", "chat_turn"])).toThrow(/chat_turn/)
  })
})

describe("chat tools (chat.md 2.5)", () => {
  it("exactly the allowlist, each backed by one fixed RPC or RLS read, none that approves / publishes / deletes", () => {
    const specs = chatToolSpecs()
    expect(specs.map((s) => s.name)).toEqual([...CHAT_TOOL_ALLOWLIST])
    expect(() => assertSafeToolset(specs)).not.toThrow()
    expect(CHAT_TOOL_BACKING).toEqual({
      capture_intake: "rpc:record_intake_event",
      read_work_item: "select:work_items+content_documents",
      enqueue_content_draft: "rpc:enqueue_agent_job",
    })
    expect(Object.values(CHAT_TOOL_BACKING).join(" ")).not.toMatch(/approve|publish|delete|grant|revoke/i)
  })
  it("auto title is the first non-empty line, at most 30 characters", () => {
    expect(autoTitle("\n  帮我想个标题  \n第二行")).toBe("帮我想个标题")
    expect(autoTitle("长".repeat(40))).toBe(`${"长".repeat(30)}…`)
    expect(autoTitle("   ")).toBeNull()
  })
})

describe("HTTP config and ACP catalog entries", () => {
  it("HTTP entry is off without SENSE_HTTP_PORT and needs SENSE_NODE_ID with it", () => {
    expect(readHttpConfig({})).toBeNull()
    expect(() => readHttpConfig({ SENSE_HTTP_PORT: "8787" })).toThrow(/SENSE_NODE_ID/)
    expect(() => readHttpConfig({ SENSE_HTTP_PORT: "8787", SENSE_NODE_ID: "x" })).toThrow(/uuid/)
    expect(() => readHttpConfig({ SENSE_HTTP_PORT: "8787", SENSE_NODE_ID: "00000000-0000-4000-8000-000000000001", SENSE_HTTP_ALLOWED_ORIGINS: "https://a.test/path" })).toThrow(/不要带路径/)
    expect(readHttpConfig({ SENSE_HTTP_PORT: "8787", SENSE_NODE_ID: "00000000-0000-4000-8000-000000000001", SENSE_HTTP_ALLOWED_ORIGINS: "https://story.example.test/" }))
      .toMatchObject({ port: 8787, host: "127.0.0.1", allowedOrigins: ["https://story.example.test"], publicUrl: "http://localhost:8787", maxConcurrentTurnsPerUser: 2 })
  })
  it("ACP CLIs become acp:<key> catalog entries", () => {
    expect(acpCatalogEntries([{ cliKey: "opencode", command: "opencode", args: ["acp"], label: "OpenCode" }])).toEqual([
      { id: "acp:opencode", kind: "acp", provider: "opencode", model: "opencode", label: "OpenCode", capabilities: { streaming: true, reasoning: true, tools: false, sessions: true }, status: "unverified" },
    ])
  })
})
