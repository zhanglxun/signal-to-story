import { useDeferredValue, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BoxIcon,
  FileAudioIcon,
  FileIcon,
  FileImageIcon,
  FilmIcon,
  Grid2X2Icon,
  LibraryIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"
import { Link } from "react-router"

import { AssetDialog } from "@/components/assets/asset-dialog"
import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  assetTypeLabels,
  assetTypes,
  mediaTypeLabels,
  type Asset,
  type AssetMediaType,
  type AssetType,
} from "@/contracts/asset"
import { getAssets } from "@/services/asset-service"
import { getContentWorkspace } from "@/services/content-workspace-service"

const workspaceKey = ["content-workspace"] as const
const PAGE_SIZE = 12
type ViewMode = "list" | "grid"
type ActiveFilter = "all" | "active" | "disabled"

function isSafeWebUrl(value: string | null): value is string {
  if (!value) return false
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function AssetIcon({ mediaType, className = "size-5" }: { mediaType: AssetMediaType; className?: string }) {
  const Icon = mediaType === "audio"
    ? FileAudioIcon
    : mediaType === "video"
      ? FilmIcon
      : mediaType === "image"
        ? FileImageIcon
        : mediaType === "model"
          ? BoxIcon
          : FileIcon
  return <Icon className={className} />
}

function AssetPreview({ asset, compact = false }: { asset: Asset; compact?: boolean }) {
  const sizeClass = compact ? "size-10" : "aspect-video w-full"
  const thumbnailUrl = isSafeWebUrl(asset.thumbnailUrl) ? asset.thumbnailUrl : null
  return (
    <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50 ${sizeClass}`}>
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <AssetIcon mediaType={asset.mediaType} className={compact ? "size-5 text-muted-foreground" : "size-8 text-muted-foreground"} />
      )}
    </div>
  )
}

function AssetStatus({ active }: { active: boolean }) {
  return <Badge variant={active ? "default" : "outline"}>{active ? "已启用" : "已停用"}</Badge>
}

export function AssetsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("list")
  const [queryText, setQueryText] = useState("")
  const [assetType, setAssetType] = useState<"all" | AssetType>("all")
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all")
  const [page, setPage] = useState(1)
  const deferredQuery = useDeferredValue(queryText)
  const workspaceQuery = useQuery({ queryKey: workspaceKey, queryFn: getContentWorkspace })
  const organizationId = workspaceQuery.data?.organization?.id

  const changeQueryText = (value: string) => {
    setQueryText(value)
    setPage(1)
  }
  const changeAssetType = (value: "all" | AssetType) => {
    setAssetType(value)
    setPage(1)
  }
  const changeActiveFilter = (value: ActiveFilter) => {
    setActiveFilter(value)
    setPage(1)
  }

  const assetsQuery = useQuery({
    queryKey: ["assets", organizationId, assetType, activeFilter, deferredQuery, page],
    queryFn: () => getAssets({
      organizationId: organizationId!,
      assetType: assetType === "all" ? undefined : assetType,
      active: activeFilter === "all" ? undefined : activeFilter === "active",
      query: deferredQuery,
      page,
      pageSize: PAGE_SIZE,
    }),
    enabled: Boolean(organizationId),
  })

  if (workspaceQuery.isLoading) return <p className="text-sm text-muted-foreground">正在加载资产库…</p>
  if (workspaceQuery.isError) return <Alert variant="destructive"><AlertTitle>无法加载资产库</AlertTitle><AlertDescription>{workspaceQuery.error.message}</AlertDescription></Alert>
  if (!workspaceQuery.data?.organization) return <Alert><AlertTitle>账号尚未加入组织</AlertTitle><AlertDescription>请先完成组织和 Owner 初始化。</AlertDescription></Alert>

  const organization = workspaceQuery.data.organization
  const canManage = workspaceQuery.data.canManage
  const assets = assetsQuery.data?.assets ?? []
  const totalCount = assetsQuery.data?.totalCount ?? 0
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Creative library"
        title="资产库"
        description={`管理 ${organization.name} 的角色、场景、道具、音效与风格资产。数据库保存元数据，文件保留在对象存储或受控本机目录。`}
        actions={<div className="flex items-center gap-2">{canManage && <AssetDialog organizationId={organization.id} trigger={<Button><PlusIcon />登记资产</Button>} />}<div className="flex rounded-lg border p-1"><Button size="icon-sm" variant={viewMode === "list" ? "secondary" : "ghost"} aria-label="列表显示" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}><ListIcon /></Button><Button size="icon-sm" variant={viewMode === "grid" ? "secondary" : "ghost"} aria-label="网格显示" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}><Grid2X2Icon /></Button></div></div>}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1 lg:max-w-md"><SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={queryText} onChange={(event) => changeQueryText(event.target.value)} placeholder="搜索资产名称、二级分类或描述" /></div>
        <NativeSelect className="w-full sm:w-40" aria-label="资产类别" value={assetType} onChange={(event) => changeAssetType(event.target.value as "all" | AssetType)}><NativeSelectOption value="all">全部类别</NativeSelectOption>{assetTypes.map((type) => <NativeSelectOption key={type} value={type}>{assetTypeLabels[type]}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect className="w-full sm:w-36" aria-label="资产状态" value={activeFilter} onChange={(event) => changeActiveFilter(event.target.value as ActiveFilter)}><NativeSelectOption value="all">全部状态</NativeSelectOption><NativeSelectOption value="active">已启用</NativeSelectOption><NativeSelectOption value="disabled">已停用</NativeSelectOption></NativeSelect>
      </div>

      {assetsQuery.isError && <Alert variant="destructive"><AlertTitle>无法读取资产</AlertTitle><AlertDescription>{assetsQuery.error.message}</AlertDescription></Alert>}
      {assetsQuery.isLoading && <p className="text-sm text-muted-foreground">正在读取资产列表…</p>}

      {!assetsQuery.isLoading && !assetsQuery.isError && assets.length === 0 && (
        <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><LibraryIcon /></EmptyMedia><EmptyTitle>暂无符合条件的资产</EmptyTitle><EmptyDescription>{queryText || assetType !== "all" || activeFilter !== "all" ? "调整搜索条件后重试。" : "从登记第一条角色、场景、道具、音效或风格资产开始。"}</EmptyDescription></EmptyHeader></Empty>
      )}

      {assets.length > 0 && viewMode === "list" && (
        <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>资产</TableHead><TableHead>类别</TableHead><TableHead>媒介</TableHead><TableHead className="hidden md:table-cell">二级分类</TableHead><TableHead className="hidden lg:table-cell">存储</TableHead><TableHead>状态</TableHead><TableHead className="hidden sm:table-cell">更新时间</TableHead>{canManage && <TableHead><span className="sr-only">操作</span></TableHead>}</TableRow></TableHeader><TableBody>{assets.map((asset) => <TableRow key={asset.id}><TableCell><Link to={`/assets/${asset.id}`} className="flex min-w-48 items-center gap-3 hover:underline"><AssetPreview asset={asset} compact /><div className="min-w-0"><p className="max-w-64 truncate font-medium">{asset.name}</p><p className="max-w-64 truncate text-xs text-muted-foreground">{asset.description || `#${asset.id}`}</p></div></Link></TableCell><TableCell><Badge variant="outline">{assetTypeLabels[asset.assetType]}</Badge></TableCell><TableCell>{mediaTypeLabels[asset.mediaType]}</TableCell><TableCell className="hidden text-muted-foreground md:table-cell">{asset.category}</TableCell><TableCell className="hidden text-muted-foreground lg:table-cell">{asset.cloudUrl ? "云端" : "仅本机/待补充"}</TableCell><TableCell><AssetStatus active={asset.isActive} /></TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{dateFormatter.format(new Date(asset.updatedAt))}</TableCell>{canManage && <TableCell><AssetDialog organizationId={organization.id} asset={asset} trigger={<Button variant="ghost" size="icon-sm" aria-label={`编辑 ${asset.name}`}><PencilIcon /></Button>} /></TableCell>}</TableRow>)}</TableBody></Table></CardContent></Card>
      )}

      {assets.length > 0 && viewMode === "grid" && (
        <section className="grid gap-4 sm:grid-cols-2 @5xl/main:grid-cols-3">{assets.map((asset) => <Card key={asset.id}><CardHeader><div className="flex items-start justify-between gap-3"><CardTitle className="truncate"><Link to={`/assets/${asset.id}`} className="hover:underline">{asset.name}</Link></CardTitle><div className="flex items-center gap-1"><AssetStatus active={asset.isActive} />{canManage && <AssetDialog organizationId={organization.id} asset={asset} trigger={<Button variant="ghost" size="icon-sm" aria-label={`编辑 ${asset.name}`}><PencilIcon /></Button>} />}</div></div></CardHeader><CardContent><Link to={`/assets/${asset.id}`}><AssetPreview asset={asset} /><span className="sr-only">打开 {asset.name}</span></Link><p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">{asset.description || "暂无描述"}</p></CardContent><CardFooter className="justify-between text-xs text-muted-foreground"><span>{assetTypeLabels[asset.assetType]} · {asset.category}</span><span>{dateFormatter.format(new Date(asset.updatedAt))}</span></CardFooter></Card>)}</section>
      )}

      {assets.length > 0 && <PaginationBar page={page} pageCount={pageCount} totalCount={totalCount} onPageChange={setPage} />}
    </div>
  )
}
