import { useId, useState, type KeyboardEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2Icon,
  Columns2Icon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  Maximize2Icon,
  PencilIcon,
  SparklesIcon,
} from "lucide-react"
import { toast } from "sonner"

import { DocumentAiPanel } from "@/components/content/document-ai-panel"
import { DocumentHistoryPanel } from "@/components/content/document-history-panel"
import { MarkdownPreview } from "@/components/content/markdown-preview"
import { SitePublishPanel } from "@/components/content/site-publish-panel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  canTransition,
  exportMarkdown,
  platforms,
  statusLabels,
  type ContentDocument,
  type DocumentStatus,
} from "@/contracts/content"
import { downloadText, useContentAction } from "@/hooks/use-content-action"
import { useDocumentDraftJobs } from "@/hooks/use-document-draft-jobs"
import { shouldDefaultToPreview } from "@/lib/work-item-workflow"
import {
  approveDocumentDirectly,
  reviewDocument,
  saveDocument,
} from "@/services/content-service"

export type DocumentViewMode = "preview" | "edit" | "split"

export function DocumentEditor({
  document,
  canEdit,
  canReview,
  canPublish = false,
  hideSidePanels = false,
  viewModeOverride,
  onViewModeOverrideChange,
  rejectOpen: controlledRejectOpen,
  onRejectOpenChange: onControlledRejectOpenChange,
  onDirtyChange,
}: {
  document: ContentDocument
  canEdit: boolean
  canReview: boolean
  canPublish?: boolean
  hideSidePanels?: boolean
  viewModeOverride?: DocumentViewMode | null
  onViewModeOverrideChange?: (mode: DocumentViewMode) => void
  rejectOpen?: boolean
  onRejectOpenChange?: (open: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const queryClient = useQueryClient()
  const titleId = useId()
  const bodyId = useId()
  const noteId = useId()
  const rejectNoteId = useId()

  const [edits, setEdits] = useState<{
    baseRevision: number
    title: string
    body: string
  } | null>(null)
  const [internalViewMode, setInternalViewMode] =
    useState<DocumentViewMode | null>(null)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const [internalRejectOpen, setInternalRejectOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState("")
  const { busy, run } = useContentAction()

  const draftJobs = useDocumentDraftJobs(document)

  const title = edits ? edits.title : document.title
  const body = edits ? edits.body : document.body
  const dirty =
    edits !== null &&
    (edits.title !== document.title || edits.body !== document.body)
  const stale = edits !== null && edits.baseRevision !== document.revision

  const defaultViewMode: DocumentViewMode = shouldDefaultToPreview(
    document,
    draftJobs.data
  )
    ? "preview"
    : "edit"

  const chosenViewMode =
    viewModeOverride !== undefined ? viewModeOverride : internalViewMode
  const viewMode: DocumentViewMode =
    edits !== null && chosenViewMode === null
      ? "edit"
      : (chosenViewMode ?? defaultViewMode)

  const rejectDialogOpen =
    controlledRejectOpen !== undefined
      ? controlledRejectOpen
      : internalRejectOpen

  function setRejectDialogOpen(next: boolean) {
    if (onControlledRejectOpenChange) {
      onControlledRejectOpenChange(next)
    } else {
      setInternalRejectOpen(next)
    }
  }

  function handleSelectViewMode(next: DocumentViewMode) {
    if (onViewModeOverrideChange) {
      onViewModeOverrideChange(next)
    } else {
      setInternalViewMode(next)
    }
  }

  function commitEdits(
    next: { baseRevision: number; title: string; body: string } | null
  ) {
    setEdits(next)
    const nextDirty =
      next !== null &&
      (next.title !== document.title || next.body !== document.body)
    onDirtyChange?.(nextDirty)
  }

  function updateDraftField(nextTitle: string, nextBody: string) {
    if (
      nextTitle === document.title &&
      nextBody === document.body &&
      (!edits || edits.baseRevision === document.revision)
    ) {
      commitEdits(null)
      return
    }
    commitEdits({
      baseRevision: edits?.baseRevision ?? document.revision,
      title: nextTitle,
      body: nextBody,
    })
  }

  async function saveCurrentEdits() {
    const ok = await run(async () => {
      await saveDocument(document, title, body)
      commitEdits(null)
    })
    if (ok) {
      await queryClient.invalidateQueries({
        queryKey: ["agent-jobs", "document", document.id],
      })
    }
  }

  function handleEditorKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault()
      if (canEdit && dirty && !stale && !busy) {
        void saveCurrentEdits()
      }
    }
  }

  async function transition(status: DocumentStatus) {
    await run(async () => {
      await reviewDocument(document, status, note)
      setNote("")
      if (status === "changes_requested") setRejectDialogOpen(false)
    }, "审核状态已更新")
  }

  async function handleDirectApprove() {
    await run(async () => {
      await approveDocumentDirectly(document, note)
      setNote("")
      setFullscreenOpen(false)
    }, "稿件已确认定稿，已解锁发布与导出")
  }

  async function handleCopyMarkdown() {
    try {
      await navigator.clipboard.writeText(exportMarkdown(document))
      toast.success("已复制 Markdown 到剪贴板")
    } catch {
      toast.error("无法访问剪贴板，请使用「导出 Markdown」")
    }
  }

  const canDirectApprove =
    canEdit &&
    canReview &&
    (document.status === "draft" || document.status === "changes_requested")

  const docLabel =
    document.platform === "master" ? "母稿" : platforms[document.platform]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{docLabel}</span>
            <Badge variant="outline">v{document.revision}</Badge>
            <Badge
              variant={
                document.status === "approved"
                  ? "secondary"
                  : document.status === "changes_requested"
                    ? "destructive"
                    : "default"
              }
            >
              {statusLabels[document.status]}
            </Badge>
          </CardTitle>
          <CardAction className="flex flex-wrap items-center gap-2">
            <Tabs
              value={viewMode}
              onValueChange={(v) => {
                if (v === "preview" || v === "edit" || v === "split") {
                  handleSelectViewMode(v)
                }
              }}
            >
              <TabsList>
                <TabsTrigger value="preview">
                  <EyeIcon className="size-3.5" />
                  阅读预览
                </TabsTrigger>
                <TabsTrigger value="edit">
                  <PencilIcon className="size-3.5" />
                  编辑原文
                </TabsTrigger>
                <TabsTrigger value="split" className="hidden lg:inline-flex">
                  <Columns2Icon className="size-3.5" />
                  双栏对照
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="全屏阅读"
              onClick={() => setFullscreenOpen(true)}
            >
              <Maximize2Icon className="size-4" />
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4" onKeyDown={handleEditorKeyDown}>
          {stale && (
            <Alert>
              <AlertDescription>
                云端稿件已变化，当前输入仍保留。请先复制需要保留的内容，再载入云端版本。
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2"
                  onClick={() => commitEdits(null)}
                >
                  载入云端版本
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {document.review_note && (
            <Alert>
              <AlertDescription>
                最近审核意见：{document.review_note}
              </AlertDescription>
            </Alert>
          )}

          {viewMode === "preview" && (
            <div className="space-y-4">
              <MarkdownPreview body={body} title={title} showMeta />
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleSelectViewMode("edit")}
                  >
                    <PencilIcon className="size-3.5" />
                    编辑标题或正文
                  </Button>
                </div>
              )}
            </div>
          )}

          {viewMode === "edit" && (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={titleId}>稿件标题</FieldLabel>
                <Input
                  id={titleId}
                  maxLength={200}
                  value={title}
                  disabled={!canEdit || busy}
                  onChange={(e) => updateDraftField(e.target.value, body)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={bodyId}>正文（Markdown）</FieldLabel>
                <Textarea
                  id={bodyId}
                  className="min-h-96 font-mono text-sm leading-7"
                  maxLength={100000}
                  value={body}
                  disabled={!canEdit || busy}
                  onChange={(e) => updateDraftField(title, e.target.value)}
                />
              </Field>
            </FieldGroup>
          )}

          {viewMode === "split" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={titleId}>稿件标题</FieldLabel>
                  <Input
                    id={titleId}
                    maxLength={200}
                    value={title}
                    disabled={!canEdit || busy}
                    onChange={(e) => updateDraftField(e.target.value, body)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={bodyId}>正文（Markdown）</FieldLabel>
                  <Textarea
                    id={bodyId}
                    className="min-h-96 font-mono text-sm leading-7"
                    maxLength={100000}
                    value={body}
                    disabled={!canEdit || busy}
                    onChange={(e) => updateDraftField(title, e.target.value)}
                  />
                </Field>
              </FieldGroup>
              <div className="max-h-[34rem] overflow-y-auto rounded-lg border bg-muted/20 p-4">
                <MarkdownPreview body={body} title={title} showMeta />
              </div>
            </div>
          )}

          {(canDirectApprove ||
            canTransition(document.status, "in_review", canEdit, canReview) ||
            (canReview && document.status === "in_review")) && (
            <Collapsible
              open={noteOpen}
              onOpenChange={setNoteOpen}
              className="space-y-3 border-t pt-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                {canDirectApprove && (
                  <Button
                    disabled={busy || dirty || stale || !body.trim()}
                    onClick={() => void handleDirectApprove()}
                  >
                    <CheckCircle2Icon className="size-4" />
                    确认并定稿
                  </Button>
                )}

                {canTransition(document.status, "in_review", canEdit, canReview) && (
                  <Button
                    variant={canDirectApprove ? "outline" : "default"}
                    disabled={busy || dirty || stale || !body.trim()}
                    onClick={() => void transition("in_review")}
                  >
                    提交审核
                  </Button>
                )}

                {canReview && document.status === "in_review" && (
                  <>
                    <Button
                      disabled={busy || dirty || stale}
                      onClick={() => void transition("approved")}
                    >
                      <CheckCircle2Icon className="size-4" />
                      审核通过
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || dirty || stale}
                      onClick={() => setRejectDialogOpen(true)}
                    >
                      退回修改
                    </Button>
                  </>
                )}

                {canReview && (
                  <CollapsibleTrigger
                    render={<Button type="button" variant="ghost" size="sm" />}
                  >
                    <SparklesIcon className="size-3.5" />
                    {noteOpen ? "收起备注与偏好" : "附带审核备注 / 记入偏好"}
                  </CollapsibleTrigger>
                )}
              </div>

              {canReview && (
                <CollapsibleContent className="space-y-3 pt-1">
                  <Field>
                    <FieldLabel htmlFor={noteId}>审核意见（可选）</FieldLabel>
                    <Textarea
                      id={noteId}
                      value={note}
                      maxLength={4000}
                      rows={2}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="记录本次审核关注点或亮点"
                    />
                  </Field>
                </CollapsibleContent>
              )}
            </Collapsible>
          )}
        </CardContent>

        <CardFooter className="flex-wrap justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (viewMode !== "preview" || dirty) && (
              <Button
                disabled={busy || !dirty || stale}
                onClick={() => void saveCurrentEdits()}
              >
                保存新版本
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {dirty ? "有未保存修改" : "已保存到云端"} · 改稿后需要重新审核
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={dirty || stale || !body.trim()}
              onClick={() => void handleCopyMarkdown()}
            >
              <CopyIcon className="size-4" />
              复制 Markdown
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={dirty || stale}
              onClick={() =>
                downloadText(
                  `content-${document.id}-v${document.revision}.md`,
                  exportMarkdown(document)
                )
              }
            >
              <DownloadIcon className="size-4" />
              导出 Markdown
            </Button>
          </div>
        </CardFooter>
      </Card>

      {!hideSidePanels && (
        <>
          {!stale && (
            <SitePublishPanel
              document={document}
              canRequest={canEdit}
              canPublish={canPublish}
            />
          )}
          <DocumentAiPanel
            document={document}
            canEdit={canEdit}
            blocked={dirty || stale}
          />
          <DocumentHistoryPanel documentId={document.id} />
        </>
      )}

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span>{title || docLabel}</span>
              <Badge variant="outline">
                {docLabel} · v{document.revision}
              </Badge>
              <Badge variant="secondary">{statusLabels[document.status]}</Badge>
            </DialogTitle>
            <DialogDescription>
              成稿排版阅读视图（支持核对内容后再直接定稿或复制导出）
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <MarkdownPreview body={body} showMeta />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={dirty || stale || !body.trim()}
              onClick={() => void handleCopyMarkdown()}
            >
              <CopyIcon className="size-4" />
              复制 Markdown
            </Button>
            {(canDirectApprove || (canReview && document.status === "in_review")) && (
              <Button
                type="button"
                disabled={busy || dirty || stale || !body.trim()}
                onClick={() => void handleDirectApprove()}
              >
                <CheckCircle2Icon className="size-4" />
                确认并定稿
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>退回修改</DialogTitle>
            <DialogDescription>
              数据库要求退回修改时必须填写原因；也可勾选记入长期创作偏好，避免 AI
              下次重犯。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor={rejectNoteId}>退回原因</FieldLabel>
              <Textarea
                id={rejectNoteId}
                value={note}
                maxLength={4000}
                rows={4}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：第 2 节缺少具体案例支撑，请补充实际场景说明"
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || dirty || stale || !note.trim()}
              onClick={() => void transition("changes_requested")}
            >
              确认退回修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
