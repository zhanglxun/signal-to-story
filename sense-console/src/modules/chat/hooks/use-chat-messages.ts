import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChatSessionRepository } from "@/modules/chat/services/chat-session-service"
import type { ChatMessage } from "@/modules/chat/types"

const EMPTY_MESSAGES: ChatMessage[] = []
const EMPTY_VERSIONS: Record<string, number> = {}

export type MessageTimelineEntry =
  | {
      kind: "message"
      message: ChatMessage
    }
  | {
      kind: "assistant_versions"
      replyToMessageId: string
      versions: ChatMessage[]
    }

/**
 * Group multiple assistant replies that share the same `replyToMessageId` into one
 * collapsible version cluster (docs/modules/chat.md §2.3 & C6).
 */
export function groupMessageTimeline(messages: readonly ChatMessage[]): MessageTimelineEntry[] {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq)
  const versionsByParent = new Map<string, ChatMessage[]>()

  for (const m of ordered) {
    if (m.role === "assistant" && m.replyToMessageId) {
      const list = versionsByParent.get(m.replyToMessageId) ?? []
      list.push(m)
      versionsByParent.set(m.replyToMessageId, list)
    }
  }

  const emittedCluster = new Set<string>()
  const entries: MessageTimelineEntry[] = []

  for (const m of ordered) {
    if (m.role === "assistant" && m.replyToMessageId) {
      const group = versionsByParent.get(m.replyToMessageId) ?? [m]
      if (group.length > 1) {
        if (!emittedCluster.has(m.replyToMessageId)) {
          emittedCluster.add(m.replyToMessageId)
          entries.push({
            kind: "assistant_versions",
            replyToMessageId: m.replyToMessageId,
            versions: group,
          })
        }
        continue
      }
    }
    entries.push({ kind: "message", message: m })
  }

  return entries
}

export function useChatMessages(
  repository: ChatSessionRepository,
  sessionId: string | null
) {
  const [loadedState, setLoadedState] = useState<{
    sessionId: string | null
    messages: ChatMessage[]
    error: string | null
  }>({ sessionId: null, messages: [], error: null })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [versionState, setVersionState] = useState<{
    sessionId: string | null
    map: Record<string, number>
  }>({ sessionId: null, map: {} })
  const sessionIdRef = useRef<string | null>(sessionId)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    let active = true
    void repository
      .listMessages(sessionId)
      .then((rows) => {
        if (active) {
          setLoadedState({ sessionId, messages: rows, error: null })
        }
      })
      .catch((err) => {
        if (active) {
          setLoadedState({
            sessionId,
            messages: [],
            error: err instanceof Error ? err.message : "加载消息记录失败",
          })
        }
      })
    return () => {
      active = false
    }
  }, [repository, sessionId])

  const messages =
    sessionId && loadedState.sessionId === sessionId ? loadedState.messages : EMPTY_MESSAGES
  const error = sessionId && loadedState.sessionId === sessionId ? loadedState.error : null
  const isLoading = Boolean(sessionId) && (loadedState.sessionId !== sessionId || isRefreshing)
  const selectedVersions =
    versionState.sessionId === sessionId ? versionState.map : EMPTY_VERSIONS

  const setMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      const targetSessionId = sessionIdRef.current
      setLoadedState((prev) => {
        const base = prev.sessionId === targetSessionId ? prev.messages : EMPTY_MESSAGES
        const next = typeof updater === "function" ? updater(base) : updater
        return { sessionId: targetSessionId, messages: next, error: null }
      })
    },
    []
  )

  const refreshMessages = useCallback(async () => {
    const targetSessionId = sessionIdRef.current
    if (!targetSessionId) return
    setIsRefreshing(true)
    try {
      const rows = await repository.listMessages(targetSessionId)
      if (sessionIdRef.current === targetSessionId) {
        setLoadedState({ sessionId: targetSessionId, messages: rows, error: null })
      }
    } catch (err) {
      if (sessionIdRef.current === targetSessionId) {
        setLoadedState({
          sessionId: targetSessionId,
          messages: [],
          error: err instanceof Error ? err.message : "加载消息记录失败",
        })
      }
    } finally {
      setIsRefreshing(false)
    }
  }, [repository])

  const timeline = useMemo(() => groupMessageTimeline(messages), [messages])

  const selectVersion = useCallback((replyToMessageId: string, index: number) => {
    const targetSessionId = sessionIdRef.current
    setVersionState((prev) => {
      const currentMap = prev.sessionId === targetSessionId ? prev.map : EMPTY_VERSIONS
      return {
        sessionId: targetSessionId,
        map: { ...currentMap, [replyToMessageId]: index },
      }
    })
  }, [])

  const clearSelectedVersion = useCallback((replyToMessageId: string) => {
    const targetSessionId = sessionIdRef.current
    setVersionState((prev) => {
      if (prev.sessionId !== targetSessionId) return prev
      const rest = { ...prev.map }
      delete rest[replyToMessageId]
      return { sessionId: targetSessionId, map: rest }
    })
  }, [])

  return {
    messages,
    setMessages,
    timeline,
    selectedVersions,
    selectVersion,
    clearSelectedVersion,
    isLoading,
    error,
    refreshMessages,
  }
}
