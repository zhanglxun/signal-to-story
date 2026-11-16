import { useId, useState, type FormEvent, type ReactElement } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { useNavigate } from "react-router"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import {
  selectionPriorities,
  selectionPriorityLabels,
  type Selection,
  type SelectionPriority,
} from "@/contracts/selection"
import { createSelection, updateSelection } from "@/services/selection-service"

type SignalOption = { id: number; name: string }

type SelectionDialogProps = {
  organizationId: string
  selection?: Selection
  sourceSignal?: { id: number; name: string; summary: string | null }
  signalOptions: SignalOption[]
  trigger: ReactElement
}

function initialForm(selection?: Selection, defaultSignalId?: number) {
  return {
    signalId: selection?.signalId ?? defaultSignalId ?? null,
    name: selection?.name ?? "",
    coreThesis: selection?.coreThesis ?? "",
    angleType: selection?.angleType ?? "",
    contentFormat: selection?.contentFormat ?? "",
    negativePrompts: selection?.negativePrompts ?? "",
    outlineTemplate: selection?.outlineTemplate.length ? selection.outlineTemplate : [{ title: "" }],
    priority: selection?.priority ?? (2 as SelectionPriority),
    isCompleted: selection?.isCompleted ?? false,
    description: selection?.description ?? "",
  }
}

export function SelectionDialog({ organizationId, selection, signalOptions, sourceSignal, trigger }: SelectionDialogProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const initial = () => ({ ...initialForm(selection, sourceSignal?.id ?? signalOptions[0]?.id), ...(!selection && sourceSignal ? { name: sourceSignal.name.slice(0, 64), coreThesis: sourceSignal.summary ?? "" } : {}) })
  const fieldPrefix = `selection-${selection?.id ?? "new"}-${useId()}`
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(initial)
  const editing = Boolean(selection)

  const mutation = useMutation({
    mutationFn: () => {
      if (form.signalId === null) throw new Error("请先选择关联的待处理信息。")
      const payload = { ...form, signalId: form.signalId }
      return editing
        ? updateSelection({ id: selection!.id, organizationId, ...payload })
        : createSelection({ organizationId, ...payload })
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["selections"] }),
        queryClient.invalidateQueries({ queryKey: ["selection", saved.id] }),
      ])
      setForm(initial())
      setOpen(false)
      toast.success(editing ? "选题已更新。" : "选题已创建。")
      if (sourceSignal && !editing) navigate(`/topics/${saved.id}`)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : editing ? "选题更新失败。" : "选题创建失败。"),
  })

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && mutation.isPending) return
    if (nextOpen) setForm(initial())
    setOpen(nextOpen)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }

  const updateOutlineItem = (index: number, title: string) => {
    setForm((current) => ({
      ...current,
      outlineTemplate: current.outlineTemplate.map((item, itemIndex) => (itemIndex === index ? { title } : item)),
    }))
  }
  const addOutlineItem = () => setForm((current) => ({ ...current, outlineTemplate: [...current.outlineTemplate, { title: "" }] }))
  const removeOutlineItem = (index: number) => setForm((current) => ({
    ...current,
    outlineTemplate: current.outlineTemplate.filter((_, itemIndex) => itemIndex !== index),
  }))

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑选题" : "新建选题"}</DialogTitle>
            <DialogDescription>选题关联一条待处理信息，作为它的来源引用。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-name`}>标题 / 暂定选题名</Label><Input id={`${fieldPrefix}-name`} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={64} required /></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-signal`}>关联待处理信息</Label><NativeSelect id={`${fieldPrefix}-signal`} className="w-full" value={form.signalId === null ? "" : String(form.signalId)} onChange={(event) => setForm((current) => ({ ...current, signalId: event.target.value === "" ? null : Number(event.target.value) }))} required><NativeSelectOption value="" disabled>请选择</NativeSelectOption>{signalOptions.map((option) => <NativeSelectOption key={option.id} value={String(option.id)}>{option.name}</NativeSelectOption>)}</NativeSelect></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-thesis`}>核心论点 / 一句话立意</Label><Textarea id={`${fieldPrefix}-thesis`} value={form.coreThesis} onChange={(event) => setForm((current) => ({ ...current, coreThesis: event.target.value }))} maxLength={512} rows={2} /></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-angle`}>切入角度</Label><Input id={`${fieldPrefix}-angle`} value={form.angleType} onChange={(event) => setForm((current) => ({ ...current, angleType: event.target.value }))} maxLength={64} /></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-format`}>内容形式</Label><Input id={`${fieldPrefix}-format`} value={form.contentFormat} onChange={(event) => setForm((current) => ({ ...current, contentFormat: event.target.value }))} maxLength={64} /></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-priority`}>优先级</Label><NativeSelect id={`${fieldPrefix}-priority`} className="w-full" value={String(form.priority)} onChange={(event) => setForm((current) => ({ ...current, priority: Number(event.target.value) as SelectionPriority }))}>{selectionPriorities.map((priority) => <NativeSelectOption key={priority} value={String(priority)}>{selectionPriorityLabels[priority]}</NativeSelectOption>)}</NativeSelect></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-status`}>状态</Label><NativeSelect id={`${fieldPrefix}-status`} className="w-full" value={form.isCompleted ? "done" : "pending"} onChange={(event) => setForm((current) => ({ ...current, isCompleted: event.target.value === "done" }))}><NativeSelectOption value="pending">未完成</NativeSelectOption><NativeSelectOption value="done">已完成</NativeSelectOption></NativeSelect></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-negative`}>内容禁忌 / 负向约束</Label><Textarea id={`${fieldPrefix}-negative`} value={form.negativePrompts} onChange={(event) => setForm((current) => ({ ...current, negativePrompts: event.target.value }))} maxLength={4000} rows={2} /></div>
            <div className="grid gap-2 sm:col-span-2">
              <Label>预设结构大纲 / 章节模板</Label>
              <div className="space-y-2">
                {form.outlineTemplate.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input value={item.title} onChange={(event) => updateOutlineItem(index, event.target.value)} placeholder={`第 ${index + 1} 段标题`} maxLength={120} />
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="删除该段" onClick={() => removeOutlineItem(index)} disabled={form.outlineTemplate.length <= 1}><XIcon /></Button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addOutlineItem}><PlusIcon />添加一段</Button>
            </div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-description`}>描述</Label><Textarea id={`${fieldPrefix}-description`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={256} rows={2} /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={mutation.isPending}>取消</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "保存中…" : "保存"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
