import { useEffect, useRef, useState } from "react"
import { CheckIcon, ChevronDownIcon, CopyIcon, TerminalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

export interface StackTraceBlockProps {
  stack?: string | null
  label?: string
  className?: string
}

export function StackTraceBlock({
  stack,
  label = "查看错误调用栈 (Stack Trace)",
  className,
}: StackTraceBlockProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (!stack || !stack.trim()) return null

  async function handleCopy() {
    if (!stack) return
    try {
      await navigator.clipboard?.writeText(stack)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setCopied(false)
      }, 1500)
    } catch {
      // Clipboard API may be unavailable in restricted contexts.
    }
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-xs", className)}
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
          <TerminalIcon className="size-3.5 text-destructive" />
          <span>{label}</span>
        </span>
        <ChevronDownIcon
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 space-y-2 border-t pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">调用栈详情</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-label="复制调用栈"
            onClick={() => void handleCopy()}
            className="h-6 gap-1 px-2 text-[11px]"
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            {copied ? "已复制" : "复制"}
          </Button>
        </div>
        <pre className="max-h-60 overflow-x-auto overflow-y-auto rounded-md border bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre text-foreground">
          {stack}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}
