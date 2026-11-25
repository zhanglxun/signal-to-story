import { CheckIcon, FolderKanbanIcon, UnlinkIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ContextRefOption } from "@/modules/chat/types"

export interface WorkItemPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: ContextRefOption[]
  currentWorkItemId: string | null
  onSelect: (workItemId: string | null) => void | Promise<void>
}

export function WorkItemPickerDialog({
  open,
  onOpenChange,
  options,
  currentWorkItemId,
  onSelect,
}: WorkItemPickerDialogProps) {
  const workItems = options.filter((o) => o.kind === "work_item")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>绑定事项（work_item）</DialogTitle>
          <DialogDescription>
            关联后，本会话可一键执行 `/draft`、`/storyboard`，并在提问时挂载事项上下文。
          </DialogDescription>
        </DialogHeader>

        <Command className="rounded-lg border">
          <CommandInput placeholder="搜索事项标题…" />
          <CommandList>
            <CommandEmpty>暂无可选事项</CommandEmpty>
            <CommandGroup>
              {workItems.map((item) => {
                const selected = item.id === currentWorkItemId
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.subtitle ?? ""}`}
                    onSelect={() => {
                      void onSelect(item.id)
                      onOpenChange(false)
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderKanbanIcon className="size-4 shrink-0 text-primary" />
                      <span className="truncate text-xs font-medium">{item.label}</span>
                    </span>
                    {selected && <CheckIcon className="size-4 text-primary" />}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>

        <DialogFooter className="sm:justify-between">
          {currentWorkItemId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void onSelect(null)
                onOpenChange(false)
              }}
            >
              <UnlinkIcon className="size-3.5" />
              解除绑定
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
