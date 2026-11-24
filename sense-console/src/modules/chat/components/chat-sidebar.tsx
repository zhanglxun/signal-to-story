import { useState } from "react"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { ChatSession } from "@/modules/chat/types"

export interface ChatSidebarProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  searchQuery: string
  onSearchChange: (value: string) => void
  showArchived: boolean
  onShowArchivedChange: (archived: boolean) => void
  onSelectSession: (sessionId: string) => void
  onCreateSession: () => void | Promise<unknown>
  onRenameSession: (sessionId: string, title: string) => Promise<unknown>
  onToggleArchive: (sessionId: string, archived: boolean) => Promise<unknown>
  onDeleteSession: (sessionId: string) => Promise<unknown>
  mobileOpen?: boolean
  onMobileOpenChange?: (open: boolean) => void
  compactH5?: boolean
}

function SidebarBody(
  props: Omit<ChatSidebarProps, "mobileOpen" | "onMobileOpenChange" | "compactH5"> & {
    onAfterSelect?: () => void
  }
) {
  const [renameTarget, setRenameTarget] = useState<ChatSession | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [isMutating, setIsMutating] = useState(false)

  function openRename(session: ChatSession) {
    setRenameTarget(session)
    setRenameTitle(session.title || "")
  }

  async function submitRename(e: React.FormEvent) {
    e.preventDefault()
    if (!renameTarget || !renameTitle.trim() || isMutating) return
    setIsMutating(true)
    try {
      await props.onRenameSession(renameTarget.id, renameTitle.trim())
      setRenameTarget(null)
    } finally {
      setIsMutating(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="space-y-2 border-b p-3">
        <Button
          type="button"
          className="w-full justify-start gap-2"
          onClick={() => {
            void props.onCreateSession()
            props.onAfterSelect?.()
          }}
        >
          <MessageSquarePlusIcon className="size-4" />
          新建对话
        </Button>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={props.searchQuery}
            onChange={(e) => props.onSearchChange(e.target.value)}
            placeholder="搜索会话标题…"
            aria-label="搜索会话标题"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5 text-xs">
          <button
            type="button"
            onClick={() => props.onShowArchivedChange(false)}
            className={cn(
              "rounded-md py-1 font-medium transition-colors",
              !props.showArchived
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            活跃会话
          </button>
          <button
            type="button"
            onClick={() => props.onShowArchivedChange(true)}
            className={cn(
              "rounded-md py-1 font-medium transition-colors",
              props.showArchived
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            已归档
          </button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2" role="list" aria-label="会话列表">
          {props.sessions.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              {props.showArchived ? "暂无已归档会话" : "暂无会话，点击上方「新建对话」开始"}
            </p>
          ) : (
            props.sessions.map((session) => {
              const active = session.id === props.activeSessionId
              const title = session.title.trim() || "新对话"
              return (
                <div
                  key={session.id}
                  role="listitem"
                  className={cn(
                    "group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted/70"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      props.onSelectSession(session.id)
                      props.onAfterSelect?.()
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-xs font-medium">{title}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>{new Date(session.updatedAt).toLocaleDateString()}</span>
                      {session.workItemId && (
                        <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                          已绑事项
                        </Badge>
                      )}
                    </div>
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`会话操作：${title}`}
                          className="shrink-0 opacity-70 hover:opacity-100"
                        />
                      }
                    >
                      <MoreHorizontalIcon className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openRename(session)}>
                        <PencilIcon className="size-3.5" />
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          void props.onToggleArchive(session.id, !session.archivedAt)
                        }
                      >
                        {session.archivedAt ? (
                          <>
                            <ArchiveRestoreIcon className="size-3.5" />
                            取消归档
                          </>
                        ) : (
                          <>
                            <ArchiveIcon className="size-3.5" />
                            归档会话
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void props.onDeleteSession(session.id)}
                      >
                        <Trash2Icon className="size-3.5" />
                        删除会话
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>修改会话在侧栏中的显示标题。</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void submitRename(e)} className="space-y-4">
            <Input
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              maxLength={200}
              placeholder="输入新标题"
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameTarget(null)}
              >
                取消
              </Button>
              <Button type="submit" disabled={!renameTitle.trim() || isMutating}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ChatSidebar({
  mobileOpen = false,
  onMobileOpenChange,
  compactH5 = false,
  ...rest
}: ChatSidebarProps) {
  return (
    <>
      {!compactH5 && (
        <aside
          aria-label="历史会话"
          className="hidden h-full w-64 shrink-0 border-r md:block"
        >
          <SidebarBody {...rest} />
        </aside>
      )}

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-72 p-0 sm:max-w-72">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-sm">会话列表</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <SidebarBody {...rest} onAfterSelect={() => onMobileOpenChange?.(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
