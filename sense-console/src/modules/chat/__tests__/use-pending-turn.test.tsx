import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useChatMessages } from "@/modules/chat/hooks/use-chat-messages"
import { useChatTurn } from "@/modules/chat/hooks/use-chat-turn"
import { usePendingTurn } from "@/modules/chat/hooks/use-pending-turn"
import {
  type ChatSessionRepository,
  createMemoryChatSessionRepository,
} from "@/modules/chat/services/chat-session-service"
import { createMockChatTransport } from "@/modules/chat/transport/mock-transport"
import type { ChatMessage } from "@/modules/chat/types"

const TARGET = { endpointHint: "https://mock.local", nodeId: "node-cloud-1" }

describe("usePendingTurn", () => {
  it("shows stopping placeholder when worker persists asynchronously after stop and clears once landed", async () => {
    const store = createMemoryChatSessionRepository({ seed: false })
    const session = await store.createSession({
      organizationId: "org-1",
      ownerId: "user-1",
    })
    const transport = createMockChatTransport({
      store,
      stepDelayMs: 15,
      cancelPersistDelayMs: 70,
    })

    const { result } = renderHook(() => {
      const msgState = useChatMessages(store, session.id)
      const pending = usePendingTurn({
        repository: store,
        sessionId: session.id,
        messages: msgState.messages,
        isStreamingLocally: false,
        onSettled: async () => {
          await msgState.refreshMessages()
        },
        pollIntervalMs: 15,
        maxWaitMs: 2000,
      })
      const turn = useChatTurn({
        transport,
        repository: store,
        onTurnSettled: async () => {
          await msgState.refreshMessages()
        },
        onStopRequested: ({ sessionId, jobId, runtimeLabel }) => {
          pending.beginWaitingAfterStop(sessionId, jobId, runtimeLabel)
        },
      })
      return { msgState, pending, turn }
    })

    act(() => {
      void result.current.turn.sendTurn({
        sessionId: session.id,
        content: "延迟停止测试",
        target: TARGET,
        runtimeId: "api:qwen:qwen3.8-flash",
        runtimeLabel: "Qwen",
      })
    })

    await vi.waitFor(() => {
      expect(result.current.turn.activeTurn?.jobId).toBeTruthy()
    })

    const jobId = result.current.turn.activeTurn!.jobId!
    await act(async () => {
      await result.current.turn.stopTurn()
    })

    expect(result.current.turn.isStreaming).toBe(false)
    expect(result.current.pending.pendingTurn).toEqual({
      sessionId: session.id,
      jobId,
      reason: "stopping",
      runtimeLabel: "Qwen",
    })

    await vi.waitFor(async () => {
      expect(result.current.pending.pendingTurn).toBeNull()
      const msgs = await store.listMessages(session.id)
      expect(msgs.at(-1)?.status).toBe("cancelled")
    })
  })

  it("clears placeholder immediately when Realtime chat_messages insert arrives", async () => {
    let insertCb: (() => void) | null = null
    let messages: ChatMessage[] = [
      {
        id: "u-1",
        organizationId: "org-1",
        sessionId: "s-1",
        seq: 1,
        role: "user",
        content: "hi",
        parts: [],
        status: "completed",
        agentJobId: "job-rt-1",
        replyToMessageId: null,
        createdAt: "2026-11-24T10:00:00Z",
      },
    ]

    const repo: ChatSessionRepository = {
      listSessions: async () => [],
      createSession: async () => {
        throw new Error("unused")
      },
      updateSession: async () => {
        throw new Error("unused")
      },
      deleteSession: async () => undefined,
      listMessages: async () => messages,
      cancelJob: async () => undefined,
      findActiveChatTurnJob: async () => null,
      subscribeChatMessages: (_sid, onInsert) => {
        insertCb = onInsert
        return () => {
          insertCb = null
        }
      },
    }

    const onSettled = vi.fn()
    const { result } = renderHook(() =>
      usePendingTurn({
        repository: repo,
        sessionId: "s-1",
        messages,
        isStreamingLocally: false,
        onSettled,
        pollIntervalMs: 60_000,
        maxWaitMs: 60_000,
      })
    )

    act(() => {
      result.current.beginWaitingAfterStop("s-1", "job-rt-1", "Qwen")
    })
    expect(result.current.pendingTurn?.reason).toBe("stopping")

    messages = [
      ...messages,
      {
        id: "a-1",
        organizationId: "org-1",
        sessionId: "s-1",
        seq: 2,
        role: "assistant",
        content: "done",
        parts: [],
        status: "cancelled",
        agentJobId: "job-rt-1",
        replyToMessageId: "u-1",
        createdAt: "2026-11-24T10:00:01Z",
      },
    ]

    await act(async () => {
      insertCb?.()
    })

    await vi.waitFor(() => {
      expect(result.current.pendingTurn).toBeNull()
    })
    expect(onSettled).toHaveBeenCalledWith("s-1")
  })

  it("detects active queued/running chat_turn when entering a session and stops polling at maxWaitMs", async () => {
    const store = createMemoryChatSessionRepository({ seed: false })
    const session = await store.createSession({
      organizationId: "org-1",
      ownerId: "user-1",
    })
    store.setActiveChatTurnJob(session.id, { jobId: "job-remote-1", status: "running" })

    const { result, unmount } = renderHook(() =>
      usePendingTurn({
        repository: store,
        sessionId: session.id,
        messages: [],
        isStreamingLocally: false,
        pollIntervalMs: 15,
        maxWaitMs: 2000,
      })
    )

    await vi.waitFor(() => {
      expect(result.current.pendingTurn).toEqual({
        sessionId: session.id,
        jobId: "job-remote-1",
        reason: "running",
      })
    })

    const u = store.insertUserMessage({ sessionId: session.id, content: "q", agentJobId: "job-remote-1" })
    store.setActiveChatTurnJob(session.id, null)
    store.appendAssistantMessage({
      sessionId: session.id,
      content: "recovered",
      parts: [{ type: "text", text: "recovered" }],
      status: "completed",
      agentJobId: "job-remote-1",
      replyToMessageId: u.id,
    })

    await vi.waitFor(() => {
      expect(result.current.pendingTurn).toBeNull()
    })
    unmount()

    // Verify maxWaitMs timeout ceiling clears stuck placeholder
    const onSettledTimeout = vi.fn()
    store.setActiveChatTurnJob(session.id, { jobId: "job-stuck", status: "queued" })
    const stuckHook = renderHook(() =>
      usePendingTurn({
        repository: store,
        sessionId: session.id,
        messages: [],
        isStreamingLocally: false,
        onSettled: onSettledTimeout,
        pollIntervalMs: 1000,
        maxWaitMs: 120,
      })
    )

    await vi.waitFor(
      () => {
        expect(stuckHook.result.current.pendingTurn?.reason).toBe("queued")
      },
      { interval: 5 }
    )
    await vi.waitFor(() => {
      expect(stuckHook.result.current.pendingTurn).toBeNull()
    })
    expect(onSettledTimeout).toHaveBeenCalledWith(session.id)
  })
})
