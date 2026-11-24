import { useState } from "react"
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CpuIcon,
  TerminalSquareIcon,
  WifiOffIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type {
  RuntimeEntry,
  RuntimeNodeCatalog,
  ThinkingEffort,
} from "@/modules/chat/types"

const THINKING_EFFORT_ITEMS: Array<{ value: ThinkingEffort; label: string }> = [
  { value: "off", label: "关闭思考" },
  { value: "low", label: "轻量思考" },
  { value: "medium", label: "标准思考" },
  { value: "high", label: "深度思考" },
]

function formatContextWindow(tokens?: number): string | null {
  if (!tokens) return null
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

function findSelectedRuntime(
  catalog: readonly RuntimeNodeCatalog[],
  selectedNodeId: string | null,
  selectedRuntimeId: string | null
): { node: RuntimeNodeCatalog; runtime: RuntimeEntry } | null {
  for (const node of catalog) {
    if (selectedNodeId && node.nodeId !== selectedNodeId) continue
    const rt = node.runtimes.find((r) => r.id === selectedRuntimeId)
    if (rt) return { node, runtime: rt }
  }
  return null
}

export interface ModelSelectorProps {
  catalog: RuntimeNodeCatalog[]
  selectedNodeId: string | null
  selectedRuntimeId: string | null
  thinkingEffort: ThinkingEffort
  onSelectRuntime: (node: RuntimeNodeCatalog, runtime: RuntimeEntry) => void
  onThinkingEffortChange: (effort: ThinkingEffort) => void
  disabled?: boolean
}

export function ModelSelector({
  catalog,
  selectedNodeId,
  selectedRuntimeId,
  thinkingEffort,
  onSelectRuntime,
  onThinkingEffortChange,
  disabled = false,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)

  const selected = findSelectedRuntime(catalog, selectedNodeId, selectedRuntimeId)

  const supportsReasoning = Boolean(selected?.runtime.capabilities.reasoning)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label="选择模型或本地 CLI"
              className="max-w-[260px] justify-between gap-1.5 text-xs"
            />
          }
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {selected?.runtime.kind === "acp" ||
            selected?.runtime.kind === "exec" ? (
              <TerminalSquareIcon className="size-3.5 shrink-0 text-primary" />
            ) : (
              <BotIcon className="size-3.5 shrink-0 text-primary" />
            )}
            <span className="truncate">
              {selected ? selected.runtime.label : "选择运行引擎"}
            </span>
          </span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>

        <PopoverContent align="start" className="w-80 p-0">
          <Command>
            <CommandInput placeholder="搜索云端模型或本地 CLI…" />
            <CommandList>
              <CommandEmpty>未找到匹配的运行时引擎</CommandEmpty>
              {catalog.map((node) => (
                <CommandGroup
                  key={node.nodeId}
                  heading={`${node.nodeName}${node.online ? "" : "（离线）"}`}
                >
                  {node.runtimes.map((runtime) => {
                    const isAvailable = node.online && runtime.status === "ready"
                    const isSelected =
                      selected?.node.nodeId === node.nodeId &&
                      selected?.runtime.id === runtime.id
                    const ctx = formatContextWindow(runtime.contextWindow)

                    return (
                      <CommandItem
                        key={`${node.nodeId}:${runtime.id}`}
                        value={`${node.nodeName} ${runtime.label} ${runtime.provider} ${runtime.model}`}
                        disabled={!isAvailable}
                        onSelect={() => {
                          if (!isAvailable) return
                          onSelectRuntime(node, runtime)
                          setOpen(false)
                        }}
                        className={cn(
                          "flex items-center justify-between gap-2",
                          !isAvailable && "cursor-not-allowed opacity-50"
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          {runtime.kind === "api" ? (
                            <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <TerminalSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium">
                              {runtime.label}
                            </div>
                            <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                              <span>{runtime.kind.toUpperCase()}</span>
                              {ctx && <span>· {ctx}</span>}
                              <span>· {runtime.priced ? "计费" : "本地/订阅"}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          {!node.online ? (
                            <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px]">
                              <WifiOffIcon className="size-2.5" />
                              离线
                            </Badge>
                          ) : runtime.status !== "ready" ? (
                            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                              未就绪
                            </Badge>
                          ) : isSelected ? (
                            <CheckIcon className="size-3.5 text-primary" />
                          ) : null}
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {supportsReasoning && (
        <Select
          value={thinkingEffort}
          items={THINKING_EFFORT_ITEMS}
          onValueChange={(val) => {
            if (val) onThinkingEffortChange(val as ThinkingEffort)
          }}
          disabled={disabled}
        >
          <SelectTrigger size="sm" aria-label="思考强度" className="h-7 gap-1 text-xs">
            <CpuIcon className="size-3 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {THINKING_EFFORT_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
