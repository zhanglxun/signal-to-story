import { useQuery } from "@tanstack/react-query"
import { ExternalLink, FileIcon, PencilIcon } from "lucide-react"
import { useParams } from "react-router"

import { AssetDialog } from "@/components/assets/asset-dialog"
import { DetailLayout } from "@/components/detail-layout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { assetTypeLabels, mediaTypeLabels } from "@/contracts/asset"
import { getAsset, getAssetWorkspace } from "@/services/asset-service"

function isSafeWebUrl(value: string | null): value is string {
  if (!value) return false
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export function AssetDetailPage() {
  const { assetId } = useParams()
  const numericAssetId = Number(assetId)
  const query = useQuery({
    queryKey: ["asset", numericAssetId],
    queryFn: () => getAsset(numericAssetId),
    enabled: Number.isSafeInteger(numericAssetId) && numericAssetId > 0,
  })
  const workspaceQuery = useQuery({ queryKey: ["asset-workspace"], queryFn: getAssetWorkspace })

  if (!Number.isSafeInteger(numericAssetId) || numericAssetId <= 0) {
    return <Alert variant="destructive"><AlertTitle>资产编号无效</AlertTitle><AlertDescription>请返回资产库重新选择。</AlertDescription></Alert>
  }
  if (query.isLoading) return <p className="text-sm text-muted-foreground">正在加载资产详情…</p>
  if (query.isError) return <Alert variant="destructive"><AlertTitle>无法加载资产</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert>
  if (!query.data) return <Alert><AlertTitle>资产不存在</AlertTitle><AlertDescription>该资产可能不属于当前组织，或已经失效。</AlertDescription></Alert>

  const asset = query.data
  const webCloudUrl = isSafeWebUrl(asset.cloudUrl) ? asset.cloudUrl : null
  const thumbnailUrl = isSafeWebUrl(asset.thumbnailUrl) ? asset.thumbnailUrl : null
  const canManage = Boolean(workspaceQuery.data?.canManage)
  const actions = canManage || webCloudUrl ? <>
    {canManage && <AssetDialog organizationId={asset.organizationId} asset={asset} trigger={<Button variant="outline"><PencilIcon />编辑资产</Button>} />}
    {webCloudUrl && <Button render={<a href={webCloudUrl} target="_blank" rel="noreferrer" />}><ExternalLink />打开云端文件</Button>}
  </> : undefined

  return (
    <DetailLayout
      backTo="/assets"
      backLabel="返回资产库"
      eyebrow={`${assetTypeLabels[asset.assetType]} · #${asset.id}`}
      title={asset.name}
      status={asset.isActive ? "已启用" : "已停用"}
      description={asset.description || "暂无资产描述。"}
      actions={actions}
      facts={[
        { label: "资产类别", value: assetTypeLabels[asset.assetType] },
        { label: "二级分类", value: asset.category },
        { label: "媒介类型", value: mediaTypeLabels[asset.mediaType] },
        { label: "更新时间", value: new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(asset.updatedAt)) },
      ]}
    >
      <Card><CardContent><div className="flex aspect-video flex-col items-center justify-center overflow-hidden rounded-lg border bg-muted/50">{thumbnailUrl ? <img src={thumbnailUrl} alt={`${asset.name} 缩略图`} className="size-full object-contain" /> : <><FileIcon className="size-10 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{asset.name}</p><p className="mt-1 text-xs text-muted-foreground">尚未登记可用缩略图</p></>}</div></CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>存储信息</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex justify-between gap-4"><span className="text-muted-foreground">云端地址</span>{webCloudUrl ? <a href={webCloudUrl} target="_blank" rel="noreferrer" className="max-w-lg truncate text-primary hover:underline">{webCloudUrl}</a> : <span className="max-w-lg truncate">{asset.cloudUrl || "未登记"}</span>}</div><div className="flex justify-between"><span className="text-muted-foreground">本机资产</span><span>路径受保护，不在 Web 端返回</span></div><div className="flex justify-between"><span className="text-muted-foreground">创建时间</span><span>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(asset.createdAt))}</span></div></CardContent></Card>
    </DetailLayout>
  )
}
