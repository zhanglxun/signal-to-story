import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClapperboardIcon, WandSparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { PublishPlanPanel } from "@/components/video-studio/publish-plan-panel"
import { ShotCard } from "@/components/video-studio/shot-card"
import { ApprovalPanel, CostLedgerPanel, type OutlineInput, OutlineSheet, ProposalPanel, TimelinePanel } from "@/components/video-studio/studio-panels"
import {
  estimateShotCostCents,
  estimateVideoJob,
  formatCents,
  planStatusLabels,
  type VideoRenderJobType,
  type VideoShot,
} from "@/contracts/video-studio"
import { useAuth } from "@/features/auth/auth-context"
import { decideApprovalRequest } from "@/services/agent-job-service"
import { videoPublishEligibility } from "@/lib/video-publish-plan"
import { listChannels, listDocuments, planPublication } from "@/services/content-service"
import { getContentWorkspace } from "@/services/content-workspace-service"
import {
  acceptStoryboardProposal,
  addVideoShot,
  currentApproval,
  deleteVideoShot,
  enqueueStoryboardJob,
  enqueueVideoJob,
  getCanApproveVideoRender,
  getPlanCostSummary,
  getVideoAssetUrls,
  listPlanApprovals,
  listPlanCostEntries,
  listPlanJobs,
  listStoryboardJobs,
  listStoryboardProposals,
  listVideoPlans,
  listVideoShots,
  moveShotOrder,
  rejectStoryboardProposal,
  reorderVideoShots,
  requestVideoRenderApproval,
  updateVideoShot,
  type VideoShotPatch,
} from "@/services/video-studio-service"

const KEY = "video-studio"
const ACTIVE = new Set(["queued", "running"])

function shotKey(s: VideoShot) {
  return [s.id, s.narration, s.visualPrompt, s.voice, s.motionMode, s.cameraMotion, s.shotSize, s.targetDurationMs, s.sfxDescription].join("|")
}

export function StoryboardsPage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)

  const workspace = useQuery({ queryKey: ["content-workspace"], queryFn: getContentWorkspace })
  const organizationId = workspace.data?.organization?.id
  const canManage = Boolean(workspace.data?.canManage)
  const enabled = Boolean(organizationId)

  const canApprove = useQuery({ queryKey: [KEY, "can-approve", organizationId, user?.id], queryFn: () => getCanApproveVideoRender(organizationId!, user!.id), enabled: enabled && Boolean(user) })
  const plans = useQuery({ queryKey: [KEY, "plans", organizationId], queryFn: () => listVideoPlans(organizationId!), enabled })
  const storyboardJobs = useQuery({
    queryKey: [KEY, "storyboard-jobs", organizationId], queryFn: () => listStoryboardJobs(organizationId!), enabled,
    refetchInterval: (q) => (q.state.data?.some((j) => ACTIVE.has(j.status)) ? 4000 : false),
  })
  const proposals = useQuery({ queryKey: [KEY, "proposals", organizationId, storyboardJobs.dataUpdatedAt], queryFn: () => listStoryboardProposals(organizationId!), enabled })

  const planId = selectedPlanId ?? plans.data?.[0]?.id ?? null
  const plan = plans.data?.find((p) => p.id === planId) ?? null
  const planEnabled = Boolean(planId)
  const jobs = useQuery({
    queryKey: [KEY, "jobs", planId], queryFn: () => listPlanJobs(planId!), enabled: planEnabled,
    refetchInterval: (q) => (q.state.data?.some((j) => ACTIVE.has(j.status)) || plan?.status === "rendering" ? 4000 : false),
  })
  const tick = jobs.dataUpdatedAt
  const shots = useQuery({ queryKey: [KEY, "shots", planId, tick], queryFn: () => listVideoShots(planId!), enabled: planEnabled })
  const approvals = useQuery({ queryKey: [KEY, "approvals", planId, plan?.revision], queryFn: () => listPlanApprovals(planId!), enabled: planEnabled })
  const summary = useQuery({ queryKey: [KEY, "summary", planId, tick, plan?.revision], queryFn: () => getPlanCostSummary(planId!), enabled: planEnabled })
  const entries = useQuery({ queryKey: [KEY, "entries", planId, tick], queryFn: () => listPlanCostEntries(planId!), enabled: planEnabled })

  const shotList = useMemo(() => shots.data ?? [], [shots.data])
  const assetIds = useMemo(() => [
    ...shotList.flatMap((s) => [s.audioAssetId, s.videoAssetId]),
    plan?.composedVideoAssetId ?? null,
  ].filter((id): id is number => id != null), [shotList, plan?.composedVideoAssetId])
  const media = useQuery({ queryKey: [KEY, "media", assetIds.join(",")], queryFn: () => getVideoAssetUrls(assetIds), enabled: assetIds.length > 0, staleTime: 5 * 60_000 })

  const docs = useQuery({ queryKey: [KEY, "publish-docs", organizationId], queryFn: () => listDocuments(organizationId!), enabled: enabled && Boolean(plan?.composedVideoAssetId) })
  const channelList = useQuery({ queryKey: [KEY, "publish-channels", organizationId], queryFn: () => listChannels(organizationId!), enabled: enabled && Boolean(plan?.composedVideoAssetId) })

  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] })
  const run = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onError: (error) => toast.error(error instanceof Error ? error.message : "操作失败"),
    onSettled: refresh,
  })
  const act = (fn: () => Promise<unknown>, success?: string) => run.mutate(async () => {
    await fn()
    if (success) toast.success(success)
  })

  const approval = plan ? currentApproval(approvals.data ?? [], plan.revision) : null
  const approvedId = approval?.status === "approved" ? approval.id : null
  const locked = plan?.status === "rendering" || shotList.some((s) => s.renderStatus === "rendering")

  const enqueue = (jobType: VideoRenderJobType, shot: VideoShot | null, label: string) => {
    if (!plan) return
    const estimate = estimateVideoJob(jobType, shotList, plan.ttsProvider, shot?.id)
    if (estimate.requiresApproval && !approvedId) {
      toast.warning(`${label}预计 ${formatCents(estimate.costCents)}，需要先获得第 ${plan.revision} 版的付费渲染批准。`)
      return
    }
    act(() => enqueueVideoJob({
      planId: plan.id, jobType, shotId: shot?.id ?? null, approvalRequestId: estimate.requiresApproval ? approvedId : null,
      idempotencyKey: `${jobType}:${plan.id}:r${plan.revision}:${shot?.id ?? "all"}:${Date.now()}`,
    }), `${label}已排队，等待视频 worker 执行`)
  }

  const onCloudReroll = (shot: VideoShot) => {
    if (!plan) return
    if (approvedId) return enqueue("video_shot_render", shot, "单镜重抽")
    if (approval?.status === "pending") return toast.info("批准请求待处理，批准后再重抽。")
    act(() => requestVideoRenderApproval(plan.id, [shot.id], "单镜重抽"), "已提交付费渲染批准请求")
  }

  const onOutline = (input: OutlineInput) => {
    if (!organizationId) return
    act(async () => {
      await enqueueStoryboardJob({ organizationId, outline: input.outline, aspectRatio: input.aspectRatio, targetSeconds: input.targetSeconds, style: input.style, defaultVoice: input.defaultVoice })
      setOutlineOpen(false)
    }, "拆解任务已排队，Agent 完成后会在此显示提案")
  }

  const header = (
    <PageHeader
      eyebrow="Video studio"
      title="分镜工作台"
      description="大纲拆解为分镜提案，采纳后逐镜编辑台词、音色与运镜；付费渲染需人工批准，本地运镜与试听免费。"
      actions={canManage ? <Button onClick={() => setOutlineOpen(true)}><WandSparklesIcon />从大纲开始</Button> : undefined}
    />
  )

  if (workspace.isLoading || plans.isLoading) return <div className="flex flex-col gap-6">{header}<Skeleton className="h-64" /></div>
  if (workspace.isError || plans.isError) {
    return <div className="flex flex-col gap-6">{header}<Alert variant="destructive"><AlertTitle>加载失败</AlertTitle><AlertDescription>{String((workspace.error ?? plans.error) instanceof Error ? (workspace.error ?? plans.error)?.message : "请稍后重试")}</AlertDescription></Alert></div>
  }
  if (!organizationId) return <div className="flex flex-col gap-6">{header}<Alert><AlertTitle>账号尚未加入组织</AlertTitle><AlertDescription>请先完成组织初始化。</AlertDescription></Alert></div>

  return (
    <div className="flex flex-col gap-6">
      {header}
      <OutlineSheet open={outlineOpen} onOpenChange={setOutlineOpen} onSubmit={onOutline} busy={run.isPending} />

      <ProposalPanel
        proposals={proposals.data ?? []}
        jobs={storyboardJobs.data ?? []}
        canManage={canManage}
        busy={run.isPending}
        onAccept={(id) => act(async () => setSelectedPlanId(await acceptStoryboardProposal(id)), "已采纳为正式分镜")}
        onReject={(id, reason) => act(() => rejectStoryboardProposal(id, reason), "已退回提案")}
      />

      {!plan ? (
        <Empty className="min-h-72 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ClapperboardIcon /></EmptyMedia>
            <EmptyTitle>还没有分镜</EmptyTitle>
            <EmptyDescription>从一段大纲开始：Agent 按视频 SOP 拆解分镜提案，你确认采纳后即可逐镜编辑、试听与渲染。</EmptyDescription>
          </EmptyHeader>
          {canManage ? <EmptyContent><Button onClick={() => setOutlineOpen(true)}><WandSparklesIcon />从大纲开始</Button></EmptyContent> : null}
        </Empty>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3">
              <NativeSelect aria-label="选择分镜计划" value={plan.id} onChange={(e) => setSelectedPlanId(e.target.value)}>
                {(plans.data ?? []).map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.title}</NativeSelectOption>)}
              </NativeSelect>
              <Badge variant="outline">第 {plan.revision} 版</Badge>
              <Badge variant={plan.status === "rendered" ? "default" : "secondary"}>{planStatusLabels[plan.status]}</Badge>
              <span className="text-sm text-muted-foreground">{plan.aspectRatio} · 目标 {plan.targetSeconds}s · 配音 {plan.ttsProvider === "edge_tts" ? "Edge TTS（免费）" : "云端 TTS（付费）"}</span>
              {locked ? <span className="text-sm text-muted-foreground">渲染中，分镜已锁定</span> : null}
            </CardContent>
          </Card>

          <ApprovalPanel
            plan={plan}
            approval={approval}
            canManage={canManage}
            canApprove={Boolean(canApprove.data)}
            busy={run.isPending}
            onRequest={() => act(() => requestVideoRenderApproval(plan.id), "已提交付费渲染批准请求")}
            onDecide={(decision) => approval && act(() => decideApprovalRequest(approval.id, decision, decision === "rejected" ? "人工拒绝" : ""), decision === "approved" ? "已批准" : "已拒绝")}
          />

          <div className="space-y-4">
            {shots.isLoading ? <Skeleton className="h-48" /> : null}
            {shotList.map((shot, index) => (
              <ShotCard
                key={shotKey(shot)}
                shot={shot}
                index={index}
                total={shotList.length}
                defaultVoice={plan.defaultVoice}
                locked={locked}
                canManage={canManage}
                busy={run.isPending}
                cloudCostCents={estimateShotCostCents(shot, plan.ttsProvider, { tts: shot.audioAssetId == null, video: true })}
                media={{
                  audioUrl: shot.audioAssetId ? media.data?.[shot.audioAssetId]?.url : null,
                  videoUrl: shot.videoAssetId ? media.data?.[shot.videoAssetId]?.url : null,
                  videoPlaceholder: shot.videoAssetId ? media.data?.[shot.videoAssetId]?.mediaType !== "video" : false,
                }}
                onSave={(patch: VideoShotPatch) => act(() => updateVideoShot(shot.id, patch), "已保存，分镜版本 +1")}
                onMove={(direction) => {
                  const order = moveShotOrder(shotList, shot.id, direction)
                  if (order) act(() => reorderVideoShots(plan.id, order))
                }}
                onDelete={() => act(() => deleteVideoShot(shot.id), "已删除镜头")}
                onInsertAfter={() => user && act(() => addVideoShot({ organizationId, planId: plan.id, userId: user.id, afterPosition: index + 1, shots: shotList, narration: "", targetDurationMs: 3000 }), "已插入新镜头")}
                onPreviewTts={() => enqueue("video_tts_preview", shot, "配音试听")}
                onLocalPreview={() => enqueue("video_shot_render", shot, "本地运镜预览")}
                onCloudReroll={() => onCloudReroll(shot)}
              />
            ))}
          </div>

          <TimelinePanel
            plan={plan}
            shots={shotList}
            canManage={canManage}
            busy={run.isPending}
            finalUrl={plan.composedVideoAssetId ? media.data?.[plan.composedVideoAssetId]?.url ?? null : null}
            finalPlaceholder={plan.composedVideoAssetId ? media.data?.[plan.composedVideoAssetId]?.mediaType !== "video" : false}
            composeLabel={(() => {
              const e = estimateVideoJob("video_compose", shotList, plan.ttsProvider)
              return e.requiresApproval ? `一键合成成片 · 约 ${formatCents(e.costCents)}（需批准）` : "一键合成成片（免费）"
            })()}
            onCompose={() => enqueue("video_compose", null, "全片合成")}
          />

          <PublishPlanPanel
            eligibility={videoPublishEligibility({ projectId: plan.projectId, composedVideoAssetId: plan.composedVideoAssetId, documents: docs.data ?? [], channels: channelList.data ?? [] })}
            canPublish={Boolean(workspace.data?.canPublish)}
            busy={run.isPending}
            onPlan={({ documentId, channelId, scheduledAt }) => {
              const document = docs.data?.find((d) => d.id === documentId)
              if (document) act(() => planPublication(document, channelId, scheduledAt, plan.composedVideoAssetId), "已加入发布计划，可在发布管理中查看")
            }}
          />

          <CostLedgerPanel summary={summary.data ?? null} entries={entries.data ?? []} jobs={jobs.data ?? []} />
        </>
      )}
    </div>
  )
}
