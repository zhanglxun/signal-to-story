import { useDeferredValue, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ExternalLinkIcon, InboxIcon, PencilIcon, PlusIcon, SearchIcon, SparklesIcon, Trash2Icon } from "lucide-react"

import { SignalDialog } from "@/components/intake/signal-dialog"
import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { CategorySelect } from "@/components/source-categories/category-select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { getSourceCategories } from "@/services/source-category-service"
import { deleteSignal, getSignalsPage } from "@/services/signal-service"

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

export function IntakePage() {
  const [queryText, setQueryText] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<"all" | number>("all")
  const [page, setPage] = useState(1)
  const deferredQuery = useDeferredValue(queryText)

  const workspaceQuery = useQuery({ queryKey: workspaceKey, queryFn: getContentWorkspace })
  const organizationId = workspaceQuery.data?.organization?.id
  const canManage = Boolean(workspaceQuery.data?.canManage)

  const categoriesQuery = useQuery({
    queryKey: ["source-categories", organizationId],
    queryFn: () => getSourceCategories(organizationId!),
    enabled: Boolean(organizationId),
  })
  const categories = categoriesQuery.data ?? []
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]))

  const changeQueryText = (value: string) => { setQueryText(value); setPage(1) }
  const changeCategoryFilter = (value: "all" | number) => { setCategoryFilter(value); setPage(1) }

  const signalsQuery = useQuery({
    queryKey: ["signals", organizationId, categoryFilter, deferredQuery, page],
    queryFn: () => getSignalsPage({
      organizationId: organizationId!,
      categoryId: categoryFilter === "all" ? undefined : categoryFilter,
      query: deferredQuery,
      page,
      pageSize: PAGE_SIZE,
    }),
    enabled: Boolean(organizationId),
  })

  if (workspaceQuery.isLoading) return <p className="text-sm text-muted-foreground">正在加载待处理信息…</p>
  if (workspaceQuery.isError) return <Alert variant="destructive"><AlertTitle>无法加载待处理信息</AlertTitle><AlertDescription>{workspaceQuery.error.message}</AlertDescription></Alert>
  if (!organizationId) return <Alert><AlertTitle>账号尚未加入组织</AlertTitle><AlertDescription>请先完成组织和 Owner 初始化。</AlertDescription></Alert>

  const signals = signalsQuery.data?.signals ?? []
  const totalCount = signalsQuery.data?.totalCount ?? 0
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Signal intake"
        title="待处理信息"
        description="集中查看新捕获的线索、链接和摘录，验证、聚类或转成选题之前先在这里沉淀。"
        actions={canManage && (
          <SignalDialog
            organizationId={organizationId}
            categories={categories}
            trigger={<Button><PlusIcon />手动登记线索</Button>}
          />
        )}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-sm"><SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={queryText} onChange={(event) => changeQueryText(event.target.value)} placeholder="搜索名称" /></div>
        <CategorySelect
          className="w-full sm:w-56"
          ariaLabel="按分类筛选"
          categories={categories}
          value={categoryFilter === "all" ? null : categoryFilter}
          onChange={(value) => changeCategoryFilter(value === null ? "all" : value)}
          allOptionLabel="全部分类"
        />
      </div>

      {signalsQuery.isError && <Alert variant="destructive"><AlertTitle>无法读取待处理信息</AlertTitle><AlertDescription>{signalsQuery.error.message}</AlertDescription></Alert>}
      {signalsQuery.isLoading && <p className="text-sm text-muted-foreground">正在读取列表…</p>}

      {!signalsQuery.isLoading && !signalsQuery.isError && signals.length === 0 && (
        <Empty className="min-h-72 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><InboxIcon /></EmptyMedia>
            <EmptyTitle>暂无符合条件的信息</EmptyTitle>
            <EmptyDescription>{queryText || categoryFilter !== "all" ? "调整搜索条件后重试。" : "从手动登记第一条线索开始。"}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {signals.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead className="hidden md:table-cell">分类</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="hidden lg:table-cell">摘要</TableHead>
                  <TableHead className="hidden sm:table-cell">更新时间</TableHead>
                  <TableHead><span className="sr-only">操作</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((signal) => {
                  const siteUrl = isSafeWebUrl(signal.siteUrl) ? signal.siteUrl : null
                  return (
                    <TableRow key={signal.id}>
                      <TableCell>
                        <p className="max-w-64 truncate font-medium">{signal.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground md:hidden">{categoryNameById.get(signal.categoryId) ?? "未分类"}</p>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{categoryNameById.get(signal.categoryId) ?? "未分类"}</TableCell>
                      <TableCell><Badge variant={signal.isOrganized ? "secondary" : "outline"}>{signal.isOrganized ? "已整理" : "未整理"}</Badge></TableCell>
                      <TableCell className="hidden max-w-sm truncate text-muted-foreground lg:table-cell">{signal.summary || "—"}</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{dateFormatter.format(new Date(signal.updatedAt))}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" disabled aria-label="AI 分析（即将上线）" title="AI 分析（即将上线）"><SparklesIcon /></Button>
                          {siteUrl && <Button variant="ghost" size="icon-sm" render={<a href={siteUrl} target="_blank" rel="noreferrer" />} aria-label="打开来源链接"><ExternalLinkIcon /></Button>}
                          {canManage && <SignalDialog organizationId={organizationId} signal={signal} categories={categories} trigger={<Button variant="ghost" size="icon-sm" aria-label={`编辑 ${signal.name}`}><PencilIcon /></Button>} />}
                          {canManage && (
                            <ConfirmDeleteDialog
                              trigger={<Button variant="ghost" size="icon-sm" aria-label={`删除 ${signal.name}`}><Trash2Icon /></Button>}
                              title={`删除"${signal.name}"？`}
                              description="如果已有选题引用这条信息，删除会被拒绝。"
                              mutationFn={() => deleteSignal(signal.id, organizationId)}
                              invalidateKeys={[["signals"]]}
                              successMessage="已删除。"
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <PaginationBar page={page} pageCount={pageCount} totalCount={totalCount} onPageChange={setPage} />
    </div>
  )
}
