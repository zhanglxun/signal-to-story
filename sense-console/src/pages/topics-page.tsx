import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { PencilIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react"
import { Link } from "react-router"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { SelectionDialog } from "@/components/topics/selection-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { selectionPriorityLabels } from "@/contracts/selection"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { getSignalOptions } from "@/services/signal-service"
import { deleteSelection, getSelectionsPage } from "@/services/selection-service"

const workspaceKey = ["content-workspace"] as const
const PAGE_SIZE = 10

export function TopicsPage() {
  const [page, setPage] = useState(1)
  const workspaceQuery = useQuery({ queryKey: workspaceKey, queryFn: getContentWorkspace })
  const organizationId = workspaceQuery.data?.organization?.id
  const canManage = Boolean(workspaceQuery.data?.canManage)

  const signalOptionsQuery = useQuery({
    queryKey: ["signal-options", organizationId],
    queryFn: () => getSignalOptions(organizationId!),
    enabled: Boolean(organizationId),
  })

  const selectionsQuery = useQuery({
    queryKey: ["selections", organizationId, page],
    queryFn: () => getSelectionsPage({ organizationId: organizationId!, page, pageSize: PAGE_SIZE }),
    enabled: Boolean(organizationId),
  })

  if (workspaceQuery.isLoading) return <p className="text-sm text-muted-foreground">正在加载选题…</p>
  if (workspaceQuery.isError) return <Alert variant="destructive"><AlertTitle>无法加载选题</AlertTitle><AlertDescription>{workspaceQuery.error.message}</AlertDescription></Alert>
  if (!organizationId) return <Alert><AlertTitle>账号尚未加入组织</AlertTitle><AlertDescription>请先完成组织和 Owner 初始化。</AlertDescription></Alert>

  const signalOptions = signalOptionsQuery.data ?? []
  const selections = selectionsQuery.data?.selections ?? []
  const totalCount = selectionsQuery.data?.totalCount ?? 0
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" })

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Editorial intelligence"
        title="选题"
        description="集中判断外部信号的叙事价值，并把通过的方向推进到研究与故事生产。"
        actions={canManage && (
          <SelectionDialog
            organizationId={organizationId}
            signalOptions={signalOptions}
            trigger={<Button disabled={signalOptions.length === 0}><PlusIcon />新建选题</Button>}
          />
        )}
      />

      {signalOptions.length === 0 && !signalOptionsQuery.isLoading && (
        <Alert><AlertTitle>还没有可关联的待处理信息</AlertTitle><AlertDescription>请先在"待处理信息"里登记至少一条线索，再创建选题。</AlertDescription></Alert>
      )}

      {selectionsQuery.isError && <Alert variant="destructive"><AlertTitle>无法读取选题列表</AlertTitle><AlertDescription>{selectionsQuery.error.message}</AlertDescription></Alert>}
      {selectionsQuery.isLoading && <p className="text-sm text-muted-foreground">正在读取选题列表…</p>}

      {!selectionsQuery.isLoading && !selectionsQuery.isError && selections.length === 0 && (
        <Empty className="min-h-72 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><SparklesIcon /></EmptyMedia>
            <EmptyTitle>还没有选题</EmptyTitle>
            <EmptyDescription>从一条待处理信息生成第一个选题开始。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {selections.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>选题</TableHead>
                  <TableHead className="hidden md:table-cell">关联信息</TableHead>
                  <TableHead>优先级</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="hidden sm:table-cell">更新</TableHead>
                  <TableHead><span className="sr-only">操作</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selections.map((selection) => (
                  <TableRow key={selection.id}>
                    <TableCell>
                      <Link className="font-medium hover:text-primary" to={`/topics/${selection.id}`}>{selection.name}</Link>
                      <p className="mt-1 text-xs text-muted-foreground md:hidden">{selection.signalName ?? `#${selection.signalId}`}</p>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{selection.signalName ?? `#${selection.signalId}`}</TableCell>
                    <TableCell><Badge variant="outline">{selectionPriorityLabels[selection.priority]}</Badge></TableCell>
                    <TableCell><Badge variant={selection.isCompleted ? "secondary" : "outline"}>{selection.isCompleted ? "已完成" : "未完成"}</Badge></TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{dateFormatter.format(new Date(selection.updatedAt))}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canManage && <SelectionDialog organizationId={organizationId} selection={selection} signalOptions={signalOptions} trigger={<Button variant="ghost" size="icon-sm" aria-label={`编辑 ${selection.name}`}><PencilIcon /></Button>} />}
                        {canManage && (
                          <ConfirmDeleteDialog
                            trigger={<Button variant="ghost" size="icon-sm" aria-label={`删除 ${selection.name}`}><Trash2Icon /></Button>}
                            title={`删除选题"${selection.name}"？`}
                            description="删除后不可恢复。"
                            mutationFn={() => deleteSelection(selection.id, organizationId)}
                            invalidateKeys={[["selections"]]}
                            successMessage="选题已删除。"
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <PaginationBar page={page} pageCount={pageCount} totalCount={totalCount} onPageChange={setPage} />
    </div>
  )
}
