import { useEffect, useState } from "react"
import { NotebookPenIcon } from "lucide-react"

import { QuickCaptureForm } from "@/components/quick-capture/quick-capture-form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { isQuickCaptureShortcut } from "@/contracts/quick-capture"

/** Header trigger + global Cmd/Ctrl+K shortcut for the quick capture dialog. */
export function QuickCaptureDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isQuickCaptureShortcut(event)) return
      event.preventDefault()
      setOpen((v) => !v)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      <Button variant="outline" size="sm" className="hidden w-56 justify-start text-muted-foreground lg:flex" onClick={() => setOpen(true)}>
        <NotebookPenIcon />
        <span>速记链接或想法...</span>
        <Kbd className="ml-auto">⌘ K</Kbd>
      </Button>
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="速记">
        <NotebookPenIcon />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>速记</DialogTitle>
            <DialogDescription>粘贴链接或写一句想法；可选择只收进选题池，或直接立项并让 Agent 出稿到待审。</DialogDescription>
          </DialogHeader>
          {open && <QuickCaptureForm autoFocus onNavigate={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
