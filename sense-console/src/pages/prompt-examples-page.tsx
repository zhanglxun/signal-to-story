import { useDeferredValue, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ExternalLinkIcon, ImageIcon, ImagePlusIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react"

import { PromptExampleDialog } from "@/components/prompt-examples/prompt-example-dialog"
import { PromptExampleDetailDrawer } from "@/components/prompt-examples/prompt-example-detail-drawer"
import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  promptExampleOriginLabels,
  promptExampleOriginTypes,
  promptExampleStatusLabels,
  promptExampleStatuses,
  type PromptExample,
  type PromptExampleOriginType,
  type PromptExampleStatus,
} from "@/contracts/prompt-example"
import { getImageAssetOptions } from "@/services/asset-service"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { deletePromptExample, getPromptExamplesPage } from "@/services/prompt-example-service"

const workspaceKey = ["content-workspace"] as const
const PAGE_SIZE = 10

function isSafeWebUrl(value: string | null): value is string {
  if (!value) return false
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function ExampleImage({ promptExample }: { promptExample: PromptExample }) {
  const imageUrl = isSafeWebUrl(promptExample.examplePreviewUrl) ? promptExample.examplePreviewUrl : null
  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50">
      {imageUrl ? <img src={imageUrl} alt="" loading="lazy" className="size-full object-cover" /> : <ImageIcon className="size-5 text-muted-foreground" />}
    </div>
  )
}

export function PromptExamplesPage() {
  const [queryText, setQueryText] = useState("")
  const [originFilter, setOriginFilter] = useState<"all" | PromptExampleOriginType>("all")
  const [statusFilter, setStatusFilter] = useState<"all" | PromptExampleStatus>("all")
  const [page, setPage] = useState(1)
  const deferredQuery = useDeferredValue(queryText)
  const workspaceQuery = useQuery({ queryKey: workspaceKey, queryFn: getContentWorkspace })
  const organizationId = workspaceQuery.data?.organization?.id
  const canManage = Boolean(workspaceQuery.data?.canManage)

  const imageAssetsQuery = useQuery({
    queryKey: ["image-asset-options", organizationId],
    queryFn: () => getImageAssetOptions(organizationId!),
    enabled: Boolean(organizationId),
  })
  const promptExamplesQuery = useQuery({
    queryKey: ["prompt-examples", organizationId, originFilter, statusFilter, deferredQuery, page],
    queryFn: () => getPromptExamplesPage({
      organizationId: organizationId!,
      query: deferredQuery,
      originType: originFilter === "all" ? undefined : originFilter,
      status: statusFilter === "all" ? undefined : statusFilter,
      page,
      pageSize: PAGE_SIZE,
    }),
    enabled: Boolean(organizationId),
  })

  const resetPage = () => setPage(1)
  if (workspaceQuery.isLoading) return <p className="text-sm text-muted-foreground">正在加载提示词与图例…</p>
  if (workspaceQuery.isError) return <Alert variant="destructive"><AlertTitle>无法加载提示词与图例</AlertTitle><AlertDescription>{workspaceQuery.error.message}</AlertDescription></Alert>
  if (!organizationId) return <Alert><AlertTitle>账号尚未加入组织</AlertTitle><AlertDescription>请先完成组织和 Owner 初始化。</AlertDescription></Alert>

  const promptExamples = promptExamplesQuery.data?.promptExamples ?? []
  const totalCount = promptExamplesQuery.data?.totalCount ?? 0
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const imageAssetOptions = imageAssetsQuery.data ?? []
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creative references"
        title="提示词与图例"
        description="收集网络分享和自己创作的提示词、图例与来源信息。图例可先保存外部链接，确认后再关联资产库图片。"
        actions={canManage && <PromptExampleDialog organizationId={organizationId} imageAssetOptions={imageAssetOptions} trigger={<Button><PlusIcon />登记参考</Button>} />}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1 lg:max-w-md"><SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={queryText} onChange={(event) => { setQueryText(event.target.value); resetPage() }} placeholder="搜索名称或提示词" /></div>
        <NativeSelect className="w-full sm:w-40" aria-label="提示词来源" value={originFilter} onChange={(event) => { setOriginFilter(event.target.value as "all" | PromptExampleOriginType); resetPage() }}><NativeSelectOption value="all">全部来源</NativeSelectOption>{promptExampleOriginTypes.map((origin) => <NativeSelectOption key={origin} value={origin}>{promptExampleOriginLabels[origin]}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect className="w-full sm:w-36" aria-label="提示词状态" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as "all" | PromptExampleStatus); resetPage() }}><NativeSelectOption value="all">全部状态</NativeSelectOption>{promptExampleStatuses.map((status) => <NativeSelectOption key={status} value={status}>{promptExampleStatusLabels[status]}</NativeSelectOption>)}</NativeSelect>
      </div>

      {promptExamplesQuery.isError && <Alert variant="destructive"><AlertTitle>无法读取提示词与图例</AlertTitle><AlertDescription>{promptExamplesQuery.error.message}</AlertDescription></Alert>}
      {promptExamplesQuery.isLoading && <p className="text-sm text-muted-foreground">正在读取提示词与图例…</p>}

      {!promptExamplesQuery.isLoading && !promptExamplesQuery.isError && promptExamples.length === 0 && (
        <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><ImagePlusIcon /></EmptyMedia><EmptyTitle>还没有提示词与图例</EmptyTitle><EmptyDescription>{queryText || originFilter !== "all" || statusFilter !== "all" ? "调整搜索条件后重试。" : "登记第一条网络收集或自己创作的提示词参考。"}</EmptyDescription></EmptyHeader></Empty>
      )}

      {promptExamples.length > 0 && (
        <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>提示词参考</TableHead><TableHead className="hidden md:table-cell">来源</TableHead><TableHead className="hidden lg:table-cell">标签</TableHead><TableHead>状态</TableHead><TableHead className="hidden sm:table-cell">更新</TableHead><TableHead><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{promptExamples.map((promptExample) => {
          const sourceUrl = isSafeWebUrl(promptExample.sourceUrl) ? promptExample.sourceUrl : null
          return <TableRow key={promptExample.id}><TableCell><PromptExampleDetailDrawer promptExample={promptExample} trigger={<button type="button" className="flex min-w-56 items-center gap-3 text-left"><ExampleImage promptExample={promptExample} /><div className="min-w-0"><p className="truncate font-medium">{promptExample.title}</p><p className="mt-1 max-w-xl truncate text-xs text-muted-foreground">{promptExample.promptText}</p></div></button>} /></TableCell><TableCell className="hidden md:table-cell"><div className="flex items-center gap-2"><Badge variant="outline">{promptExampleOriginLabels[promptExample.originType]}</Badge>{promptExample.sourceAuthor && <span className="max-w-28 truncate text-xs text-muted-foreground">{promptExample.sourceAuthor}</span>}</div></TableCell><TableCell className="hidden lg:table-cell"><div className="flex flex-wrap gap-1">{promptExample.tags.slice(0, 3).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}{promptExample.tags.length === 0 && <span className="text-muted-foreground">—</span>}</div></TableCell><TableCell><Badge variant={promptExample.status === "curated" ? "default" : "outline"}>{promptExampleStatusLabels[promptExample.status]}</Badge></TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{dateFormatter.format(new Date(promptExample.updatedAt))}</TableCell><TableCell><div className="flex items-center justify-end gap-1">{sourceUrl && <Button variant="ghost" size="icon-sm" render={<a href={sourceUrl} target="_blank" rel="noreferrer" />} aria-label={`打开 ${promptExample.title} 的原始链接`}><ExternalLinkIcon /></Button>}{canManage && <PromptExampleDialog organizationId={organizationId} promptExample={promptExample} imageAssetOptions={imageAssetOptions} trigger={<Button variant="ghost" size="icon-sm" aria-label={`编辑 ${promptExample.title}`}><PencilIcon /></Button>} />}{canManage && <ConfirmDeleteDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={`删除 ${promptExample.title}`}><Trash2Icon /></Button>} title={`删除“${promptExample.title}”？`} description="删除后不可恢复；关联的图片资产不会被删除。" mutationFn={() => deletePromptExample(promptExample.id, organizationId)} invalidateKeys={[["prompt-examples"]]} successMessage="已删除。" />}</div></TableCell></TableRow>
        })}</TableBody></Table></CardContent></Card>
      )}
      {promptExamples.length > 0 && <PaginationBar page={page} pageCount={pageCount} totalCount={totalCount} onPageChange={setPage} />}
    </div>
  )
}
