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
import type { SourceCategory } from "@/contracts/source-category"
import { createSourceCategory, updateSourceCategory } from "@/services/source-category-service"

type SourceCategoryDialogProps = {
  organizationId: string
  category?: SourceCategory
  /** Only top-level categories may be a parent — enforced again in the DB trigger. */
  topLevelCategories: SourceCategory[]
  defaultParentId?: number | null
  trigger: ReactElement
}

function initialForm(category?: SourceCategory, defaultParentId?: number | null) {
  return {
    name: category?.name ?? "",
    parentId: category ? category.parentId : (defaultParentId ?? null),
    iconUrl: category?.iconUrl ?? "",
    sortOrder: category?.sortOrder ?? 0,
    isActive: category?.isActive ?? true,
    description: category?.description ?? "",
  }
}

export function SourceCategoryDialog({ organizationId, category, topLevelCategories, defaultParentId, trigger }: SourceCategoryDialogProps) {
  const queryClient = useQueryClient()
  const fieldPrefix = `source-category-${category?.id ?? "new"}-${useId()}`
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => initialForm(category, defaultParentId))
  const editing = Boolean(category)
  const parentOptions = topLevelCategories.filter((item) => item.id !== category?.id)

  const mutation = useMutation({
    mutationFn: () => editing
      ? updateSourceCategory({ id: category!.id, organizationId, ...form })
      : createSourceCategory({ organizationId, ...form }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["source-categories"] })
      setForm(initialForm(category, defaultParentId))
      setOpen(false)
      toast.success(editing ? "分类信息已更新。" : "分类已创建。")
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : editing ? "分类更新失败。" : "分类创建失败。"),
  })

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && mutation.isPending) return
    if (nextOpen) setForm(initialForm(category, defaultParentId))
    setOpen(nextOpen)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑分类" : "新建分类"}</DialogTitle>
            <DialogDescription>分类最多支持两层；上级分类只能选择顶级分类。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-name`}>分类名称</Label><Input id={`${fieldPrefix}-name`} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={36} required /></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-parent`}>上级分类</Label><NativeSelect id={`${fieldPrefix}-parent`} className="w-full" value={form.parentId === null ? "" : String(form.parentId)} onChange={(event) => setForm((current) => ({ ...current, parentId: event.target.value === "" ? null : Number(event.target.value) }))}><NativeSelectOption value="">无（顶级分类）</NativeSelectOption>{parentOptions.map((item) => <NativeSelectOption key={item.id} value={String(item.id)}>{item.name}</NativeSelectOption>)}</NativeSelect></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-sort`}>排序号</Label><Input id={`${fieldPrefix}-sort`} type="number" min={0} max={32767} value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-icon`}>图标地址</Label><Input id={`${fieldPrefix}-icon`} value={form.iconUrl} onChange={(event) => setForm((current) => ({ ...current, iconUrl: event.target.value }))} maxLength={128} placeholder="可选" /></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-status`}>状态</Label><NativeSelect id={`${fieldPrefix}-status`} className="w-full" value={form.isActive ? "active" : "disabled"} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.value === "active" }))}><NativeSelectOption value="active">启用</NativeSelectOption><NativeSelectOption value="disabled">禁用</NativeSelectOption></NativeSelect></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-description`}>描述</Label><Textarea id={`${fieldPrefix}-description`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={256} rows={3} /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={mutation.isPending}>取消</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "保存中…" : "保存"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
