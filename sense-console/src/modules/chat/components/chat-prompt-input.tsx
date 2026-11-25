import { useMemo, useRef, useState } from "react"
import {
  AtSignIcon,
  FileTextIcon,
  FolderKanbanIcon,
  InboxIcon,
  SendIcon,
  SlashIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { parseCaptureInput } from "@/contracts/quick-capture"
import { cn } from "@/lib/utils"
import { ModelSelector } from "@/modules/chat/components/model-selector"
import { SLASH_COMMANDS } from "@/modules/chat/services/chat-commands-service"
import type {
  ChatContextRefPart,
  ContextRefOption,
  RuntimeEntry,
  RuntimeNodeCatalog,
  SlashCommandMeta,
  ThinkingEffort,
} from "@/modules/chat/types"

export interface ChatPromptInputProps {
  value: string
  onChange: (value: string) => void
  contextRefs: ChatContextRefPart[]
  onAddContextRef: (ref: ChatContextRefPart) => void
  onRemoveContextRef: (kind: ChatContextRefPart["kind"], id: string) => void
  referenceOptions: ContextRefOption[]
  catalog: RuntimeNodeCatalog[]
  selectedNodeId: string | null
  selectedRuntimeId: string | null
  thinkingEffort: ThinkingEffort
  onSelectRuntime: (node: RuntimeNodeCatalog, runtime: RuntimeEntry) => void
  onThinkingEffortChange: (effort: ThinkingEffort) => void
  isStreaming: boolean
  isStopping?: boolean
  disabled?: boolean
  onSubmit: () => void | Promise<void>
  onStop: () => void | Promise<void>
  onQuickCaptureUrl: (rawText: string) => void | Promise<void>
}

export function ChatPromptInput(props: ChatPromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [atDismissed, setAtDismissed] = useState(false)
  const [forceMenu, setForceMenu] = useState<"slash" | "at" | null>(null)

  const slashMatch = props.value.match(/^\/([a-zA-Z]*)$/)
  const atMatch = props.value.match(/(?:^|\s)@([^\s@]*)$/)

  const showSlashMenu =
    forceMenu === "slash" || (Boolean(slashMatch) && !slashDismissed && forceMenu !== "at")
  const showAtMenu =
    forceMenu === "at" ||
    (!showSlashMenu && Boolean(atMatch) && !atDismissed && forceMenu !== "slash")

  const slashQuery = (slashMatch?.[1] ?? "").toLowerCase()
  const filteredSlash = useMemo(
    () =>
      SLASH_COMMANDS.filter(
        (cmd) =>
          cmd.name.includes(slashQuery) ||
          cmd.label.toLowerCase().includes(slashQuery)
      ),
    [slashQuery]
  )

  const atQuery = (atMatch?.[1] ?? "").toLowerCase()
  const filteredRefs = useMemo(
    () =>
      props.referenceOptions.filter(
        (opt) =>
          !props.contextRefs.some((r) => r.kind === opt.kind && r.id === opt.id) &&
          (opt.label.toLowerCase().includes(atQuery) ||
            (opt.subtitle ?? "").toLowerCase().includes(atQuery))
      ),
    [atQuery, props.contextRefs, props.referenceOptions]
  )

  const detectedCapture = useMemo(() => parseCaptureInput(props.value), [props.value])
  const hasPastedUrl = detectedCapture.url !== null && !props.value.trim().startsWith("/")

  function handleTextChange(next: string) {
    props.onChange(next)
    setForceMenu(null)
    setSlashDismissed(false)
    setAtDismissed(false)
  }

  function applySlashCommand(meta: SlashCommandMeta) {
    const nextText = meta.needsArg ? `${meta.command} ` : meta.command
    props.onChange(nextText)
    setForceMenu(null)
    setSlashDismissed(true)
    textareaRef.current?.focus()
  }

  function applyContextRef(opt: ContextRefOption) {
    props.onAddContextRef({
      type: "context_ref",
      kind: opt.kind,
      id: opt.id,
      label: opt.label,
    })
    if (atMatch) {
      const stripped = props.value.replace(/(?:^|\s)@[^\s@]*$/, (full) =>
        full.startsWith("\n") ? "\n" : ""
      )
      props.onChange(stripped)
    }
    setForceMenu(null)
    setAtDismissed(true)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      setForceMenu(null)
      setSlashDismissed(true)
      setAtDismissed(true)
      return
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!props.isStreaming && props.value.trim() && !props.disabled) {
        void props.onSubmit()
      }
    }
  }

  const canSend =
    !props.isStreaming && !props.disabled && Boolean(props.value.trim())

  return (
    <div className="relative mx-auto w-full max-w-3xl space-y-2">
      {/* Slash Command Popover List */}
      {showSlashMenu && (
        <div
          role="listbox"
          aria-label="Slash 命令菜单"
          className="rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-md"
        >
          <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
            平台确定性指令（前端直调 RPC · 零 token）
          </div>
          {filteredSlash.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">没有匹配的指令</div>
          ) : (
            filteredSlash.map((cmd) => (
              <button
                key={cmd.name}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => applySlashCommand(cmd)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span className="flex items-center gap-2 font-medium">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-primary">
                    {cmd.command}
                  </code>
                  <span>{cmd.label}</span>
                </span>
                <span className="truncate text-muted-foreground">{cmd.description}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* @ Reference Popover List */}
      {showAtMenu && (
        <div
          role="listbox"
          aria-label="引用事项或稿件"
          className="max-h-56 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-md"
        >
          <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
            选择要挂载到本轮上下文的事项或稿件
          </div>
          {filteredRefs.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              暂无可引用的事项或稿件
            </div>
          ) : (
            filteredRefs.map((opt) => (
              <button
                key={`${opt.kind}:${opt.id}`}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => applyContextRef(opt)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {opt.kind === "work_item" ? (
                    <FolderKanbanIcon className="size-3.5 shrink-0 text-primary" />
                  ) : (
                    <FileTextIcon className="size-3.5 shrink-0 text-primary" />
                  )}
                  <span className="truncate font-medium">{opt.label}</span>
                </span>
                {opt.subtitle && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {opt.subtitle}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* Mounted Context Refs + URL Quick Chip */}
      {(props.contextRefs.length > 0 || hasPastedUrl) && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          {props.contextRefs.map((ref) => (
            <Badge
              key={`${ref.kind}:${ref.id}`}
              variant="secondary"
              className="gap-1.5 pr-1 text-xs"
            >
              {ref.kind === "work_item" ? (
                <FolderKanbanIcon className="size-3" />
              ) : (
                <FileTextIcon className="size-3" />
              )}
              <span className="max-w-48 truncate">{ref.label}</span>
              <button
                type="button"
                aria-label={`移除引用 ${ref.label}`}
                onClick={() => props.onRemoveContextRef(ref.kind, ref.id)}
                className="rounded-full p-0.5 hover:bg-background/60"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}

          {hasPastedUrl && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void props.onQuickCaptureUrl(props.value)}
              className="gap-1 rounded-full text-xs"
            >
              <InboxIcon className="size-3 text-primary" />
              一键收录到收件箱
            </Button>
          )}
        </div>
      )}

      {/* Input Group Container */}
      <InputGroup className="rounded-xl bg-card shadow-xs">
        <InputGroupTextarea
          ref={textareaRef}
          rows={2}
          value={props.value}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={props.disabled}
          placeholder="输入消息…（输入 / 调起平台指令，输入 @ 引用事项或稿件，Shift+Enter 换行）"
          aria-label="聊天消息输入框"
          className="min-h-14 px-3 py-2.5 text-sm"
        />

        <InputGroupAddon align="block-end" className="justify-between border-t px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <ModelSelector
              catalog={props.catalog}
              selectedNodeId={props.selectedNodeId}
              selectedRuntimeId={props.selectedRuntimeId}
              thinkingEffort={props.thinkingEffort}
              onSelectRuntime={props.onSelectRuntime}
              onThinkingEffortChange={props.onThinkingEffortChange}
              disabled={props.isStreaming || props.disabled}
            />

            <InputGroupButton
              type="button"
              aria-label="插入 Slash 命令"
              disabled={props.isStreaming || props.disabled}
              onClick={() =>
                setForceMenu((prev) => (prev === "slash" ? null : "slash"))
              }
              className={cn(showSlashMenu && "bg-muted text-foreground")}
            >
              <SlashIcon className="size-3.5" />
              指令
            </InputGroupButton>

            <InputGroupButton
              type="button"
              aria-label="引用事项或稿件"
              disabled={props.isStreaming || props.disabled}
              onClick={() =>
                setForceMenu((prev) => (prev === "at" ? null : "at"))
              }
              className={cn(showAtMenu && "bg-muted text-foreground")}
            >
              <AtSignIcon className="size-3.5" />
              引用
            </InputGroupButton>
          </div>

          {props.isStreaming ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={props.isStopping}
              onClick={() => void props.onStop()}
              className="gap-1.5"
            >
              <SquareIcon className="size-3.5 fill-current" />
              {props.isStopping ? "停止中…" : "停止"}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={!canSend}
              onClick={() => void props.onSubmit()}
              className="gap-1.5"
            >
              <SendIcon className="size-3.5" />
              发送
            </Button>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
