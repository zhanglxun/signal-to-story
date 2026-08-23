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
import {
  assetTypeLabels,
  assetTypes,
  mediaTypeLabels,
  mediaTypes,
  type Asset,
  type AssetMediaType,
  type AssetType,
} from "@/contracts/asset"
import { createAsset, updateAsset } from "@/services/asset-service"

type AssetDialogProps = {
  organizationId: string
  asset?: Asset
  trigger: ReactElement
}

function initialForm(asset?: Asset) {
  return {
    name: asset?.name ?? "",
    assetType: asset?.assetType ?? "character" as AssetType,
    category: asset?.category ?? "general",
    mediaType: asset?.mediaType ?? "image" as AssetMediaType,
    cloudUrl: asset?.cloudUrl ?? "",
    localPath: "",
    thumbnailUrl: asset?.thumbnailUrl ?? "",
    description: asset?.description ?? "",
    isActive: asset?.isActive ?? true,
  }
}

export function AssetDialog({ organizationId, asset, trigger }: AssetDialogProps) {
  const queryClient = useQueryClient()
  const fieldPrefix = `asset-${asset?.id ?? "new"}-${useId()}`
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => initialForm(asset))
  const editing = Boolean(asset)

  const mutation = useMutation({
    mutationFn: () => editing
      ? updateAsset({ id: asset!.id, organizationId, ...form })
      : createAsset({ organizationId, ...form }),
    onSuccess: async (savedAsset) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["assets"] }),
        queryClient.invalidateQueries({ queryKey: ["asset", savedAsset.id] }),
      ])
      setForm(initialForm(asset))
      setOpen(false)
      toast.success(editing ? "资产信息已更新。" : "资产已登记。")
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : editing ? "资产更新失败。" : "资产登记失败。"),
  })

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && mutation.isPending) return
    if (nextOpen) setForm(initialForm(asset))
    setOpen(nextOpen)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑资产" : "登记资产"}</DialogTitle>
            <DialogDescription>{editing ? "修改资产元数据和文件地址，保存后列表与详情会同步刷新。" : "当前登记元数据和文件地址；原始图片、音频或视频不写入数据库。"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-name`}>资产名称</Label><Input id={`${fieldPrefix}-name`} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} maxLength={120} required /></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-type`}>资产类别</Label><NativeSelect id={`${fieldPrefix}-type`} className="w-full" value={form.assetType} onChange={(event) => setForm((current) => ({ ...current, assetType: event.target.value as AssetType }))}>{assetTypes.map((type) => <NativeSelectOption key={type} value={type}>{assetTypeLabels[type]}</NativeSelectOption>)}</NativeSelect></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-category`}>二级分类</Label><Input id={`${fieldPrefix}-category`} value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} maxLength={80} placeholder="例如：food、office" required /></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-media-type`}>媒介类型</Label><NativeSelect id={`${fieldPrefix}-media-type`} className="w-full" value={form.mediaType} onChange={(event) => setForm((current) => ({ ...current, mediaType: event.target.value as AssetMediaType }))}>{mediaTypes.map((type) => <NativeSelectOption key={type} value={type}>{mediaTypeLabels[type]}</NativeSelectOption>)}</NativeSelect></div>
            <div className="grid gap-2"><Label htmlFor={`${fieldPrefix}-status`}>状态</Label><NativeSelect id={`${fieldPrefix}-status`} className="w-full" value={form.isActive ? "active" : "disabled"} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.value === "active" }))}><NativeSelectOption value="active">启用</NativeSelectOption><NativeSelectOption value="disabled">停用</NativeSelectOption></NativeSelect></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-cloud-url`}>云端地址</Label><Input id={`${fieldPrefix}-cloud-url`} type="url" value={form.cloudUrl} onChange={(event) => setForm((current) => ({ ...current, cloudUrl: event.target.value }))} maxLength={2048} placeholder="https://…" /></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-local-path`}>{editing ? "替换本机路径" : "本机路径"}</Label><Input id={`${fieldPrefix}-local-path`} value={form.localPath} onChange={(event) => setForm((current) => ({ ...current, localPath: event.target.value }))} maxLength={2048} placeholder="/authorized/assets/…" /><p className="text-xs text-muted-foreground">{editing ? "出于安全原因，已有路径不会回填；留空表示保持原路径不变。" : "只登记给受控 Agent/Worker 使用，不会在 Web 列表或详情接口返回。"}</p></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-thumbnail-url`}>缩略图地址</Label><Input id={`${fieldPrefix}-thumbnail-url`} type="url" value={form.thumbnailUrl} onChange={(event) => setForm((current) => ({ ...current, thumbnailUrl: event.target.value }))} maxLength={2048} placeholder="可选；用于列表和网格预览" /></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor={`${fieldPrefix}-description`}>描述</Label><Textarea id={`${fieldPrefix}-description`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} maxLength={2000} rows={4} /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={mutation.isPending}>取消</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? (editing ? "保存中…" : "登记中…") : (editing ? "保存修改" : "保存资产")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
