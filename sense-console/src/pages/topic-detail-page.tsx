import { useQuery } from "@tanstack/react-query"
import { ExternalLinkIcon, PencilIcon, Trash2Icon } from "lucide-react"
import { useNavigate, useParams } from "react-router"

import { DetailLayout } from "@/components/detail-layout"
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { SelectionDialog } from "@/components/topics/selection-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { selectionPriorityLabels } from "@/contracts/selection"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { deleteSelection, getSelection } from "@/services/selection-service"
import { getSignalOptions } from "@/services/signal-service"

const workspaceKey = ["content-workspace"] as const

export function TopicDetailPage() {
  const { topicId } = useParams()
  const navigate = useNavigate()
  const numericId = Number(topicId)
  const isValidId = Number.isSafeInteger(numericId) && numericId > 0

  const workspaceQuery = useQuery({ queryKey: workspaceKey, queryFn: getContentWorkspace })
  const organizationId = workspaceQuery.data?.organization?.id
  const canManage = Boolean(workspaceQuery.data?.canManage)

  const query = useQuery({
    queryKey: ["selection", numericId],
    queryFn: () => getSelection(numericId),
    enabled: isValidId,
  })

  const signalOptionsQuery = useQuery({
    queryKey: ["signal-options", organizationId],
    queryFn: () => getSignalOptions(organizationId!),
    enabled: Boolean(organizationId),
  })

  if (!isValidId) return <Alert variant="destructive"><AlertTitle>选题编号无效</AlertTitle><AlertDescription>请返回选题列表重新选择。</AlertDescription></Alert>
  if (query.isLoading) return <p className="text-sm text-muted-foreground">正在加载选题详情…</p>
  if (query.isError) return <Alert variant="destructive"><AlertTitle>无法加载选题</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert>
  if (!query.data) return <Alert><AlertTitle>选题不存在</AlertTitle><AlertDescription>该选题可能不属于当前组织，或已经被删除。</AlertDescription></Alert>

  const selection = query.data
  const signalOptions = signalOptionsQuery.data ?? []

  const actions = organizationId && (canManage || selection.signalName) ? <>
    {canManage && <SelectionDialog organizationId={organizationId} selection={selection} signalOptions={signalOptions} trigger={<Button variant="outline"><PencilIcon />编辑选题</Button>} />}
    {canManage && (
      <ConfirmDeleteDialog
        trigger={<Button variant="outline"><Trash2Icon />删除选题</Button>}
        title={`删除选题"${selection.name}"？`}
        description="删除后不可恢复。"
        mutationFn={() => deleteSelection(selection.id, organizationId).then(() => navigate("/topics"))}
        invalidateKeys={[["selections"]]}
        successMessage="选题已删除。"
      />
    )}
  </> : undefined

  return (
    <DetailLayout
      backTo="/topics"
      backLabel="返回选题"
      eyebrow={`#${selection.id} · ${selection.signalName ?? `信息 #${selection.signalId}`}`}
      title={selection.name}
      status={selection.isCompleted ? "已完成" : "未完成"}
      description={selection.coreThesis || "暂无核心论点。"}
      actions={actions}
      facts={[
        { label: "优先级", value: selectionPriorityLabels[selection.priority] },
        { label: "切入角度", value: selection.angleType || "未填写" },
        { label: "内容形式", value: selection.contentFormat || "未填写" },
        { label: "关联信息", value: selection.signalName ?? `#${selection.signalId}` },
        { label: "更新时间", value: new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selection.updatedAt)) },
      ]}
    >
      <Card>
        <CardHeader className="border-b"><CardTitle>预设结构大纲</CardTitle></CardHeader>
        <CardContent>
          {selection.outlineTemplate.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚未设置大纲模板。</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {selection.outlineTemplate.map((item, index) => (
                <li key={index} className="flex gap-3"><span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><span>{item.title}</span></li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="border-b"><CardTitle>内容禁忌 / 负向约束</CardTitle></CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">{selection.negativePrompts || "暂无。"}</CardContent>
      </Card>
      {selection.description && (
        <Card>
          <CardHeader className="border-b"><CardTitle>描述</CardTitle></CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">{selection.description}</CardContent>
        </Card>
      )}
      <Badge variant="outline" className="w-fit"><ExternalLinkIcon />关联信息 ID：{selection.signalId}</Badge>
    </DetailLayout>
  )
}
