import { useState, type FormEvent, type ReactElement } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import type { DecisionMemoryKind } from "@/contracts/agent-harness"
import { decisionMemoryKindLabels, decisionMemoryKinds, memoryPlatformKeys, memoryPlatformLabels, type DecisionMemoryRecord } from "@/contracts/decision-memory"
import { createDecisionMemory, updateDecisionMemory } from "@/services/decision-memory-service"

function toDateInput(iso: string | null | undefined) {
  return iso ? iso.slice(0, 10) : ""
}
/** Expiry is end of the chosen day in the browser's time zone. */
function fromDateInput(value: string): string | null {
  if (!value) return null
  const date = new Date(`${value}T23:59:59`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function initial(memory?: DecisionMemoryRecord) {
  return {
    kind: (memory?.kind ?? "style_rule") as DecisionMemoryKind,
    summary: memory?.summary ?? "",
    humanQuote: memory?.humanQuote ?? "",
    platform: memory?.platform ?? "",
    expires: toDateInput(memory?.expiresAt),
  }
}

/** Create (no `memory`) or edit summary / expiry of a decision memory. Scope and kind are fixed after creation. */
export function DecisionMemoryDialog({ organizationId, memory, trigger }: { organizationId: string; memory?: DecisionMemoryRecord; trigger: ReactElement }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => initial(memory))
  const editing = Boolean(memory)

  const mutation = useMutation({
    mutationFn: () =>
      editing
        ? updateDecisionMemory(memory!.id, { summary: form.summary, humanQuote: form.humanQuote, expiresAt: fromDateInput(form.expires) })
        : createDecisionMemory({
            organizationId,
            kind: form.kind,
            summary: form.summary,
            humanQuote: form.humanQuote,
            platform: form.platform || null,
            expiresAt: fromDateInput(form.expires),
            source: "manual",
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["decision-memories"] })
      setOpen(false)
      toast.success(editing ? "决定记忆已更新。" : "决定记忆已添加。")
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存失败"),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setForm(initial(memory)); if (!mutation.isPending) setOpen(next) }}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑决定记忆" : "新增决定记忆"}</DialogTitle>
            <DialogDescription>启用中的记忆会在每次 Agent 出稿时作为人工决定注入系统指令区。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="memory-kind">类型</Label>
              <NativeSelect id="memory-kind" className="w-full" disabled={editing} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as DecisionMemoryKind }))}>
                {decisionMemoryKinds.map((k) => <option key={k} value={k}>{decisionMemoryKindLabels[k]}</option>)}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="memory-platform">适用范围</Label>
              <NativeSelect id="memory-platform" className="w-full" disabled={editing} value={form.platform} onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}>
                <option value="">全局（所有平台）</option>
                {memoryPlatformKeys.map((p) => <option key={p} value={p}>仅{memoryPlatformLabels[p]}</option>)}
              </NativeSelect>
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="memory-summary">摘要（Agent 看到的规则，最多 500 字）</Label>
              <Textarea id="memory-summary" required rows={3} maxLength={500} value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="memory-quote">人工原话（可选）</Label>
              <Textarea id="memory-quote" rows={2} maxLength={2000} value={form.humanQuote} onChange={(e) => setForm((f) => ({ ...f, humanQuote: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="memory-expires">过期日期（可选）</Label>
              <Input id="memory-expires" type="date" value={form.expires} onChange={(e) => setForm((f) => ({ ...f, expires: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>取消</Button>
            <Button type="submit" disabled={mutation.isPending || !form.summary.trim()}>{mutation.isPending ? "保存中…" : "保存"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
