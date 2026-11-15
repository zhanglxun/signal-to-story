import { useState } from "react"
import { CheckIcon, FilmIcon, ShieldCheckIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type { AgentJob, ApprovalRequest } from "@/contracts/agent-job"
import {
  aspectRatios,
  formatCents,
  motionModeLabels,
  shotRenderStatusLabels,
  type AspectRatio,
  type VideoCostEntry,
  type VideoCostSummary,
  type VideoPlan,
  type VideoShot,
  type VideoStoryboardProposal,
  videoJobTypeLabels,
  VOICE_OPTIONS,
} from "@/contracts/video-studio"

const jobStatusLabels: Record<string, string> = {
  queued: "排队中", running: "执行中", pending_review: "待人工采纳", blocked_needs_human: "需人工处理", succeeded: "已完成", failed: "失败", cancelled: "已取消",
}
const approvalStatusLabels: Record<ApprovalRequest["status"], string> = { pending: "待批准", approved: "已批准", rejected: "已拒绝", expired: "已失效" }

export interface OutlineInput {
  outline: string
  aspectRatio: AspectRatio
  targetSeconds: number
  style: string
  defaultVoice: string
}

export function OutlineSheet({ open, onOpenChange, onSubmit, busy }: { open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (input: OutlineInput) => void; busy?: boolean }) {
  const [form, setForm] = useState<OutlineInput>({ outline: "", aspectRatio: "9:16", targetSeconds: 30, style: "", defaultVoice: VOICE_OPTIONS[0].value })
  const valid = form.outline.trim().length >= 10
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>从大纲开始</SheetTitle>
          <SheetDescription>输入灵感或大纲，Agent 按视频 SOP 拆解为分镜提案；提案需要你采纳后才会成为正式分镜。</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4">
          <div className="space-y-1.5">
            <Label htmlFor="outline-text">大纲 / 灵感</Label>
            <Textarea id="outline-text" rows={8} maxLength={20000} value={form.outline} onChange={(e) => setForm({ ...form, outline: e.target.value })} placeholder="例如：一只橘猫在月球上开了第一家面包店……" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="outline-aspect">画幅</Label>
              <NativeSelect id="outline-aspect" className="w-full" value={form.aspectRatio} onChange={(e) => setForm({ ...form, aspectRatio: e.target.value as AspectRatio })}>
                {aspectRatios.map((a) => <NativeSelectOption key={a} value={a}>{a}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outline-seconds">目标时长（秒）</Label>
              <Input id="outline-seconds" type="number" min={3} max={600} value={form.targetSeconds} onChange={(e) => setForm({ ...form, targetSeconds: Math.min(600, Math.max(3, Number(e.target.value) || 30)) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outline-voice">默认音色</Label>
              <NativeSelect id="outline-voice" className="w-full" value={form.defaultVoice} onChange={(e) => setForm({ ...form, defaultVoice: e.target.value })}>
                {VOICE_OPTIONS.map((v) => <NativeSelectOption key={v.value} value={v.value}>{v.label}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outline-style">风格</Label>
              <Input id="outline-style" value={form.style} maxLength={1000} onChange={(e) => setForm({ ...form, style: e.target.value })} placeholder="如：温暖 3D 绘本" />
            </div>
          </div>
        </div>
        <SheetFooter>
          <Button disabled={!valid || busy} onClick={() => onSubmit(form)}>提交拆解任务</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function ProposalPanel({ proposals, jobs, canManage, busy, onAccept, onReject }: {
  proposals: VideoStoryboardProposal[]
  jobs: AgentJob[]
  canManage: boolean
  busy?: boolean
  onAccept: (id: string) => void
  onReject: (id: string, reason: string) => void
}) {
  const active = jobs.filter((j) => ["queued", "running", "blocked_needs_human", "failed"].includes(j.status)).slice(0, 3)
  if (proposals.length === 0 && active.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>分镜提案</CardTitle>
        <CardDescription>Agent 只产出提案；采纳后才写入正式分镜。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {active.map((j) => (
          <p key={j.id} className="text-sm text-muted-foreground">
            拆解任务 {j.id.slice(0, 8)} · {jobStatusLabels[j.status] ?? j.status}{j.error ? ` · ${j.error}` : ""}
          </p>
        ))}
        {proposals.map((p) => (
          <div key={p.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{p.proposal?.title ?? "（提案格式无效）"}</span>
              <span className="text-xs text-muted-foreground">{p.proposal ? `${p.proposal.shots.length} 镜 · ${p.proposal.aspect_ratio} · ${p.proposal.target_seconds}s` : ""}</span>
            </div>
            {p.proposal ? (
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                {p.proposal.shots.map((s, i) => <li key={i}>{s.narration || "（无旁白）"} <span className="text-xs">· {motionModeLabels[s.motion_mode]}</span></li>)}
              </ol>
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" disabled={!canManage || busy || !p.proposal} onClick={() => onAccept(p.id)}><CheckIcon />采纳为分镜</Button>
              <Button size="sm" variant="outline" disabled={!canManage || busy} onClick={() => onReject(p.id, "人工退回")}><XIcon />退回</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function ApprovalPanel({ plan, approval, canManage, canApprove, busy, onRequest, onDecide }: {
  plan: VideoPlan
  approval: ApprovalRequest | null
  canManage: boolean
  canApprove: boolean
  busy?: boolean
  onRequest: () => void
  onDecide: (decision: "approved" | "rejected") => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheckIcon className="size-4" />付费渲染批准</CardTitle>
        <CardDescription>云端视频模型、或估算超过 ¥0.10 的任务，必须有针对第 {plan.revision} 版的人工批准；数据库强制，改分镜后旧批准自动失效。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {approval ? (
          <>
            <Badge variant={approval.status === "approved" ? "default" : "secondary"}>{approvalStatusLabels[approval.status]}</Badge>
            <span className="text-sm text-muted-foreground">{approval.summary}</span>
            {approval.estimatedCostCents != null ? <span className="text-sm">额度 {formatCents(approval.estimatedCostCents)}</span> : null}
            {approval.status === "pending" ? (
              <>
                <Button size="sm" disabled={!canApprove || busy} onClick={() => onDecide("approved")}>批准</Button>
                <Button size="sm" variant="outline" disabled={!canApprove || busy} onClick={() => onDecide("rejected")}>拒绝</Button>
                {!canApprove ? <span className="text-xs text-muted-foreground">需要 agent.approve 权限的成员批准</span> : null}
              </>
            ) : null}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">当前版本没有批准请求。</span>
        )}
        {!approval || approval.status !== "pending" ? (
          <Button size="sm" variant="outline" disabled={!canManage || busy} onClick={onRequest}>请求批准</Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function TimelinePanel({ plan, shots, finalUrl, finalPlaceholder, onCompose, composeLabel, busy, canManage }: {
  plan: VideoPlan
  shots: VideoShot[]
  finalUrl: string | null
  finalPlaceholder: boolean
  onCompose: () => void
  composeLabel: string
  busy?: boolean
  canManage: boolean
}) {
  const total = shots.reduce((sum, s) => sum + (s.actualDurationMs != null ? s.actualDurationMs + 300 : s.targetDurationMs), 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FilmIcon className="size-4" />时间线与成片</CardTitle>
        <CardDescription>旁白为主时钟（Audio-First）：画面时长 = 旁白真实时长 + 0.3 秒。预计总长 {(total / 1000).toFixed(1)} 秒。BGM：{plan.bgmTrack ? plan.bgmTrack : "未设置（合成时不混入）"}。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>镜</TableHead><TableHead>旁白轨</TableHead><TableHead>SFX 轨</TableHead><TableHead>画面</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {shots.map((s, i) => (
                <TableRow key={s.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{s.audioAssetId ? `已配音 ${((s.actualDurationMs ?? 0) / 1000).toFixed(1)}s` : s.narration.trim() ? "待配音" : "无旁白"}</TableCell>
                  <TableCell>{s.sfxDescription || "—"}</TableCell>
                  <TableCell>{shotRenderStatusLabels[s.renderStatus]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!canManage || busy || shots.length === 0 || plan.status === "rendering"} onClick={onCompose}>{composeLabel}</Button>
          {plan.status === "rendering" ? <span className="text-sm text-muted-foreground">合成中，分镜已锁定…</span> : null}
          {plan.error ? <span className="text-sm text-destructive">{plan.error}</span> : null}
        </div>
        {finalUrl && !finalPlaceholder ? (
          <video src={finalUrl} controls className="max-h-[480px] w-full rounded-lg border bg-muted" aria-label="成片播放器" />
        ) : plan.composedVideoAssetId ? (
          <p className="text-sm text-muted-foreground">{finalPlaceholder ? "成片为 dry-run 占位文件（本机无 ffmpeg 或未调用真实引擎）。" : "成片链接生成中…"}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function CostLedgerPanel({ summary, entries, jobs }: { summary: VideoCostSummary | null; entries: VideoCostEntry[]; jobs: AgentJob[] }) {
  const kindLabels: Record<VideoCostEntry["kind"], string> = { tts: "配音", shot_render: "单镜渲染", compose: "合成", keyframe: "关键帧", storyboard_llm: "大纲拆解" }
  return (
    <Card>
      <CardHeader>
        <CardTitle>成本账本</CardTitle>
        <CardDescription>
          {summary ? `估算 ${formatCents(summary.estimatedCents)} · 实际 ${formatCents(summary.actualCents)} · ${summary.renderedCount}/${summary.shotCount} 镜已渲染 · 云端镜头 ${summary.cloudShotCount}` : "暂无成本数据"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>类型</TableHead><TableHead>提供方</TableHead><TableHead>估算</TableHead><TableHead>实际</TableHead></TableRow></TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}><TableCell>{kindLabels[e.kind]}</TableCell><TableCell>{e.provider}</TableCell><TableCell>{formatCents(e.estimatedCents)}</TableCell><TableCell>{formatCents(e.actualCents)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        {jobs.length > 0 ? (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {jobs.slice(0, 8).map((j) => (
              <li key={j.id}>{videoJobTypeLabels[j.jobType as keyof typeof videoJobTypeLabels] ?? j.jobType} · {jobStatusLabels[j.status] ?? j.status}{j.errorCode ? ` (${j.errorCode})` : ""}</li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
