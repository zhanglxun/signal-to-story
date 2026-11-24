import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { groupMessageTimeline } from "@/modules/chat/hooks/use-chat-messages"
import { formatErrorDisplayText, useChatTurn } from "@/modules/chat/hooks/use-chat-turn"
import { createMemoryChatSessionRepository } from "@/modules/chat/services/chat-session-service"
import { createMockChatTransport } from "@/modules/chat/transport/mock-transport"
import type { ChatTransport } from "@/modules/chat/transport/transport"
import type { ChatMessage } from "@/modules/chat/types"

const TARGET = { endpointHint: "https://mock.local", nodeId: "node-cloud-1" }

describe("useChatTurn", () => {
  it("concatenates reasoning and text deltas and settles into persisted messages", async () => {
    const store = createMemoryChatSessionRepository({ seed: false })
    const session = await store.createSession({
      organizationId: "org-1",
      ownerId: "user-1",
      title: "",
    })
    const transport = createMockChatTransport({ store, stepDelayMs: 1 })
    const onSettled = vi.fn()

    const { result } = renderHook(() =>
      useChatTurn({ transport, repository: store, onTurnSettled: onSettled })
    )

    await act(async () => {
      await result.current.sendTurn({
        sessionId: session.id,
        content: "请测试流式拼接",
        target: TARGET,
        runtimeId: "api:qwen:qwen3.8-flash",
        runtimeLabel: "Qwen 3.8 Flash",
        thinkingEffort: "low",
      })
    })

    expect(onSettled).toHaveBeenCalledWith(session.id)
    expect(result.current.isStreaming).toBe(false)

    const saved = await store.listMessages(session.id)
    expect(saved).toHaveLength(2)
    expect(saved[0].role).toBe("user")
    expect(saved[1].role).toBe("assistant")
    expect(saved[1].parts.some((p) => p.type === "reasoning")).toBe(true)
    expect(saved[1].content).toContain("回复摘要")
  })

  it("calls cancelJob only when user explicitly clicks stopTurn, NOT when hook unmounts", async () => {
    const store = createMemoryChatSessionRepository({ seed: false })
    const session = await store.createSession({
      organizationId: "org-1",
      ownerId: "user-1",
    })
    const cancelSpy = vi.spyOn(store, "cancelJob")

    // Case 1: unmount disconnects reader without cancelling backend job
    const transport1 = createMockChatTransport({ store, stepDelayMs: 15 })
    const hook1 = renderHook(() =>
      useChatTurn({ transport: transport1, repository: store })
    )

    act(() => {
      void hook1.result.current.sendTurn({
        sessionId: session.id,
        content: "长输出任务",
        target: TARGET,
        runtimeId: "api:qwen:qwen3.8-flash",
        runtimeLabel: "Qwen",
      })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    hook1.unmount()
    expect(cancelSpy).not.toHaveBeenCalled()

    // Wait for background mock turn to finish persisting naturally
    await vi.waitFor(async () => {
      const msgsAfterUnmount = await store.listMessages(session.id)
      expect(msgsAfterUnmount.at(-1)?.status).toBe("completed")
    })

    // Case 2: explicit stopTurn calls cancelJob and records cancelled status
    const transport2 = createMockChatTransport({ store, stepDelayMs: 25 })
    const onSettled2 = vi.fn()
    const hook2 = renderHook(() =>
      useChatTurn({ transport: transport2, repository: store, onTurnSettled: onSettled2 })
    )

    act(() => {
      void hook2.result.current.sendTurn({
        sessionId: session.id,
        content: "触发显式停止",
        target: TARGET,
        runtimeId: "api:qwen:qwen3.8-flash",
        runtimeLabel: "Qwen",
      })
    })
    await vi.waitFor(() => {
      expect(hook2.result.current.activeTurn?.jobId).toBeTruthy()
    })
    await act(async () => {
      await hook2.result.current.stopTurn()
    })

    expect(cancelSpy).toHaveBeenCalledTimes(1)
    const msgsAfterStop = await store.listMessages(session.id)
    expect(msgsAfterStop.at(-1)?.status).toBe("cancelled")
  })

  it("handles budget_exceeded error and 409 turn_in_progress", async () => {
    const store = createMemoryChatSessionRepository({ seed: false })
    const session = await store.createSession({
      organizationId: "org-1",
      ownerId: "user-1",
    })
    const transport = createMockChatTransport({ store, stepDelayMs: 1 })
    const { result } = renderHook(() =>
      useChatTurn({ transport, repository: store })
    )

    await act(async () => {
      await result.current.sendTurn({
        sessionId: session.id,
        content: "测试预算超限 budget",
        target: TARGET,
        runtimeId: "api:qwen:qwen3.8-flash",
        runtimeLabel: "Qwen",
      })
    })

    expect(result.current.activeTurn?.error?.code).toBe("budget_exceeded")
    expect(formatErrorDisplayText("budget_exceeded", "")).toContain("单轮费用已达上限")

    await act(async () => {
      await result.current.sendTurn({
        sessionId: session.id,
        content: "触发 409",
        target: TARGET,
        runtimeId: "api:qwen:qwen3.8-flash",
        runtimeLabel: "Qwen",
      })
    })
    expect(result.current.activeTurn?.error?.code).toBe("turn_in_progress")
    expect(result.current.activeTurn?.error?.message).toContain("409 turn_in_progress")
  })

  it("forwards permission_request decisions via answerPermission", async () => {
    const store = createMemoryChatSessionRepository({ seed: false })
    const session = await store.createSession({
      organizationId: "org-1",
      ownerId: "user-1",
    })
    const transport: ChatTransport = createMockChatTransport({ store, stepDelayMs: 1 })
    const { result } = renderHook(() =>
      useChatTurn({ transport, repository: store })
    )

    let turnPromise!: Promise<void>
    act(() => {
      turnPromise = result.current.sendTurn({
        sessionId: session.id,
        content: "请测试权限审批",
        target: TARGET,
        runtimeId: "api:qwen:qwen3.8-flash",
        runtimeLabel: "Qwen",
      })
    })

    await vi.waitFor(() => {
      expect(result.current.activeTurn?.permissions).toHaveLength(1)
    })

    const reqId = result.current.activeTurn!.permissions[0].requestId
    await act(async () => {
      await result.current.answerPermission(reqId, "allow")
      await turnPromise
    })

    const msgs = await store.listMessages(session.id)
    expect(msgs.at(-1)?.content).toContain("允许")
  })
})

describe("groupMessageTimeline", () => {
  it("groups regenerated assistant replies sharing replyToMessageId", () => {
    const base: Omit<ChatMessage, "id" | "seq" | "role" | "content" | "replyToMessageId"> = {
      organizationId: "o1",
      sessionId: "s1",
      parts: [],
      status: "completed",
      agentJobId: null,
      createdAt: "2026-11-24T00:00:00Z",
    }
    const entries = groupMessageTimeline([
      { ...base, id: "u1", seq: 1, role: "user", content: "hi", replyToMessageId: null },
      { ...base, id: "a1", seq: 2, role: "assistant", content: "v1", replyToMessageId: "u1" },
      { ...base, id: "a2", seq: 3, role: "assistant", content: "v2", replyToMessageId: "u1" },
    ])

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ kind: "message", message: { id: "u1" } })
    expect(entries[1]).toMatchObject({
      kind: "assistant_versions",
      replyToMessageId: "u1",
      versions: [{ id: "a1" }, { id: "a2" }],
    })
  })
})
