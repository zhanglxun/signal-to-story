import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChatSessionRepository } from "@/modules/chat/services/chat-session-service"
import type { ChatRuntimeConfig, ChatSession } from "@/modules/chat/types"

const EMPTY_SESSIONS: ChatSession[] = []

export interface UseChatSessionsOptions {
  repository: ChatSessionRepository
  organizationId: string | null
  ownerId: string | null
}

function sortDesc(list: ChatSession[]): ChatSession[] {
  return [...list].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

export function useChatSessions({
  repository,
  organizationId,
  ownerId,
}: UseChatSessionsOptions) {
  const [state, setState] = useState<{
    loadedOrgId: string | null
    sessions: ChatSession[]
    activeSessionId: string | null
    error: string | null
  }>({
    loadedOrgId: null,
    sessions: [],
    activeSessionId: null,
    error: null,
  })
  const [searchQuery, setSearchQuery] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const orgIdRef = useRef<string | null>(organizationId)
  const showArchivedRef = useRef(showArchived)

  useEffect(() => {
    orgIdRef.current = organizationId
  }, [organizationId])

  useEffect(() => {
    showArchivedRef.current = showArchived
  }, [showArchived])

  useEffect(() => {
    if (!organizationId) return
    let active = true
    void repository
      .listSessions(organizationId)
      .then((list) => {
        if (!active) return
        const rows = sortDesc(list)
        setState((prev) => {
          const prevActive = prev.loadedOrgId === organizationId ? prev.activeSessionId : null
          const keep = prevActive && rows.some((s) => s.id === prevActive)
          const firstActive = rows.find((s) => !s.archivedAt)
          return {
            loadedOrgId: organizationId,
            sessions: rows,
            activeSessionId: keep ? prevActive : (firstActive?.id ?? rows[0]?.id ?? null),
            error: null,
          }
        })
      })
      .catch((err) => {
        if (!active) return
        setState({
          loadedOrgId: organizationId,
          sessions: [],
          activeSessionId: null,
          error: err instanceof Error ? err.message : "加载会话列表失败",
        })
      })
    return () => {
      active = false
    }
  }, [organizationId, repository])

  const isCurrentOrg = Boolean(organizationId && state.loadedOrgId === organizationId)
  const sessions = isCurrentOrg ? state.sessions : EMPTY_SESSIONS
  const activeSessionId = isCurrentOrg ? state.activeSessionId : null
  const error = isCurrentOrg ? state.error : null
  const isLoading = Boolean(organizationId) && (state.loadedOrgId !== organizationId || isRefreshing)

  const setActiveSessionId = useCallback(
    (idOrUpdater: string | null | ((prev: string | null) => string | null)) => {
      const targetOrgId = orgIdRef.current
      setState((prev) => {
        const currentActive = prev.loadedOrgId === targetOrgId ? prev.activeSessionId : null
        const nextActive =
          typeof idOrUpdater === "function" ? idOrUpdater(currentActive) : idOrUpdater
        return { ...prev, activeSessionId: nextActive }
      })
    },
    []
  )

  const refreshSessions = useCallback(async () => {
    const targetOrgId = orgIdRef.current
    if (!targetOrgId) return
    setIsRefreshing(true)
    try {
      const rows = sortDesc(await repository.listSessions(targetOrgId))
      if (orgIdRef.current === targetOrgId) {
        setState((prev) => {
          const prevActive = prev.loadedOrgId === targetOrgId ? prev.activeSessionId : null
          const keep = prevActive && rows.some((s) => s.id === prevActive)
          const firstActive = rows.find((s) => !s.archivedAt)
          return {
            loadedOrgId: targetOrgId,
            sessions: rows,
            activeSessionId: keep ? prevActive : (firstActive?.id ?? rows[0]?.id ?? null),
            error: null,
          }
        })
      }
    } catch (err) {
      if (orgIdRef.current === targetOrgId) {
        setState((prev) => ({
          ...prev,
          loadedOrgId: targetOrgId,
          error: err instanceof Error ? err.message : "加载会话列表失败",
        }))
      }
    } finally {
      setIsRefreshing(false)
    }
  }, [repository])

  const createNewSession = useCallback(
    async (overrides?: {
      title?: string
      workItemId?: string | null
      runtimeConfig?: ChatRuntimeConfig
    }) => {
      if (!organizationId || !ownerId) {
        throw new Error("当前组织或用户尚未就绪")
      }
      const created = await repository.createSession({
        organizationId,
        ownerId,
        title: overrides?.title ?? "",
        workItemId: overrides?.workItemId ?? null,
        runtimeConfig: overrides?.runtimeConfig,
      })
      setState((prev) => {
        const base = prev.loadedOrgId === organizationId ? prev.sessions : EMPTY_SESSIONS
        return {
          loadedOrgId: organizationId,
          sessions: sortDesc([created, ...base.filter((s) => s.id !== created.id)]),
          activeSessionId: created.id,
          error: null,
        }
      })
      return created
    },
    [organizationId, ownerId, repository]
  )

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) throw new Error("会话标题不能为空")
      const updated = await repository.updateSession(sessionId, { title: trimmed })
      setState((prev) => ({
        ...prev,
        sessions: sortDesc(prev.sessions.map((s) => (s.id === sessionId ? updated : s))),
      }))
      return updated
    },
    [repository]
  )

  const toggleArchiveSession = useCallback(
    async (sessionId: string, archived: boolean) => {
      const updated = await repository.updateSession(sessionId, {
        archivedAt: archived ? new Date().toISOString() : null,
      })
      setState((prev) => {
        const next = sortDesc(prev.sessions.map((s) => (s.id === sessionId ? updated : s)))
        let nextActive = prev.activeSessionId
        if (archived && prev.activeSessionId === sessionId && !showArchivedRef.current) {
          nextActive = next.find((s) => !s.archivedAt)?.id ?? null
        }
        return { ...prev, sessions: next, activeSessionId: nextActive }
      })
      return updated
    },
    [repository]
  )

  const removeSession = useCallback(
    async (sessionId: string) => {
      await repository.deleteSession(sessionId)
      setState((prev) => {
        const next = prev.sessions.filter((s) => s.id !== sessionId)
        let nextActive = prev.activeSessionId
        if (prev.activeSessionId === sessionId) {
          nextActive =
            next.find((s) => (showArchivedRef.current ? true : !s.archivedAt))?.id ?? null
        }
        return { ...prev, sessions: next, activeSessionId: nextActive }
      })
    },
    [repository]
  )

  const setSessionWorkItem = useCallback(
    async (sessionId: string, workItemId: string | null) => {
      const updated = await repository.updateSession(sessionId, { workItemId })
      setState((prev) => ({
        ...prev,
        sessions: sortDesc(prev.sessions.map((s) => (s.id === sessionId ? updated : s))),
      }))
      return updated
    },
    [repository]
  )

  const setSessionRuntimeConfig = useCallback(
    async (sessionId: string, runtimeConfig: ChatRuntimeConfig) => {
      const updated = await repository.updateSession(sessionId, { runtimeConfig })
      setState((prev) => ({
        ...prev,
        sessions: sortDesc(prev.sessions.map((s) => (s.id === sessionId ? updated : s))),
      }))
      return updated
    },
    [repository]
  )

  const clearIntoNewSession = useCallback(
    async (sourceSession?: ChatSession | null) => {
      return createNewSession({
        workItemId: sourceSession?.workItemId ?? null,
        runtimeConfig: sourceSession?.runtimeConfig,
      })
    },
    [createNewSession]
  )

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  )

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return sortDesc(
      sessions.filter((s) => {
        if (showArchived ? !s.archivedAt : Boolean(s.archivedAt)) return false
        if (!q) return true
        return (s.title || "新对话").toLowerCase().includes(q)
      })
    )
  }, [searchQuery, sessions, showArchived])

  return {
    sessions,
    filteredSessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    searchQuery,
    setSearchQuery,
    showArchived,
    setShowArchived,
    isLoading,
    error,
    refreshSessions,
    createNewSession,
    renameSession,
    toggleArchiveSession,
    removeSession,
    setSessionWorkItem,
    setSessionRuntimeConfig,
    clearIntoNewSession,
  }
}
