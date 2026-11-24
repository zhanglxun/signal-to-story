import { useState } from "react"
import {
  AlertTriangleIcon,
  BotIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderKanbanIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  SparklesIcon,
  UserIcon,
  XIcon,
} from "lucide-react"
import { Link } from "react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Spinner } from "@/components/ui/spinner"
import { renderSafeMarkdown } from "@/lib/safe-markdown"
import {
  type ActiveTurnState,
  formatErrorDisplayText,
} from "@/modules/chat/hooks/use-chat-turn"
import type { MessageTimelineEntry } from "@/modules/chat/hooks/use-chat-messages"
import type {
  ChatContextRefPart,
  ChatMessage,
  ChatMessagePart,
  SlashCardItem,
} from "@/modules/chat/types"

const QUICK_STARTER_PROMPTS: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: "整理灵感速记",
    prompt: "/capture https://story.susense.cn/demo 整理一篇关于 Agent Harness 内容生产的案例",
  },
  {
    label: "讨论选题切入角度",
    prompt: "请结合当前工作流原则，帮我梳理 3 个适合公众号与 X 的切入角度。",
  },
  {
    label: "演示权限确认卡",
    prompt: "请演示触发出稿审批权限确认卡片的流程。",
  },
]

function SafeMarkdownBlock({ text }: { text: string }) {
  const html = renderSafeMarkdown(text)
  return (
    <div
      className="console-prose text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function ReasoningCollapsible({
  text,
  streaming = false,
}: {
  text: string
  streaming?: boolean
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const open = manualOpen ?? streaming
  if (!text.trim()) return null

  return (
    <Collapsible
      open={open}
      onOpenChange={setManualOpen}
      className="rounded-lg border bg-muted/40 px-3 py-2 text-xs"
    >
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left font-medium text-muted-foreground hover:text-foreground"
          />
        }
      >
        <span className="flex items-center gap-1.5">
          <BrainIcon className="size-3.5 text-primary" />
          {streaming ? "正在思考…" : "思考过程"}
        </span>
        <ChevronDownIcon
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 border-t pt-2 whitespace-pre-wrap text-muted-foreground">
        {text}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ContextRefChips({ refs }: { refs: readonly ChatContextRefPart[] }) {
  if (refs.length === 0) return null
  return (
    <AttachmentGroup className="justify-end">
      {refs.map((ref) => (
        <Attachment key={`${ref.kind}:${ref.id}`} size="xs">
          <AttachmentMedia>
            {ref.kind === "work_item" ? (
              <FolderKanbanIcon className="size-3.5" />
            ) : (
              <FileTextIcon className="size-3.5" />
            )}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{ref.label}</AttachmentTitle>
          </AttachmentContent>
        </Attachment>
      ))}
    </AttachmentGroup>
  )
}

function PermissionPromptCard({
  requestId,
  action,
  summary,
  decision,
  onAnswer,
}: {
  requestId: string
  action: string
  summary: string
  decision?: "allow" | "deny"
  onAnswer?: (requestId: string, decision: "allow" | "deny") => void | Promise<void>
}) {
  const [submitting, setSubmitting] = useState(false)

  async function handle(choice: "allow" | "deny") {
    if (!onAnswer || submitting || decision) return
    setSubmitting(true)
    try {
      await onAnswer(requestId, choice)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Alert className="bg-card">
      <ShieldAlertIcon className="size-4" />
      <AlertTitle className="flex items-center gap-2 text-xs">
        <span>需要人类确认 · {action}</span>
        {decision && (
          <Badge variant={decision === "allow" ? "default" : "outline"} className="text-[10px]">
            {decision === "allow" ? "已允许" : "已拒绝"}
          </Badge>
        )}
      </AlertTitle>
      <AlertDescription className="mt-1 space-y-2 text-xs">
        <p>{summary}</p>
        {!decision && onAnswer && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="xs"
              disabled={submitting}
              onClick={() => void handle("allow")}
            >
              <CheckIcon className="size-3" />
              允许
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={submitting}
              onClick={() => void handle("deny")}
            >
              <XIcon className="size-3" />
              拒绝
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}

function extractPartText(parts: readonly ChatMessagePart[], fallback: string): string {
  const textParts = parts
    .filter((p): p is Extract<ChatMessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("")
  return textParts || fallback
}

function PersistedMessageRow({
  message,
  versionMeta,
  onRegenerate,
  disableRegenerate,
}: {
  message: ChatMessage
  versionMeta?: {
    current: number
    total: number
    onPrev: () => void
    onNext: () => void
  }
  onRegenerate?: (userMessageId: string) => void
  disableRegenerate?: boolean
}) {
  if (message.role === "user") {
    const contextRefs = message.parts.filter(
      (p): p is ChatContextRefPart => p.type === "context_ref"
    )
    return (
      <Message align="end">
        <MessageAvatar className="size-8">
          <UserIcon className="size-4 text-muted-foreground" />
        </MessageAvatar>
        <MessageContent className="items-end">
          <ContextRefChips refs={contextRefs} />
          <Bubble align="end" variant="default">
            <BubbleContent>
              <div className="whitespace-pre-wrap">{message.content}</div>
            </BubbleContent>
          </Bubble>
          <MessageFooter>
            <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
          </MessageFooter>
        </MessageContent>
      </Message>
    )
  }

  const reasoning = message.parts
    .filter((p): p is Extract<ChatMessagePart, { type: "reasoning" }> => p.type === "reasoning")
    .map((p) => p.text)
    .join("")
  const permissions = message.parts.filter(
    (p): p is Extract<ChatMessagePart, { type: "permission" }> => p.type === "permission"
  )
  const errorPart = message.parts.find(
    (p): p is Extract<ChatMessagePart, { type: "error" }> => p.type === "error"
  )
  const bodyText = extractPartText(message.parts, message.content)

  return (
    <Message align="start">
      <MessageAvatar className="size-8">
        <BotIcon className="size-4 text-primary" />
      </MessageAvatar>
      <MessageContent>
        <MessageHeader className="gap-2">
          <span>{message.runtimeLabel || "Agent"}</span>
          <span>·</span>
          <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
          {message.status === "cancelled" && (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              已停止
            </Badge>
          )}
          {message.status === "error" && (
            <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
              出错
            </Badge>
          )}
        </MessageHeader>

        <div className="max-w-[90%] space-y-2">
          <ReasoningCollapsible text={reasoning} />

          {bodyText && (
            <Bubble variant="outline" className="max-w-full">
              <BubbleContent className="w-full">
                <SafeMarkdownBlock text={bodyText} />
              </BubbleContent>
            </Bubble>
          )}

          {permissions.map((perm) => (
            <PermissionPromptCard
              key={perm.requestId}
              requestId={perm.requestId}
              action={perm.action}
              summary={perm.summary}
              decision={perm.decision}
            />
          ))}

          {(errorPart || message.status === "error") && (
            <Alert variant="destructive">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle className="text-xs">
                {errorPart?.code === "budget_exceeded" ? "费用预算超限" : "本轮执行未完成"}
              </AlertTitle>
              <AlertDescription className="text-xs">
                {formatErrorDisplayText(
                  errorPart?.code ?? "error",
                  errorPart?.message || message.content || "生成过程中发生错误"
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <MessageFooter className="gap-2">
          {versionMeta && versionMeta.total > 1 && (
            <div className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px]">
              <button
                type="button"
                aria-label="上一版本"
                disabled={versionMeta.current <= 0}
                onClick={versionMeta.onPrev}
                className="disabled:opacity-40"
              >
                <ChevronLeftIcon className="size-3" />
              </button>
              <span>
                版本 {versionMeta.current + 1} / {versionMeta.total}
              </span>
              <button
                type="button"
                aria-label="下一版本"
                disabled={versionMeta.current >= versionMeta.total - 1}
                onClick={versionMeta.onNext}
                className="disabled:opacity-40"
              >
                <ChevronRightIcon className="size-3" />
              </button>
            </div>
          )}

          {message.usage && (
            <span>
              {message.usage.inputTokens + message.usage.outputTokens} tokens ·{" "}
              {message.usage.durationMs} ms
            </span>
          )}

          {message.replyToMessageId && onRegenerate && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disableRegenerate}
              onClick={() => onRegenerate(message.replyToMessageId!)}
              className="h-6 px-2 text-xs"
            >
              <RotateCcwIcon className="size-3" />
              重新生成
            </Button>
          )}
        </MessageFooter>
      </MessageContent>
    </Message>
  )
}

export interface ChatMessageListProps {
  timeline: MessageTimelineEntry[]
  selectedVersions: Record<string, number>
  onSelectVersion: (replyToMessageId: string, index: number) => void
  activeTurn: ActiveTurnState | null
  slashCards: SlashCardItem[]
  isLoading: boolean
  onQuickPrompt: (prompt: string) => void
  onRegenerate: (userMessageId: string) => void
  onAnswerPermission: (requestId: string, decision: "allow" | "deny") => void | Promise<void>
}

export function ChatMessageList({
  timeline,
  selectedVersions,
  onSelectVersion,
  activeTurn,
  slashCards,
  isLoading,
  onQuickPrompt,
  onRegenerate,
  onAnswerPermission,
}: ChatMessageListProps) {
  const persistedActiveJobInTimeline =
    Boolean(activeTurn?.jobId) &&
    !activeTurn?.isStreaming &&
    timeline.some((entry) =>
      entry.kind === "message"
        ? entry.message.role === "assistant" && entry.message.agentJobId === activeTurn?.jobId
        : entry.versions.some((v) => v.agentJobId === activeTurn?.jobId)
    )
  const showActiveTurn = Boolean(activeTurn && !persistedActiveJobInTimeline)
  const isEmpty = timeline.length === 0 && !showActiveTurn && slashCards.length === 0

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport className="px-3 py-4 sm:px-6">
          <MessageScrollerContent className="mx-auto max-w-3xl gap-5">
            {isLoading && timeline.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
                <Spinner className="mr-2 size-4" />
                正在读取历史消息…
              </div>
            ) : isEmpty ? (
              <div className="py-10">
                <Empty className="border bg-card/50 py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SparklesIcon />
                    </EmptyMedia>
                    <EmptyTitle>星火智能对话与极简速记台</EmptyTitle>
                    <EmptyDescription>
                      支持多轮流式对话、输入 <code className="font-mono">/</code> 调用速记与后台任务、输入{" "}
                      <code className="font-mono">@</code> 挂载事项或稿件上下文。
                    </EmptyDescription>
                  </EmptyHeader>
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    {QUICK_STARTER_PROMPTS.map((item) => (
                      <Button
                        key={item.label}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onQuickPrompt(item.prompt)}
                        className="rounded-full text-xs"
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </Empty>
              </div>
            ) : (
              <>
                {timeline.map((entry) => {
                  if (entry.kind === "message") {
                    const m = entry.message
                    return (
                      <MessageScrollerItem key={m.id} messageId={m.id}>
                        <PersistedMessageRow
                          message={m}
                          onRegenerate={onRegenerate}
                          disableRegenerate={Boolean(activeTurn?.isStreaming)}
                        />
                      </MessageScrollerItem>
                    )
                  }

                  const total = entry.versions.length
                  const rawIndex = selectedVersions[entry.replyToMessageId] ?? total - 1
                  const index = Math.min(Math.max(rawIndex, 0), total - 1)
                  const currentMsg = entry.versions[index]
                  return (
                    <MessageScrollerItem
                      key={`cluster-${entry.replyToMessageId}`}
                      messageId={currentMsg.id}
                    >
                      <PersistedMessageRow
                        message={currentMsg}
                        versionMeta={{
                          current: index,
                          total,
                          onPrev: () => onSelectVersion(entry.replyToMessageId, index - 1),
                          onNext: () => onSelectVersion(entry.replyToMessageId, index + 1),
                        }}
                        onRegenerate={onRegenerate}
                        disableRegenerate={Boolean(activeTurn?.isStreaming)}
                      />
                    </MessageScrollerItem>
                  )
                })}

                {slashCards.map((card) => (
                  <MessageScrollerItem key={card.id} messageId={card.id}>
                    <Alert
                      variant={card.status === "failed" ? "destructive" : "default"}
                      className="bg-card"
                    >
                      <SparklesIcon className="size-4" />
                      <AlertTitle className="flex items-center gap-2 text-xs">
                        <span>{card.title}</span>
                        <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                          /{card.command} · 本地结果
                        </Badge>
                      </AlertTitle>
                      <AlertDescription className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span>{card.summary}</span>
                        {card.linkTo && (
                          <Link
                            to={card.linkTo}
                            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                          >
                            {card.linkLabel ?? "打开详情"}
                            <ExternalLinkIcon className="size-3" />
                          </Link>
                        )}
                      </AlertDescription>
                    </Alert>
                  </MessageScrollerItem>
                ))}

                {showActiveTurn && activeTurn && (
                  <MessageScrollerItem messageId="live-turn" scrollAnchor>
                    <div className="space-y-4">
                      {activeTurn.optimisticUserContent &&
                        !timeline.some(
                          (e) =>
                            e.kind === "message" &&
                            e.message.id === activeTurn.userMessageId
                        ) && (
                          <Message align="end">
                            <MessageAvatar className="size-8">
                              <UserIcon className="size-4 text-muted-foreground" />
                            </MessageAvatar>
                            <MessageContent className="items-end">
                              <ContextRefChips refs={activeTurn.optimisticUserParts} />
                              <Bubble align="end" variant="default">
                                <BubbleContent>
                                  <div className="whitespace-pre-wrap">
                                    {activeTurn.optimisticUserContent}
                                  </div>
                                </BubbleContent>
                              </Bubble>
                            </MessageContent>
                          </Message>
                        )}

                      <Message align="start">
                        <MessageAvatar className="size-8">
                          <BotIcon className="size-4 text-primary" />
                        </MessageAvatar>
                        <MessageContent>
                          <MessageHeader className="gap-2">
                            <span>{activeTurn.runtimeLabel}</span>
                            {activeTurn.isStreaming && (
                              <span className="inline-flex items-center gap-1 text-primary">
                                <Spinner className="size-3" />
                                生成中…
                              </span>
                            )}
                            {activeTurn.contextTruncated && (
                              <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                                上下文已按窗口截断
                              </Badge>
                            )}
                          </MessageHeader>

                          <div className="max-w-[90%] space-y-2">
                            <ReasoningCollapsible
                              text={activeTurn.reasoningText}
                              streaming={activeTurn.isStreaming && !activeTurn.textContent}
                            />

                            {activeTurn.textContent && (
                              <Bubble variant="outline" className="max-w-full">
                                <BubbleContent className="w-full">
                                  <SafeMarkdownBlock text={activeTurn.textContent} />
                                </BubbleContent>
                              </Bubble>
                            )}

                            {activeTurn.permissions.map((perm) => (
                              <PermissionPromptCard
                                key={perm.requestId}
                                requestId={perm.requestId}
                                action={perm.action}
                                summary={perm.summary}
                                decision={perm.decision}
                                onAnswer={onAnswerPermission}
                              />
                            ))}

                            {activeTurn.error && (
                              <Alert variant="destructive">
                                <AlertTriangleIcon className="size-4" />
                                <AlertTitle className="text-xs">
                                  {activeTurn.error.code === "budget_exceeded"
                                    ? "费用预算超限"
                                    : "生成失败"}
                                </AlertTitle>
                                <AlertDescription className="mt-1 space-y-2 text-xs">
                                  <p>
                                    {formatErrorDisplayText(
                                      activeTurn.error.code,
                                      activeTurn.error.message
                                    )}
                                  </p>
                                  {activeTurn.userMessageId && (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="outline"
                                      onClick={() => onRegenerate(activeTurn.userMessageId!)}
                                    >
                                      <RotateCcwIcon className="size-3" />
                                      重新生成
                                    </Button>
                                  )}
                                </AlertDescription>
                              </Alert>
                            )}
                          </div>
                        </MessageContent>
                      </Message>
                    </div>
                  </MessageScrollerItem>
                )}
              </>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
