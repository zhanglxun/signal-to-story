import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  FolderKanbanIcon,
  MenuIcon,
  MonitorIcon,
  SmartphoneIcon,
  SparklesIcon,
} from "lucide-react"
import { Link, useSearchParams } from "react-router"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AuthContext } from "@/features/auth/auth-context"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { ChatMessageList } from "@/modules/chat/components/chat-message-list"
import { ChatPromptInput } from "@/modules/chat/components/chat-prompt-input"
import { ChatSidebar } from "@/modules/chat/components/chat-sidebar"
import { WorkItemPickerDialog } from "@/modules/chat/components/work-item-picker-dialog"
import { useChatMessages } from "@/modules/chat/hooks/use-chat-messages"
import { useChatSessions } from "@/modules/chat/hooks/use-chat-sessions"
import { useChatTurn } from "@/modules/chat/hooks/use-chat-turn"
import { usePendingTurn } from "@/modules/chat/hooks/use-pending-turn"
import {
  listReferenceOptions,
  parseSlashCommand,
  runCaptureSlashCommand,
  runDraftSlashCommand,
  runStoryboardSlashCommand,
} from "@/modules/chat/services/chat-commands-service"
import {
  type ChatSessionRepository,
  createMemoryChatSessionRepository,
  createSupabaseChatSessionRepository,
} from "@/modules/chat/services/chat-session-service"
import {
  findRuntimeTarget,
  listRuntimeCatalog,
  pickDefaultRuntime,
} from "@/modules/chat/services/runtime-catalog-service"
import { createHttpChatTransport } from "@/modules/chat/transport/http-transport"
import { createMockChatTransport } from "@/modules/chat/transport/mock-transport"
import { type ChatTransport, isMockChatMode } from "@/modules/chat/transport/transport"
import type {
  ChatContextRefPart,
  ChatRuntimeConfig,
  ContextRefOption,
  RuntimeEntry,
  RuntimeNodeCatalog,
  SlashCardItem,
  ThinkingEffort,
} from "@/modules/chat/types"

export interface ChatPageProps {
  mockMode?: boolean
  repository?: ChatSessionRepository
  transport?: ChatTransport
  catalogLoader?: (organizationId?: string | null) => Promise<RuntimeNodeCatalog[]>
  organizationId?: string
  ownerId?: string
  pendingPollIntervalMs?: number
  pendingMaxWaitMs?: number
}

export function ChatPage(props: ChatPageProps = {}) {
  const effectiveMockMode = props.mockMode ?? isMockChatMode()
  const auth = useContext(AuthContext)
  const [searchParams, setSearchParams] = useSearchParams()
  const isH5 = searchParams.get("h5") === "1"

  const [resolvedOrgId, setResolvedOrgId] = useState<string | null>(
    props.organizationId ?? (effectiveMockMode ? "mock-org-1" : null)
  )
  const effectiveOwnerId =
    props.ownerId ?? (effectiveMockMode ? "mock-user-1" : auth?.user?.id ?? null)

  // Stable repository + transport instances
  const [{ repository, transport }] = useState(() => {
    if (props.repository && props.transport) {
      return { repository: props.repository, transport: props.transport }
    }
    if (effectiveMockMode) {
      const store = createMemoryChatSessionRepository({ seed: true })
      return {
        repository: props.repository ?? store,
        transport: props.transport ?? createMockChatTransport({ store }),
      }
    }
    return {
      repository: props.repository ?? createSupabaseChatSessionRepository(),
      transport: props.transport ?? createHttpChatTransport(),
    }
  })

  useEffect(() => {
    if (props.organizationId || effectiveMockMode || !auth?.user) return
    let active = true
    void getContentWorkspace()
      .then((ws) => {
        if (active) setResolvedOrgId(ws.organization?.id ?? null)
      })
      .catch(() => {
        if (active) setResolvedOrgId(null)
      })
    return () => {
      active = false
    }
  }, [auth?.user, effectiveMockMode, props.organizationId])

  const [catalog, setCatalog] = useState<RuntimeNodeCatalog[]>([])
  const [referenceOptions, setReferenceOptions] = useState<ContextRefOption[]>([])

  useEffect(() => {
    let active = true
    const loadCatalog = props.catalogLoader ?? listRuntimeCatalog
    void loadCatalog(resolvedOrgId).then((nodes) => {
      if (active) setCatalog(nodes)
    })
    void listReferenceOptions(resolvedOrgId, effectiveMockMode)
      .then((opts) => {
        if (active) setReferenceOptions(opts)
      })
      .catch(() => {
        if (active) setReferenceOptions([])
      })
    return () => {
      active = false
    }
  }, [effectiveMockMode, props.catalogLoader, resolvedOrgId])

  const sessionState = useChatSessions({
    repository,
    organizationId: resolvedOrgId,
    ownerId: effectiveOwnerId,
  })
  const { activeSession, activeSessionId, refreshSessions } = sessionState

  const messageState = useChatMessages(repository, activeSessionId)
  const { refreshMessages } = messageState

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [workPickerOpen, setWorkPickerOpen] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [contextRefs, setContextRefs] = useState<ChatContextRefPart[]>([])
  const [slashCardsBySession, setSlashCardsBySession] = useState<
    Record<string, SlashCardItem[]>
  >({})

  // User's active runtime selection overrides (initialized from activeSession or default catalog)
  const [manualNodeId, setManualNodeId] = useState<string | null>(null)
  const [manualRuntimeId, setManualRuntimeId] = useState<string | null>(null)
  const [manualThinking, setManualThinking] = useState<ThinkingEffort>("low")

  const resolvedTarget = useMemo(() => {
    const config: ChatRuntimeConfig = manualRuntimeId
      ? {
          node_id: manualNodeId ?? undefined,
          runtime_id: manualRuntimeId,
          thinking_effort: manualThinking,
        }
      : activeSession?.runtimeConfig ?? {}
    return findRuntimeTarget(catalog, config) ?? pickDefaultRuntime(catalog)
  }, [activeSession?.runtimeConfig, catalog, manualNodeId, manualRuntimeId, manualThinking])

  const selectedNodeId = resolvedTarget?.node.nodeId ?? null
  const selectedRuntimeId = resolvedTarget?.runtime.id ?? null
  const thinkingEffort: ThinkingEffort =
    manualRuntimeId !== null
      ? manualThinking
      : activeSession?.runtimeConfig.thinking_effort ?? "low"

  const onTurnSettled = useCallback(
    async (sid: string) => {
      if (sid === activeSessionId) {
        await refreshMessages()
      }
      await refreshSessions()
    },
    [activeSessionId, refreshMessages, refreshSessions]
  )

  const stopHookRef = useRef<
    ((sessionId: string, jobId: string | null, runtimeLabel?: string) => void) | null
  >(null)

  const turnState = useChatTurn({
    transport,
    repository,
    onTurnSettled,
    onStopRequested: ({ sessionId, jobId, runtimeLabel }) => {
      stopHookRef.current?.(sessionId, jobId, runtimeLabel)
    },
  })

  const pendingTurnState = usePendingTurn({
    repository,
    sessionId: activeSessionId,
    messages: messageState.messages,
    isStreamingLocally: turnState.isStreaming,
    onSettled: onTurnSettled,
    pollIntervalMs: props.pendingPollIntervalMs,
    maxWaitMs: props.pendingMaxWaitMs,
  })

  useEffect(() => {
    stopHookRef.current = pendingTurnState.beginWaitingAfterStop
  }, [pendingTurnState.beginWaitingAfterStop])

  const isTurnBusy = turnState.isStreaming || Boolean(pendingTurnState.pendingTurn)

  const activeSlashCards = activeSessionId
    ? slashCardsBySession[activeSessionId] ?? []
    : slashCardsBySession["__unbound__"] ?? []

  const appendSlashCard = useCallback((sid: string | null, card: SlashCardItem) => {
    const key = sid ?? "__unbound__"
    setSlashCardsBySession((prev) => ({
      ...prev,
      [key]: [...(prev[key] ?? []), card],
    }))
  }, [])

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      if (turnState.isStreaming) {
        turnState.disconnectStream()
      }
      turnState.clearError()
      setManualNodeId(null)
      setManualRuntimeId(null)
      sessionState.setActiveSessionId(sessionId)
    },
    [sessionState, turnState]
  )

  const handleCreateSession = useCallback(async () => {
    if (turnState.isStreaming) {
      turnState.disconnectStream()
    }
    turnState.clearError()
    const created = await sessionState.createNewSession({
      runtimeConfig: resolvedTarget
        ? {
            node_id: resolvedTarget.node.nodeId,
            runtime_id: resolvedTarget.runtime.id,
            driver_kind: resolvedTarget.runtime.kind,
            model: resolvedTarget.runtime.model,
            thinking_effort: thinkingEffort,
          }
        : undefined,
    })
    setManualNodeId(null)
    setManualRuntimeId(null)
    return created
  }, [resolvedTarget, sessionState, thinkingEffort, turnState])

  const handleSelectRuntime = useCallback(
    (node: RuntimeNodeCatalog, runtime: RuntimeEntry) => {
      setManualNodeId(node.nodeId)
      setManualRuntimeId(runtime.id)
      const nextEffort: ThinkingEffort = runtime.capabilities.reasoning ? thinkingEffort : "off"
      setManualThinking(nextEffort)
      if (activeSessionId) {
        void sessionState
          .setSessionRuntimeConfig(activeSessionId, {
            node_id: node.nodeId,
            runtime_id: runtime.id,
            driver_kind: runtime.kind,
            model: runtime.model,
            thinking_effort: nextEffort,
          })
          .catch(() => undefined)
      }
    },
    [activeSessionId, sessionState, thinkingEffort]
  )

  const handleThinkingChange = useCallback(
    (effort: ThinkingEffort) => {
      setManualThinking(effort)
      if (!manualRuntimeId && resolvedTarget) {
        setManualNodeId(resolvedTarget.node.nodeId)
        setManualRuntimeId(resolvedTarget.runtime.id)
      }
      if (activeSessionId && resolvedTarget) {
        void sessionState
          .setSessionRuntimeConfig(activeSessionId, {
            node_id: resolvedTarget.node.nodeId,
            runtime_id: resolvedTarget.runtime.id,
            driver_kind: resolvedTarget.runtime.kind,
            model: resolvedTarget.runtime.model,
            thinking_effort: effort,
          })
          .catch(() => undefined)
      }
    },
    [activeSessionId, manualRuntimeId, resolvedTarget, sessionState]
  )

  const executePrompt = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim()
      if (!trimmed || isTurnBusy) return

      const slash = parseSlashCommand(trimmed)
      if (slash) {
        setInputValue("")
        if (slash.command === "clear") {
          turnState.clearError()
          const created = await sessionState.clearIntoNewSession(activeSession)
          setManualNodeId(null)
          setManualRuntimeId(null)
          setSlashCardsBySession((prev) => ({ ...prev, [created.id]: [] }))
          toast.success("已开启新会话（继承当前事项与引擎配置）")
          return
        }
        if (slash.command === "work") {
          if (!activeSessionId) {
            await handleCreateSession()
          }
          setWorkPickerOpen(true)
          return
        }
        if (slash.command === "capture") {
          try {
            const card = await runCaptureSlashCommand({
              rawInput: slash.args,
              organizationId: resolvedOrgId,
              mockMode: effectiveMockMode,
            })
            appendSlashCard(activeSessionId, card)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "速记执行失败")
          }
          return
        }
        if (slash.command === "draft") {
          const docRef = contextRefs.find((r) => r.kind === "document")
          try {
            const card = await runDraftSlashCommand({
              instruction: slash.args,
              workItemId: activeSession?.workItemId ?? null,
              documentId: docRef?.id ?? null,
              mockMode: effectiveMockMode,
            })
            appendSlashCard(activeSessionId, card)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "派发出稿失败")
          }
          return
        }
        if (slash.command === "storyboard") {
          try {
            const card = await runStoryboardSlashCommand({
              outline: slash.args,
              organizationId: resolvedOrgId,
              workItemId: activeSession?.workItemId ?? null,
              mockMode: effectiveMockMode,
            })
            appendSlashCard(activeSessionId, card)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "派发分镜失败")
          }
          return
        }
      }

      if (!resolvedTarget) {
        toast.error("当前没有可用的在线运行节点，请检查执行节点状态。")
        return
      }

      let sid = activeSessionId
      if (!sid) {
        const created = await handleCreateSession()
        sid = created.id
      }

      const refsToSend = [...contextRefs]
      setInputValue("")
      setContextRefs([])

      await turnState.sendTurn({
        sessionId: sid,
        content: trimmed,
        parts: refsToSend.length > 0 ? refsToSend : undefined,
        target: {
          endpointHint: resolvedTarget.node.httpEndpointHint,
          nodeId: resolvedTarget.node.nodeId,
        },
        runtimeId: resolvedTarget.runtime.id,
        runtimeLabel: resolvedTarget.runtime.label,
        thinkingEffort: resolvedTarget.runtime.capabilities.reasoning
          ? thinkingEffort
          : undefined,
      })
    },
    [
      activeSession,
      activeSessionId,
      appendSlashCard,
      contextRefs,
      effectiveMockMode,
      handleCreateSession,
      isTurnBusy,
      resolvedOrgId,
      resolvedTarget,
      sessionState,
      thinkingEffort,
      turnState,
    ]
  )

  const handleRegenerate = useCallback(
    async (userMessageId: string) => {
      if (!activeSessionId || !resolvedTarget || isTurnBusy) return
      messageState.clearSelectedVersion(userMessageId)
      await turnState.regenerateTurn({
        sessionId: activeSessionId,
        userMessageId,
        target: {
          endpointHint: resolvedTarget.node.httpEndpointHint,
          nodeId: resolvedTarget.node.nodeId,
        },
        runtimeId: resolvedTarget.runtime.id,
        runtimeLabel: resolvedTarget.runtime.label,
        thinkingEffort: resolvedTarget.runtime.capabilities.reasoning
          ? thinkingEffort
          : undefined,
      })
    },
    [activeSessionId, isTurnBusy, messageState, resolvedTarget, thinkingEffort, turnState]
  )

  const handleQuickCaptureUrl = useCallback(
    async (rawText: string) => {
      try {
        const card = await runCaptureSlashCommand({
          rawInput: rawText,
          organizationId: resolvedOrgId,
          mockMode: effectiveMockMode,
        })
        appendSlashCard(activeSessionId, card)
        setInputValue("")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "速记收录失败")
      }
    },
    [activeSessionId, appendSlashCard, effectiveMockMode, resolvedOrgId]
  )

  const activeWorkItemId = activeSession?.workItemId ?? null
  const boundWorkItemLabel = useMemo(() => {
    if (!activeWorkItemId) return null
    return (
      referenceOptions.find(
        (o) => o.kind === "work_item" && o.id === activeWorkItemId
      )?.label ?? activeWorkItemId
    )
  }, [activeWorkItemId, referenceOptions])

  return (
    <div
      className={
        isH5
          ? "mx-auto flex h-svh max-w-md flex-col border-x bg-background text-foreground"
          : "flex h-svh overflow-hidden bg-background text-foreground"
      }
    >
      <ChatSidebar
        sessions={sessionState.filteredSessions}
        activeSessionId={activeSessionId}
        searchQuery={sessionState.searchQuery}
        onSearchChange={sessionState.setSearchQuery}
        showArchived={sessionState.showArchived}
        onShowArchivedChange={sessionState.setShowArchived}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onRenameSession={sessionState.renameSession}
        onToggleArchive={sessionState.toggleArchiveSession}
        onDeleteSession={sessionState.removeSession}
        mobileOpen={mobileSidebarOpen}
        onMobileOpenChange={setMobileSidebarOpen}
        compactH5={isH5}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="打开会话列表"
              onClick={() => setMobileSidebarOpen(true)}
              className={isH5 ? "" : "md:hidden"}
            >
              <MenuIcon className="size-4" />
            </Button>

            <SparklesIcon className="size-4 shrink-0 text-primary" />
            <h1 className="truncate text-sm font-semibold">
              {activeSession?.title.trim() || "星火智能对话与速记"}
            </h1>

            <Badge variant={effectiveMockMode ? "secondary" : "default"} className="text-[11px]">
              {effectiveMockMode ? "Mock 假传输" : "HTTP/SSE 实时"}
            </Badge>

            {boundWorkItemLabel && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setWorkPickerOpen(true)}
                className="hidden max-w-52 gap-1 text-xs sm:inline-flex"
              >
                <FolderKanbanIcon className="size-3 shrink-0 text-primary" />
                <span className="truncate">{boundWorkItemLabel}</span>
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {!boundWorkItemLabel && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setWorkPickerOpen(true)}
                className="gap-1 text-xs"
              >
                <FolderKanbanIcon className="size-3" />
                绑定事项
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() =>
                setSearchParams(isH5 ? {} : { h5: "1" }, { replace: true })
              }
              className="gap-1 text-xs"
            >
              {isH5 ? (
                <>
                  <MonitorIcon className="size-3" />
                  桌面视图
                </>
              ) : (
                <>
                  <SmartphoneIcon className="size-3" />
                  H5 窄屏
                </>
              )}
            </Button>

            <Button
              nativeButton={false}
              variant="ghost"
              size="xs"
              render={<Link to="/dashboard" />}
              className="gap-1 text-xs"
            >
              <ArrowLeftIcon className="size-3" />
              工作台
            </Button>
          </div>
        </header>

        {(sessionState.error || messageState.error) && (
          <div className="px-4 pt-3">
            <Alert variant="destructive">
              <AlertDescription className="text-xs">
                {sessionState.error || messageState.error}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Message List */}
        <ChatMessageList
          timeline={messageState.timeline}
          selectedVersions={messageState.selectedVersions}
          onSelectVersion={messageState.selectVersion}
          activeTurn={
            turnState.activeTurn?.sessionId === activeSessionId
              ? turnState.activeTurn
              : null
          }
          pendingTurn={pendingTurnState.pendingTurn}
          slashCards={activeSlashCards}
          isLoading={messageState.isLoading}
          onQuickPrompt={(prompt) => void executePrompt(prompt)}
          onRegenerate={(userMsgId) => void handleRegenerate(userMsgId)}
          onAnswerPermission={turnState.answerPermission}
        />

        {/* Bottom Prompt Composer */}
        <footer className="shrink-0 border-t bg-background/95 p-3 sm:px-6 sm:py-4">
          <ChatPromptInput
            value={inputValue}
            onChange={setInputValue}
            contextRefs={contextRefs}
            onAddContextRef={(ref) =>
              setContextRefs((prev) =>
                prev.some((r) => r.kind === ref.kind && r.id === ref.id)
                  ? prev
                  : [...prev, ref]
              )
            }
            onRemoveContextRef={(kind, id) =>
              setContextRefs((prev) =>
                prev.filter((r) => !(r.kind === kind && r.id === id))
              )
            }
            referenceOptions={referenceOptions}
            catalog={catalog}
            selectedNodeId={selectedNodeId}
            selectedRuntimeId={selectedRuntimeId}
            thinkingEffort={thinkingEffort}
            onSelectRuntime={handleSelectRuntime}
            onThinkingEffortChange={handleThinkingChange}
            isStreaming={isTurnBusy}
            isStopping={Boolean(
              turnState.activeTurn?.isStopping ||
                pendingTurnState.pendingTurn?.reason === "stopping"
            )}
            disabled={!resolvedOrgId && !effectiveMockMode}
            onSubmit={() => void executePrompt(inputValue)}
            onStop={() => {
              if (turnState.isStreaming) {
                void turnState.stopTurn()
                return
              }
              const pending = pendingTurnState.pendingTurn
              if (pending?.jobId && pending.reason !== "stopping") {
                void repository
                  .cancelJob(pending.jobId)
                  .then(() => {
                    pendingTurnState.beginWaitingAfterStop(
                      pending.sessionId,
                      pending.jobId,
                      pending.runtimeLabel
                    )
                  })
                  .catch((err) => {
                    toast.error(err instanceof Error ? err.message : "停止生成失败")
                  })
              }
            }}
            onQuickCaptureUrl={handleQuickCaptureUrl}
          />
        </footer>
      </div>

      <WorkItemPickerDialog
        open={workPickerOpen}
        onOpenChange={setWorkPickerOpen}
        options={referenceOptions}
        currentWorkItemId={activeSession?.workItemId ?? null}
        onSelect={async (workItemId) => {
          if (!activeSessionId) {
            await sessionState.createNewSession({ workItemId })
            return
          }
          await sessionState.setSessionWorkItem(activeSessionId, workItemId)
          toast.success(workItemId ? "已关联事项到当前会话" : "已解除事项关联")
        }}
      />
    </div>
  )
}
