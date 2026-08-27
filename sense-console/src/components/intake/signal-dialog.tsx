import { useId, useState, type FormEvent, type ReactElement } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

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
import { buildSourceCategoryTree, type SourceCategory } from "@/contracts/source-category"
import type { Signal } from "@/contracts/signal"
import { createSignal, updateSignal } from "@/services/signal-service"

type SignalDialogProps = {
  organizationId: string
  signal?: Signal
  categories: SourceCategory[]
  trigger: ReactElement
}

function initialForm(signal?: Signal, defaultCategoryId?: number) {
  return {
    categoryId: signal?.categoryId ?? defaultCategoryId ?? null,
    name: signal?.name ?? "",
    iconUrl: signal?.iconUrl ?? "",
    siteUrl: signal?.siteUrl ?? "",
    summary: signal?.summary ?? "",
    description: signal?.description ?? "",
    isOrganized: signal?.isOrganized ?? false,
  }
}

/** Flattens the two-level category tree into select options, indenting children. */
function useCategoryOptions(categories: SourceCategory[]) {
  return buildSourceCategoryTree(categories).flatMap((parent) => [
    { id: parent.id, label: parent.name },
    ...parent.children.map((child) => ({ id: child.id, label: `    ${child.name}` })),
  ])
}

export function SignalDialog({ organizationId, signal, categories, trigger }: SignalDialogProps) {
  const queryClient = useQueryClient()
  const fieldPrefix = `signal-${signal?.id ?? "new"}-${useId()}`
  const categoryOptions = useCategoryOptions(categories)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => initialForm(signal, categoryOptions[0]?.id))
  const editing = Boolean(signal)

  const mutation = useMutation({
    mutationFn: () => {
      if (form.categoryId === null) throw new Error("请先选择分类。")
      const payload = { ...form, categoryId: form.categoryId }
      return editing
        ? updateSignal({ id: signal!.id, organizationId, ...payload })
        : createSignal({ organizationId, ...payload })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["signals"] })
      setForm(initialForm(signal, categoryOptions[0]?.id))
      setOpen(false)
      toast.success(editing ? "信息已更新。" : "信息已登记。")
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : editing ? "信息更新失败。" : "信息登记失败。"),
  })

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && mutation.isPending) return
    if (nextOpen) setForm(initialForm(signal, categoryOptions[0]?.id))
    setOpen(nextOpen)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑待处理信息" : "登记待处理信息"}</DialogTitle>
            <DialogDescription>记录新捕获的线索、链接和摘录，验证或聚类之后再转成选题。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-name`}>名称</Label><Input id={`${fieldPrefix}-name`} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={120} required /></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-category`}>分类</Label><NativeSelect id={`${fieldPrefix}-category`} className="w-full" value={form.categoryId === null ? "" : String(form.categoryId)} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value === "" ? null : Number(event.target.value) }))} required><NativeSelectOption value="" disabled>请选择分类</NativeSelectOption>{categoryOptions.map((option) => <NativeSelectOption key={option.id} value={String(option.id)}>{option.label}</NativeSelectOption>)}</NativeSelect></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-status`}>状态</Label><NativeSelect id={`${fieldPrefix}-status`} className="w-full" value={form.isOrganized ? "organized" : "pending"} onChange={(event) => setForm((current) => ({ ...current, isOrganized: event.target.value === "organized" }))}><NativeSelectOption value="pending">未整理</NativeSelectOption><NativeSelectOption value="organized">已整理</NativeSelectOption></NativeSelect></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-site-url`}>来源链接</Label><Input id={`${fieldPrefix}-site-url`} type="url" value={form.siteUrl} onChange={(event) => setForm((current) => ({ ...current, siteUrl: event.target.value }))} maxLength={512} placeholder="https://…" /></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-icon`}>图标地址</Label><Input id={`${fieldPrefix}-icon`} value={form.iconUrl} onChange={(event) => setForm((current) => ({ ...current, iconUrl: event.target.value }))} maxLength={128} placeholder="可选" /></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-summary`}>摘要</Label><Textarea id={`${fieldPrefix}-summary`} value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} maxLength={1024} rows={3} /></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-description`}>备注</Label><Textarea id={`${fieldPrefix}-description`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={4000} rows={3} /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={mutation.isPending}>取消</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "保存中…" : "保存"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
