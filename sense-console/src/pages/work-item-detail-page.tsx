import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "react-router"
import {
  CircleSlashIcon,
  FileTextIcon,
  InboxIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ContentState } from "@/components/content/content-common"
import { DocumentAiPanel } from "@/components/content/document-ai-panel"
import {
  DocumentEditor,
  type DocumentViewMode,
} from "@/components/content/document-editor"
import { DocumentHistoryPanel } from "@/components/content/document-history-panel"
import { SitePublishPanel } from "@/components/content/site-publish-panel"
import { TextHandoff } from "@/components/content/text-handoff"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { WorkItemForm } from "@/components/work-items/work-item-form"
import { WorkItemStepper } from "@/components/work-items/work-item-stepper"
import {
  exportMarkdown,
  platformKeys,
  platforms,
  statusLabels,
} from "@/contracts/content"
import {
  briefExtras,
  intakeSourceLabels,
  workItemFormValues,
  workItemKindLabels,
  workItemStatusLabels,
  workItemStatuses,
  type WorkItemStatus,
} from "@/contracts/work-item"
import { downloadText, useContentAction } from "@/hooks/use-content-action"
import { useDocumentDraftJobs } from "@/hooks/use-document-draft-jobs"
import { deriveWorkItemWorkflow } from "@/lib/work-item-workflow"
import { enqueueContentDraftJob } from "@/services/agent-job-service"
import {
  approveDocumentDirectly,
  reviewDocument,
} from "@/services/content-service"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { getSourceCategories } from "@/services/source-category-service"
import {
  createWorkItemDocument,
  getWorkItem,
  listWorkItemDocuments,
  listWorkItemInputs,
  setWorkItemStatus,
  updateWorkItem,
} from "@/services/work-item-service"

function safeUrl(value: string | null) {
  if (!value) return null
  try {
    return ["http:", "https:"].includes(new URL(value).protocol) ? value : null
  } catch {
    return null
  }
}

export function WorkItemDetailPage() {
  const { workItemId = "" } = useParams()
  const queryClient = useQueryClient()
  const workspace = useQuery({
    queryKey: ["content-workspace"],
    queryFn: getContentWorkspace,
  })
  const query = useQuery({
    queryKey: ["work-item", workItemId],
    queryFn: async () => {
      const [item, documents, inputs] = await Promise.all([
        getWorkItem(workItemId),
        listWorkItemDocuments(workItemId),
        listWorkItemInputs(workItemId),
      ])
      return { item, documents, inputs }
    },
  })
  const org = workspace.data?.organization?.id
  const categories = useQuery({
    queryKey: ["source-categories", org],
    queryFn: () => getSourceCategories(org!),
    enabled: Boolean(org),
  })

  const [active, setActive] = useState("")
  const [editorDirty, setEditorDirty] = useState(false)
  const [editorViewMode, setEditorViewMode] = useState<DocumentViewMode | null>(
    null
  )
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [briefDialogOpen, setBriefDialogOpen] = useState(false)
  const [confirmDoneOpen, setConfirmDoneOpen] = useState(false)
  const [userSidebarTab, setUserSidebarTab] = useState<
    "ai" | "context" | "history" | null
  >(null)

  const { busy, run } = useContentAction()

  const itemData = query.data?.item
  const documents = query.data?.documents ?? []
  const inputs = query.data?.inputs ?? []
  const master = documents.find((d) => d.platform === "master")
  const selected =
    documents.find((d) => d.id === active) ?? master ?? documents[0] ?? null

  const draftJobsQuery = useDocumentDraftJobs(
    selected
      ? {
          id: selected.id,
          organization_id: selected.organization_id,
          revision: selected.revision,
        }
      : { id: "", organization_id: "", revision: 0 }
  )

  const loading = workspace.isLoading || query.isLoading
  const error = workspace.error ?? query.error
  if (loading || error || !itemData || !workspace.data?.organization) {
    return (
      <ContentState
        loading={loading}
        error={error}
        hasOrg={Boolean(workspace.data?.organization)}
      />
    )
  }

  const item = itemData
  const canManage = Boolean(workspace.data.canManage)
  const canReview = Boolean(workspace.data.canReview)
  const canPublish = Boolean(workspace.data.canPublish)

  const workflow = deriveWorkItemWorkflow({
    item,
    documents,
    activeDoc: selected,
    draftJobs: draftJobsQuery.data ?? [],
  })

  const categoryName =
    item.category_id != null
      ? (categories.data ?? []).find((c) => c.id === item.category_id)?.name
      : undefined
  const extras = briefExtras(item.brief)
  const briefText = typeof item.brief.text === "string" ? item.brief.text : ""
  const availablePlatforms = platformKeys.filter(
    (p) => !documents.some((d) => d.platform === p)
  )

  const defaultSidebarTab = workflow.currentStep === 1 ? "ai" : "context"
  const sidebarTab = userSidebarTab ?? defaultSidebarTab

  const showPublishSection =
    selected !== null &&
    (selected.status === "approved" ||
      documents.some((d) => d.status === "approved") ||
      documents.some((d) => d.published_revision != null || Boolean(d.published_url)))

  function switchDocument(docId: string) {
    setActive(docId)
    setEditorDirty(false)
    setEditorViewMode(null)
  }

  async function handleCreateMasterAndDraft() {
    await run(async () => {
      const doc = await createWorkItemDocument(item, "master")
      switchDocument(doc.id)
      setUserSidebarTab("ai")
      await enqueueContentDraftJob({
        documentId: doc.id,
        instruction:
          "根据项目 Brief 编写一份结构清晰、可审核的中文初稿，不确定之处标注 [待核实]。",
      })
      await queryClient.invalidateQueries({
        queryKey: ["agent-jobs", "document", doc.id],
      })
    }, "已创建母稿并交给 AI 出稿")
  }

  async function handleCreateMasterOnly() {
    await run(async () => {
      const doc = await createWorkItemDocument(item, "master")
      switchDocument(doc.id)
      setEditorViewMode("edit")
    }, "已创建母稿")
  }

  async function handleTriggerAiDraft() {
    if (!selected) return
    await run(async () => {
      setUserSidebarTab("ai")
      await enqueueContentDraftJob({
        documentId: selected.id,
        instruction: "根据项目 Brief 和当前稿件完善一份可审核的内容草案。",
      })
      await queryClient.invalidateQueries({
        queryKey: ["agent-jobs", "document", selected.id],
      })
    }, "已交给 Agent 出稿，通过评估后会直接写入新草稿")
  }

  function handleStartEditing() {
    setEditorViewMode("edit")
    document
      .getElementById("document-editor-section")
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  async function handleApproveDirectly() {
    if (!selected) return
    await run(async () => {
      await approveDocumentDirectly(selected)
    }, "稿件已确认定稿，已解锁发布与导出")
  }

  async function handleSubmitForReview() {
    if (!selected) return
    await run(async () => {
      await reviewDocument(selected, "in_review", "")
    }, "已提交审核")
  }

  function handleScrollToPublish() {
    document
      .getElementById("publish-distribution")
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  async function handleCopyMarkdown() {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(exportMarkdown(selected))
      toast.success("已复制 Markdown 到剪贴板")
    } catch {
      toast.error("无法访问剪贴板，请使用「导出 Markdown」")
    }
  }

  function handleExportMarkdown() {
    if (!selected) return
    downloadText(
      `content-${selected.id}-v${selected.revision}.md`,
      exportMarkdown(selected)
    )
  }

  function handleBoardStatusChange(next: string | null) {
    if (!next || next === item.status) return
    const nextStatus = next as WorkItemStatus
    if (nextStatus === "done" && workflow.hasUnapprovedDocs) {
      setConfirmDoneOpen(true)
      return
    }
    void run(() => setWorkItemStatus(item, nextStatus), "看板状态已更新")
  }

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/work-items" />}>
              事项
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{item.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {item.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{workItemKindLabels[item.kind]}</Badge>
            {categoryName && <Badge variant="secondary">{categoryName}</Badge>}
            <span>更新于 {new Date(item.updated_at).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canManage ? (
            <Select
              items={workItemStatusLabels}
              value={item.status}
              disabled={busy}
              onValueChange={handleBoardStatusChange}
            >
              <SelectTrigger aria-label="看板状态" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workItemStatuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {workItemStatusLabels[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline">
              {workItemStatusLabels[item.status]}
            </Badge>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="更多操作"
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
              更多
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setBriefDialogOpen(true)}>
                <PencilIcon className="size-4" />
                {canManage ? "编辑 Brief 与设置…" : "查看 Brief 与设置…"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  downloadText(
                    `video-handoff-${item.id}.json`,
                    JSON.stringify(
                      {
                        schema_version: "1.0",
                        work_item: {
                          id: item.id,
                          title: item.title,
                          kind: item.kind,
                          brief: item.brief,
                        },
                        script: master ?? null,
                        rendering: "external",
                      },
                      null,
                      2
                    ),
                    "application/json"
                  )
                }
              >
                <FileTextIcon className="size-4" />
                导出视频交接包
              </DropdownMenuItem>
              {canManage && (
                <>
                  <DropdownMenuSeparator />
                  {item.status !== "dropped" ? (
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
                  ) : (
                    <DropdownMenuItem
                      onClick={() =>
                        void run(
                          () => setWorkItemStatus(item, "todo"),
                          "已恢复为待办"
                        )
                      }
                    >
                      <RotateCcwIcon className="size-4" />
                      重新打开
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <WorkItemStepper
        workflow={workflow}
        canManage={canManage}
        canReview={canReview}
        busy={busy}
        dirty={editorDirty}
        hasActiveDoc={Boolean(selected)}
        onCreateMasterAndDraft={() => void handleCreateMasterAndDraft()}
        onCreateMaster={() => void handleCreateMasterOnly()}
        onTriggerAiDraft={() => void handleTriggerAiDraft()}
        onStartEditing={handleStartEditing}
        onApproveDirectly={() => void handleApproveDirectly()}
        onSubmitForReview={() => void handleSubmitForReview()}
        onOpenRejectDialog={() => setRejectDialogOpen(true)}
        onScrollToPublish={handleScrollToPublish}
        onCopyMarkdown={() => void handleCopyMarkdown()}
        onExportMarkdown={handleExportMarkdown}
        onMarkDone={() =>
          void run(() => setWorkItemStatus(item, "done"), "事项已标记完成")
        }
        onReopenItem={() =>
          void run(
            () =>
              setWorkItemStatus(
                item,
                workflow.substate === "done_unapproved_mismatch" &&
                  selected?.body.trim()
                  ? "review"
                  : "todo"
              ),
            "已重新打开事项"
          )
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div id="document-editor-section" className="min-w-0 space-y-6">
          {!selected ? (
            <Card>
              <CardContent className="py-12">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SparklesIcon />
                    </EmptyMedia>
                    <EmptyTitle>开始撰写第一篇母稿</EmptyTitle>
                    <EmptyDescription>
                      在上方步骤条点击「创建并让 AI 出稿」一步生成草稿，或点击「创建母稿」建立空白文档手动写作。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {documents.map((d) => {
                    const label =
                      d.platform === "master" ? "母稿" : platforms[d.platform]
                    return (
                      <Button
                        key={d.id}
                        type="button"
                        size="sm"
                        variant={selected.id === d.id ? "default" : "outline"}
                        onClick={() => switchDocument(d.id)}
                      >
                        <span>{label}</span>
                        <Badge
                          variant={
                            selected.id === d.id ? "secondary" : "outline"
                          }
                          className="ml-1"
                        >
                          {statusLabels[d.status]} · v{d.revision}
                        </Badge>
                      </Button>
                    )
                  })}
                </div>

                {canManage && master && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || availablePlatforms.length === 0}
                        />
                      }
                    >
                      <PlusIcon className="size-4" />
                      添加平台版本
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      {availablePlatforms.map((p) => (
                        <DropdownMenuItem
                          key={p}
                          onClick={() =>
                            void run(async () => {
                              const d = await createWorkItemDocument(
                                item,
                                p,
                                master
                              )
                              switchDocument(d.id)
                            }, "已复制母稿，请按目标平台改写并定稿")
                          }
                        >
                          {platforms[p]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              <DocumentEditor
                key={selected.id}
                document={selected}
                canEdit={canManage}
                canReview={canReview}
                canPublish={canPublish}
                hideSidePanels
                viewModeOverride={editorViewMode}
                onViewModeOverrideChange={setEditorViewMode}
                rejectOpen={rejectDialogOpen}
                onRejectOpenChange={setRejectDialogOpen}
                onDirtyChange={setEditorDirty}
              />

              {showPublishSection && (
                <Card id="publish-distribution">
                  <CardHeader>
                    <CardTitle>第 3 步：发布与外部交接</CardTitle>
                    <CardDescription>
                      发布到自有读者站，或导出各平台演练包、人工发布后回填链接。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="site" className="space-y-4">
                      <TabsList>
                        <TabsTrigger value="site">读者站发布</TabsTrigger>
                        <TabsTrigger value="external">
                          外部平台与交接
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="site">
                        {selected.status === "approved" ||
                        selected.published_revision != null ||
                        Boolean(selected.published_url) ? (
                          <SitePublishPanel
                            document={selected}
                            canRequest={canManage}
                            canPublish={canPublish}
                            embedded
                          />
                        ) : (
                          <Empty className="border py-8">
                            <EmptyHeader>
                              <EmptyTitle>当前版本尚未定稿</EmptyTitle>
                              <EmptyDescription>
                                请先点击上方「确认并定稿」（或切换到已定稿的母稿/平台稿），即可发布到读者站。
                              </EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        )}
                      </TabsContent>
                      <TabsContent value="external" className="space-y-4">
                        <TextHandoff
                          item={item}
                          documents={documents}
                          embedded
                        />
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <Card>
            <CardContent className="pt-4">
              <Tabs
                value={sidebarTab}
                onValueChange={(v) =>
                  v &&
                  setUserSidebarTab(v as "ai" | "context" | "history")
                }
                className="space-y-4"
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="ai">AI 助手</TabsTrigger>
                  <TabsTrigger value="context">Brief 与素材</TabsTrigger>
                  <TabsTrigger value="history">版本记录</TabsTrigger>
                </TabsList>

                <TabsContent value="ai">
                  {selected ? (
                    <DocumentAiPanel
                      document={selected}
                      canEdit={canManage}
                      blocked={editorDirty}
                      embedded
                    />
                  ) : (
                    <Empty className="border py-8">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <SparklesIcon />
                        </EmptyMedia>
                        <EmptyTitle>尚未创建母稿</EmptyTitle>
                        <EmptyDescription>
                          点击顶部「创建并让 AI 出稿」后，可在这里调整创作要求并追踪任务进度。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </TabsContent>

                <TabsContent value="context" className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Brief 与创作参数
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setBriefDialogOpen(true)}
                      >
                        <PencilIcon className="size-3.5" />
                        {canManage ? "编辑" : "查看"}
                      </Button>
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-foreground/90">
                      {briefText || "还没有填写 Brief 说明。"}
                    </p>
                    {extras.length > 0 && (
                      <dl className="grid gap-1.5 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-[6rem_1fr]">
                        {extras.map((e) => (
                          <div key={e.key} className="contents">
                            <dt className="text-muted-foreground">{e.label}</dt>
                            <dd className="break-words whitespace-pre-wrap">
                              {e.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      来源输入（{inputs.length}）
                    </p>
                    {!inputs.length ? (
                      <Empty className="border py-6">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <InboxIcon />
                          </EmptyMedia>
                          <EmptyTitle>暂无关联来源</EmptyTitle>
                          <EmptyDescription>
                            可在收件箱中将外部文章、IM
                            消息或速记归入此事项。
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      inputs.map((input) => {
                        const url = safeUrl(input.url)
                        return (
                          <div
                            key={input.id}
                            className="space-y-1.5 rounded-lg border p-3"
                          >
                            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline">
                                {intakeSourceLabels[input.source]}
                              </Badge>
                              <span>
                                {new Date(input.created_at).toLocaleString()}
                              </span>
                            </p>
                            {input.text && (
                              <p className="line-clamp-5 text-sm break-words whitespace-pre-wrap">
                                {input.text}
                              </p>
                            )}
                            {url && (
                              <a
                                className="block text-xs break-all underline"
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {url}
                              </a>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="history">
                  {selected ? (
                    <DocumentHistoryPanel documentId={selected.id} embedded />
                  ) : (
                    <Empty className="border py-8">
                      <EmptyHeader>
                        <EmptyTitle>暂无版本记录</EmptyTitle>
                        <EmptyDescription>
                          创建母稿后，保存快照与审核记录会显示在这里。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Dialog open={briefDialogOpen} onOpenChange={setBriefDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {canManage ? "编辑 Brief 与设置" : "Brief 与设置"}
            </DialogTitle>
            <DialogDescription>
              修改后的产出形态、目标受众与核心观点会在下一次 AI 出稿时生效。
            </DialogDescription>
          </DialogHeader>
          {canManage ? (
            <WorkItemForm
              key={item.updated_at}
              initial={{
                ...workItemFormValues(item),
                updated_at: item.updated_at,
              }}
              categories={categories.data ?? []}
              busy={busy}
              onSave={async (input, baseUpdatedAt) => {
                let updatedAt: string | undefined
                const ok = await run(async () => {
                  const saved = await updateWorkItem(
                    { ...item, updated_at: baseUpdatedAt ?? item.updated_at },
                    input
                  )
                  updatedAt = saved.updated_at
                })
                if (ok) setBriefDialogOpen(false)
                return updatedAt
              }}
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap">
              {briefText || "还没有写 Brief"}
            </p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDoneOpen} onOpenChange={setConfirmDoneOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>稿件尚未定稿，确定将事项标为完成？</AlertDialogTitle>
            <AlertDialogDescription>
              改变看板状态只会移动这张卡片，不会审核通过稿件、完成 AI
              出稿任务，也无法发布到读者站。建议先回到主画布点击「确认并定稿」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>先去定稿</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDoneOpen(false)
                void run(
                  () => setWorkItemStatus(item, "done"),
                  "已将看板状态标记为完成"
                )
              }}
            >
              仍然标记完成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
