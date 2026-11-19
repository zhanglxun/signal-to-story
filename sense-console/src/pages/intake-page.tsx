import { useState } from "react"
import { useNavigate } from "react-router"
import { useQuery } from "@tanstack/react-query"
import {
  ExternalLinkIcon,
  FolderInputIcon,
  InboxIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { Field } from "@/components/content/content-common"
import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { CategorySelect } from "@/components/source-categories/category-select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { NativeSelect } from "@/components/ui/native-select"
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
import { Textarea } from "@/components/ui/textarea"
import type { SourceCategory } from "@/contracts/source-category"
import {
  intakeEventCategoryId,
  intakeSourceLabels,
  intakeSources,
  titleFromInput,
  type IntakeEvent,
  type IntakeSource,
  type WorkItem,
} from "@/contracts/work-item"
import { useContentAction } from "@/hooks/use-content-action"
import { getContentWorkspace } from "@/services/content-workspace-service"
import {
  attachInput,
  ignoreInput,
  ignoreInputs,
  listInbox,
  promoteInput,
  recordManualInput,
} from "@/services/intake-service"
import { getSourceCategories } from "@/services/source-category-service"
import { listWorkItems } from "@/services/work-item-service"

const PAGE_SIZE = 20

const sourceFilterItems: Record<IntakeSource | "all", string> = {
  all: "全部来源",
  web: intakeSourceLabels.web,
  im: intakeSourceLabels.im,
  api: intakeSourceLabels.api,
  chat: intakeSourceLabels.chat,
}

function safeUrl(value: string | null) {
  if (!value) return null
  try {
    return ["http:", "https:"].includes(new URL(value).protocol) ? value : null
  } catch {
    return null
  }
}

function secondaryPreview(event: IntakeEvent, title: string): string | null {
  const lines = event.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length <= 1) return null
  const rest = lines.slice(1).join(" ")
  return rest && rest !== title ? rest : null
}

export function IntakePage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [sourceFilter, setSourceFilter] = useState<IntakeSource | "all">("all")
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [attachingEvent, setAttachingEvent] = useState<IntakeEvent | null>(null)

  const navigate = useNavigate()
  const { busy, run } = useContentAction()

  const workspace = useQuery({
    queryKey: ["content-workspace"],
    queryFn: getContentWorkspace,
  })
  const org = workspace.data?.organization?.id
  const canManage = Boolean(workspace.data?.canManage)

  const categoriesQuery = useQuery({
    queryKey: ["source-categories", org],
    queryFn: () => getSourceCategories(org!),
    enabled: Boolean(org),
  })
  const categories = categoriesQuery.data ?? []
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]))

  const inbox = useQuery({
    queryKey: ["intake-inbox", org, page, search, sourceFilter, categoryFilter],
    queryFn: () =>
      listInbox(org!, page, PAGE_SIZE, {
        query: search,
        source: sourceFilter,
        categoryId: categoryFilter,
      }),
    enabled: Boolean(org),
  })

  const openItems = useQuery({
    queryKey: ["work-item", "open-options", org],
    queryFn: async () =>
      (await listWorkItems(org!)).filter(
        (i) => i.status !== "done" && i.status !== "dropped"
      ),
    enabled: Boolean(org && canManage),
  })

  if (workspace.isLoading) {
    return <p className="text-sm text-muted-foreground">正在加载收件箱…</p>
  }
  if (workspace.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>无法加载收件箱</AlertTitle>
        <AlertDescription>{workspace.error.message}</AlertDescription>
      </Alert>
    )
  }
  if (!org) {
    return (
      <Alert>
        <AlertTitle>账号尚未加入组织</AlertTitle>
        <AlertDescription>请先完成组织和 Owner 初始化。</AlertDescription>
      </Alert>
    )
  }

  const events = inbox.data?.events ?? []
  const totalCount = inbox.data?.totalCount ?? 0
  const visibleIds = new Set(events.map((e) => e.id))
  const activeSelectedIds = selectedIds.filter((id) => visibleIds.has(id))
  const allSelected =
    events.length > 0 && activeSelectedIds.length === events.length
  const hasFilters =
    Boolean(search.trim()) ||
    sourceFilter !== "all" ||
    categoryFilter !== null

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? events.map((e) => e.id) : [])
  }

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...new Set([...prev, id])] : prev.filter((item) => item !== id)
    )
  }

  const handleBatchIgnore = () => {
    if (activeSelectedIds.length === 0) return
    void run(
      () => ignoreInputs(activeSelectedIds),
      `已忽略 ${activeSelectedIds.length} 条输入`
    ).then((ok) => {
      if (ok) setSelectedIds([])
    })
  }

  const colSpan = canManage ? 6 : 4

  return (
    <div className="space-y-4">
      <PageHeader
        title="收件箱"
        description="速记、IM 和外部接口收到的每一条输入都先放在这里。转为事项、归入已有事项，或忽略。"
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              新建输入
            </Button>
          ) : undefined
        }
      />

      {inbox.isError && (
        <Alert variant="destructive">
          <AlertTitle>无法读取收件箱</AlertTitle>
          <AlertDescription>{inbox.error.message}</AlertDescription>
        </Alert>
      )}

      {/* 列表工具栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input
            value={search}
            placeholder="搜索内容或链接…"
            aria-label="搜索收件箱"
            className="h-8 w-full sm:w-64"
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
          <Select
            items={sourceFilterItems}
            value={sourceFilter}
            onValueChange={(value) => {
              if (!value) return
              setSourceFilter(value as IntakeSource | "all")
              setPage(1)
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label="按来源筛选"
              className="h-8 w-32"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部来源</SelectItem>
              {intakeSources.map((src) => (
                <SelectItem key={src} value={src}>
                  {intakeSourceLabels[src]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <CategorySelect
            className="h-8 w-40"
            ariaLabel="按分类筛选"
            categories={categories}
            value={categoryFilter}
            onChange={(val) => {
              setCategoryFilter(val)
              setPage(1)
            }}
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
                setSourceFilter("all")
                setCategoryFilter(null)
                setPage(1)
              }}
            >
              重置
              <XIcon className="size-3.5" />
            </Button>
          )}
        </div>

        {canManage && activeSelectedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              已选 {activeSelectedIds.length} 条
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={handleBatchIgnore}
            >
              <Trash2Icon className="size-3.5" />
              批量忽略
            </Button>
          </div>
        )}
      </div>

      {/* 标准数据表格 */}
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {canManage && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="全选当前页"
                    checked={allSelected}
                    onCheckedChange={(checked) => toggleAll(Boolean(checked))}
                  />
                </TableHead>
              )}
              <TableHead>内容与链接</TableHead>
              <TableHead className="w-24">来源</TableHead>
              <TableHead className="hidden w-32 md:table-cell">分类</TableHead>
              <TableHead className="hidden w-40 sm:table-cell">
                创建时间
              </TableHead>
              {canManage && (
                <TableHead className="w-40 text-right">操作</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {inbox.isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="h-24 text-center text-muted-foreground"
                >
                  正在读取…
                </TableCell>
              </TableRow>
            ) : events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="h-36 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <InboxIcon className="size-6 opacity-60" />
                    <p className="text-sm font-medium text-foreground">
                      {hasFilters ? "没有符合筛选条件的输入" : "收件箱是空的"}
                    </p>
                    <p className="text-xs">
                      {hasFilters
                        ? "尝试清空搜索词或切换来源与分类筛选。"
                        : "点击右上角「新建输入」，或通过速记与 IM 收集线索。"}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              events.map((event) => {
                const title = titleFromInput(event)
                const preview = secondaryPreview(event, title)
                const url = safeUrl(event.url)
                const catId = intakeEventCategoryId(event)
                const categoryName =
                  catId != null ? categoryNameById.get(catId) ?? "—" : "—"
                const selected = activeSelectedIds.includes(event.id)
                return (
                  <TableRow
                    key={event.id}
                    data-state={selected ? "selected" : undefined}
                  >
                    {canManage && (
                      <TableCell>
                        <Checkbox
                          aria-label={`选择 ${title}`}
                          checked={selected}
                          onCheckedChange={(checked) =>
                            toggleOne(event.id, Boolean(checked))
                          }
                        />
                      </TableCell>
                    )}
                    <TableCell className="max-w-md whitespace-normal">
                      <div className="space-y-1">
                        <p className="line-clamp-1 font-medium text-foreground">
                          {title}
                        </p>
                        {preview && (
                          <p className="line-clamp-1 text-xs text-muted-foreground">
                            {preview}
                          </p>
                        )}
                        {url && (
                          <a
                            className="inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLinkIcon className="size-3 shrink-0" />
                            <span className="truncate">{url}</span>
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {intakeSourceLabels[event.source]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {categoryName}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {new Date(event.created_at).toLocaleString()}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const item = await promoteInput(event)
                                navigate(`/work-items/${item.id}`)
                              }, "已转为事项")
                            }
                          >
                            转为事项
                          </Button>
                          {url && (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`打开链接 ${title}`}
                              title="打开来源链接"
                              className={buttonVariants({
                                variant: "ghost",
                                size: "icon-sm",
                              })}
                            >
                              <ExternalLinkIcon className="size-4" />
                            </a>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`更多操作 ${title}`}
                                  disabled={busy}
                                />
                              }
                            >
                              <MoreHorizontalIcon className="size-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem
                                onClick={() => setAttachingEvent(event)}
                              >
                                <FolderInputIcon className="size-4" />
                                归入已有事项…
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  void run(() => ignoreInput(event), "已忽略")
                                }
                              >
                                <Trash2Icon className="size-4" />
                                忽略
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <PaginationBar
        page={page}
        pageCount={Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
        totalCount={totalCount}
        onPageChange={(nextPage) => {
          setPage(nextPage)
          setSelectedIds([])
        }}
      />

      {canManage && (
        <>
          <CreateInputDialog
            organizationId={org}
            categories={categories}
            open={createOpen}
            onOpenChange={setCreateOpen}
          />
          <AttachWorkItemDialog
            event={attachingEvent}
            openItems={openItems.data ?? []}
            onOpenChange={(open) => {
              if (!open) setAttachingEvent(null)
            }}
          />
        </>
      )}
    </div>
  )
}

function CreateInputDialog({
  organizationId,
  categories,
  open,
  onOpenChange,
}: {
  organizationId: string
  categories: SourceCategory[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [text, setText] = useState("")
  const [url, setUrl] = useState("")
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const { busy, run } = useContentAction()

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setText("")
      setUrl("")
      setCategoryId(null)
    }
    onOpenChange(nextOpen)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void run(
      () =>
        recordManualInput(organizationId, {
          text,
          url: url.trim(),
          categoryId,
        }),
      "已记入收件箱"
    ).then((ok) => {
      if (ok) {
        setText("")
        setUrl("")
        setCategoryId(null)
        onOpenChange(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建输入</DialogTitle>
          <DialogDescription>
            记录一句想法、一段摘录或外部参考链接到收件箱，后续可随时转为事项。
          </DialogDescription>
        </DialogHeader>
        <form
          id="create-intake-form"
          className="space-y-4"
          onSubmit={handleSubmit}
        >
          <Field label="内容">
            <Textarea
              rows={4}
              maxLength={20000}
              value={text}
              placeholder="一句想法、一段摘录…"
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <Field label="链接（可选）">
            <Input
              type="url"
              maxLength={2048}
              value={url}
              placeholder="https://"
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <Field label="分类（可选）">
            <CategorySelect
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              allOptionLabel="不分类"
              ariaLabel="选择分类"
            />
          </Field>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="submit"
            form="create-intake-form"
            disabled={busy || (!text.trim() && !url.trim())}
          >
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AttachWorkItemDialog({
  event,
  openItems,
  onOpenChange,
}: {
  event: IntakeEvent | null
  openItems: WorkItem[]
  onOpenChange: (open: boolean) => void
}) {
  const [targetId, setTargetId] = useState("")
  const { busy, run } = useContentAction()

  return (
    <Dialog
      open={Boolean(event)}
      onOpenChange={(open) => {
        if (!open) setTargetId("")
        onOpenChange(open)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>归入已有事项</DialogTitle>
          <DialogDescription>
            将「{event ? titleFromInput(event) : ""}」归入一个进行中的事项。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <NativeSelect
            aria-label="选择要归入的事项"
            className="w-full"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">请选择事项…</option>
            {openItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </NativeSelect>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={busy || !event || !targetId}
            onClick={() => {
              if (!event || !targetId) return
              void run(() => attachInput(event, targetId), "已归入事项").then(
                (ok) => {
                  if (ok) {
                    setTargetId("")
                    onOpenChange(false)
                  }
                }
              )
            }}
          >
            确认归入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
