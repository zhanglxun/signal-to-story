import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { useQuery } from "@tanstack/react-query"
import {
  CheckCircle2Icon,
  CircleSlashIcon,
  InboxIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react"

import { ContentState } from "@/components/content/content-common"
import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { CategorySelect } from "@/components/source-categories/category-select"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { WorkItemForm } from "@/components/work-items/work-item-form"
import {
  workItemFormValues,
  workItemKindLabels,
  workItemKinds,
  workItemStatusLabels,
  workItemStatuses,
  type WorkItem,
  type WorkItemKind,
  type WorkItemStatus,
} from "@/contracts/work-item"
import { useContentAction } from "@/hooks/use-content-action"
import { useContentData } from "@/hooks/use-content-data"
import { usePagination } from "@/hooks/use-pagination"
import { getSourceCategories } from "@/services/source-category-service"
import {
  createWorkItem,
  setWorkItemStatus,
  updateWorkItem,
} from "@/services/work-item-service"

type StatusFilter = "open" | "all" | WorkItemStatus
const isOpen = (item: WorkItem) =>
  item.status !== "done" && item.status !== "dropped"

const PAGE_SIZE = 20

const kindFilterItems: Record<WorkItemKind | "all", string> = {
  all: "全部形态",
  article: workItemKindLabels.article,
  video: workItemKindLabels.video,
}

export function WorkItemsPage() {
  const content = useContentData()
  const org = content.workspace?.organization?.id
  const categoriesQuery = useQuery({
    queryKey: ["source-categories", org],
    queryFn: () => getSourceCategories(org!),
    enabled: Boolean(org),
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<WorkItem | null>(null)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<StatusFilter>("open")
  const [kindFilter, setKindFilter] = useState<WorkItemKind | "all">("all")
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null)
  const navigate = useNavigate()
  const { busy, run } = useContentAction()

  const workItems = content.data?.workItems ?? []
  const documents = content.data?.documents ?? []
  const categories = categoriesQuery.data ?? []
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]))

  const keyword = search.trim().toLowerCase()
  const filteredItems = workItems
    .filter((i) =>
      filter === "all" ? true : filter === "open" ? isOpen(i) : i.status === filter
    )
    .filter((i) => (kindFilter === "all" ? true : i.kind === kindFilter))
    .filter((i) =>
      categoryFilter === null ? true : i.category_id === categoryFilter
    )
    .filter((i) => {
      if (!keyword) return true
      const briefText =
        typeof i.brief.text === "string" ? i.brief.text.toLowerCase() : ""
      return i.title.toLowerCase().includes(keyword) || briefText.includes(keyword)
    })

  const { page, pageCount, pageItems, setPage, totalCount } = usePagination(
    filteredItems,
    PAGE_SIZE
  )

  if (
    content.loading ||
    content.error ||
    !content.workspace?.organization ||
    !content.data
  ) {
    return (
      <ContentState
        {...content}
        hasOrg={Boolean(content.workspace?.organization)}
      />
    )
  }

  const organizationId = content.workspace.organization.id
  const canManage = Boolean(content.workspace.canManage)
  const count = (f: StatusFilter) =>
    workItems.filter((i) =>
      f === "all" || (f === "open" ? isOpen(i) : i.status === f)
    ).length

  const hasFilters =
    Boolean(search.trim()) || kindFilter !== "all" || categoryFilter !== null
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title="事项"
        description="每张卡是一件要做的内容。状态就是看板列：待办、AI 在做、等你处理、待审核、完成、放弃。"
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              新建事项
            </Button>
          ) : undefined
        }
      />

      <Tabs
        value={filter}
        onValueChange={(value) => value && setFilter(value as StatusFilter)}
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="open">进行中 {count("open")}</TabsTrigger>
          {workItemStatuses.map((s) => (
            <TabsTrigger key={s} value={s}>
              {workItemStatusLabels[s]} {count(s)}
            </TabsTrigger>
          ))}
          <TabsTrigger value="all">全部 {count("all")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-full sm:w-64"
          aria-label="搜索事项"
          placeholder="搜索标题或 Brief…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          items={kindFilterItems}
          value={kindFilter}
          onValueChange={(value) => {
            if (value) setKindFilter(value as WorkItemKind | "all")
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label="按形态筛选"
            className="h-8 w-32"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部形态</SelectItem>
            {workItemKinds.map((k) => (
              <SelectItem key={k} value={k}>
                {workItemKindLabels[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <CategorySelect
          className="h-8 w-40"
          ariaLabel="按分类筛选"
          categories={categories}
          value={categoryFilter}
          onChange={setCategoryFilter}
          allOptionLabel="全部分类"
        />
        {hasFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => {
              setSearch("")
              setKindFilter("all")
              setCategoryFilter(null)
            }}
          >
            重置
            <XIcon className="size-3.5" />
          </Button>
        )}
      </div>

      {/* 标准数据表格 */}
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>标题</TableHead>
              <TableHead className="w-24">形态</TableHead>
              <TableHead className="hidden w-32 md:table-cell">分类</TableHead>
              <TableHead className="w-28">状态</TableHead>
              <TableHead className="hidden w-36 lg:table-cell">稿件</TableHead>
              <TableHead className="hidden w-36 sm:table-cell">
                更新时间
              </TableHead>
              <TableHead className="w-32 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-36 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <InboxIcon className="size-6 opacity-60" />
                    <p className="text-sm font-medium text-foreground">
                      没有匹配的事项
                    </p>
                    <p className="text-xs">
                      可以从收件箱把输入转为事项，或点击右上角「新建事项」。
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((item) => {
                const docs = documents.filter((d) => d.work_item_id === item.id)
                const approvedCount = docs.filter(
                  (d) => d.status === "approved"
                ).length
                const briefText =
                  typeof item.brief.text === "string"
                    ? item.brief.text.trim()
                    : ""
                const categoryName =
                  item.category_id != null
                    ? categoryNameById.get(item.category_id) ?? "—"
                    : "—"
                return (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-md whitespace-normal">
                      <div className="space-y-1">
                        <Link
                          to={`/work-items/${item.id}`}
                          className="line-clamp-1 font-medium text-foreground hover:underline"
                        >
                          {item.title}
                        </Link>
                        {briefText && (
                          <p className="line-clamp-1 text-xs text-muted-foreground">
                            {briefText}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {workItemKindLabels[item.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {categoryName}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isOpen(item) ? "default" : "secondary"}>
                        {workItemStatusLabels[item.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                      {docs.length} 份 · {approvedCount} 已通过
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {dateFormatter.format(new Date(item.updated_at))}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <Link
                          to={`/work-items/${item.id}`}
                          className={buttonVariants({
                            variant: "outline",
                            size: "sm",
                          })}
                        >
                          查看
                        </Link>
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`操作事项 ${item.title}`}
                                  disabled={busy}
                                />
                              }
                            >
                              <MoreHorizontalIcon className="size-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem
                                onClick={() => setEditingItem(item)}
                              >
                                <PencilIcon className="size-4" />
                                编辑事项…
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {item.status !== "todo" && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    void run(
                                      () => setWorkItemStatus(item, "todo"),
                                      "已设为待办"
                                    )
                                  }
                                >
                                  <RotateCcwIcon className="size-4" />
                                  设为待办
                                </DropdownMenuItem>
                              )}
                              {item.status !== "done" && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    void run(
                                      () => setWorkItemStatus(item, "done"),
                                      "已标记完成"
                                    )
                                  }
                                >
                                  <CheckCircle2Icon className="size-4" />
                                  标记完成
                                </DropdownMenuItem>
                              )}
                              {item.status !== "dropped" && (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() =>
                                    void run(
                                      () => setWorkItemStatus(item, "dropped"),
                                      "已标记放弃"
                                    )
                                  }
                                >
                                  <CircleSlashIcon className="size-4" />
                                  标记放弃
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <PaginationBar
        page={page}
        pageCount={pageCount}
        totalCount={totalCount}
        onPageChange={setPage}
      />

      {canManage && (
        <>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>新建事项</DialogTitle>
                <DialogDescription>
                  创建一个新的图文或视频选题事项，填写基础参数与 Brief。
                </DialogDescription>
              </DialogHeader>
              <WorkItemForm
                key={createOpen ? "create-open" : "create-closed"}
                initial={workItemFormValues()}
                categories={categories}
                busy={busy}
                submitLabel="创建事项"
                onSave={async (input) => {
                  let createdId: string | null = null
                  const ok = await run(async () => {
                    const item = await createWorkItem(organizationId, input)
                    createdId = item.id
                  }, "已创建事项")
                  if (ok && createdId) {
                    setCreateOpen(false)
                    navigate(`/work-items/${createdId}`)
                  }
                }}
              />
            </DialogContent>
          </Dialog>

          <Dialog
            open={Boolean(editingItem)}
            onOpenChange={(open) => {
              if (!open) setEditingItem(null)
            }}
          >
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>编辑事项</DialogTitle>
                <DialogDescription>
                  更新当前事项的基础信息与 Brief。
                </DialogDescription>
              </DialogHeader>
              {editingItem && (
                <WorkItemForm
                  key={`${editingItem.id}:${editingItem.updated_at}`}
                  initial={{
                    ...workItemFormValues(editingItem),
                    updated_at: editingItem.updated_at,
                  }}
                  categories={categories}
                  busy={busy}
                  submitLabel="保存修改"
                  onSave={async (input) => {
                    const ok = await run(
                      () => updateWorkItem(editingItem, input),
                      "已保存事项"
                    )
                    if (ok) setEditingItem(null)
                  }}
                />
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
