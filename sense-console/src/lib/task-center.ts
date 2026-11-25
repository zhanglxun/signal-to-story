import type { AgentJob, AgentJobStatus, AgentJobStep, ApprovalAction, ApprovalRequest } from "@/contracts/agent-job"

export type TaskGroupKey = "review" | "decide" | "failed" | "active" | "done"

export type TaskStatusTab =
  | "all"
  | "active"
  | "pending_review"
  | "blocked_needs_human"
  | "failed"
  | "succeeded"
  | "cancelled"

export const TASK_STATUS_TABS: ReadonlyArray<{
  key: TaskStatusTab
  label: string
  statuses: readonly AgentJobStatus[] | null
}> = [
  { key: "all", label: "全部", statuses: null },
  { key: "active", label: "进行中", statuses: ["queued", "running"] },
  { key: "pending_review", label: "待审核", statuses: ["pending_review"] },
  { key: "blocked_needs_human", label: "待拍板", statuses: ["blocked_needs_human"] },
  { key: "failed", label: "失败", statuses: ["failed"] },
  { key: "succeeded", label: "已完成", statuses: ["succeeded"] },
  { key: "cancelled", label: "已取消", statuses: ["cancelled"] },
]

export function matchesStatusTab(job: Pick<AgentJob, "status">, tab: TaskStatusTab): boolean {
  const def = TASK_STATUS_TABS.find((t) => t.key === tab)
  if (!def || def.statuses === null) return true
  return def.statuses.includes(job.status)
}

const HASH_TO_STATUS_TAB: Record<string, TaskStatusTab> = {
  "#group-review": "pending_review",
  "#group-decide": "blocked_needs_human",
  "#group-failed": "failed",
  "#group-active": "active",
  "#group-done": "succeeded",
}

export function resolveInitialStatusTab(hash: string, statusParam: string | null): TaskStatusTab {
  if (statusParam && TASK_STATUS_TABS.some((t) => t.key === statusParam)) {
    return statusParam as TaskStatusTab
  }
  return HASH_TO_STATUS_TAB[hash] ?? "all"
}

export const JOB_KIND_LABEL: Record<string, string> = {
  content_draft: "AI 出稿",
  evaluate: "质量评估",
  video_storyboard: "视频分镜",
  video_tts_preview: "配音试听",
  video_shot_render: "镜头渲染",
  video_compose: "视频合成",
  publish_site: "读者站发布",
  publish_external: "外部发布",
  chat_turn: "对话回合",
}

export function getJobKindLabel(kind: string): string {
  return JOB_KIND_LABEL[kind] ?? kind
}

export const APPROVAL_ACTION_LABEL: Record<ApprovalAction, string> = {
  publish_external: "外部发布",
  publish_site: "读者站发布",
  paid_video_render: "付费视频渲染",
  rotate_credentials: "轮换凭证",
  delete_project: "删除项目",
  change_org_permissions: "变更组织权限",
}

export function canRetryJob(job: Pick<AgentJob, "status">): boolean {
  return job.status === "failed" || job.status === "cancelled"
}

export function retriedFromJobId(job: Pick<AgentJob, "payload" | "idempotencyKey">): string | null {
  if (typeof job.payload.retry_of === "string" && job.payload.retry_of) {
    return job.payload.retry_of
  }
  const match = job.idempotencyKey.match(/^retry:([^:]+):/)
  return match ? match[1] : null
}

/** Map each original job id to its newest retried job, sorted by createdAt descending. */
export function buildRetryMap(jobs: readonly AgentJob[]): Map<string, AgentJob> {
  const map = new Map<string, AgentJob>()
  const sorted = [...jobs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  for (const job of sorted) {
    const sourceId = retriedFromJobId(job)
    if (sourceId && !map.has(sourceId)) {
      map.set(sourceId, job)
    }
  }
  return map
}

export function getJobDisplayTitle(job: AgentJob, target?: { title: string } | null): string {
  if (target?.title?.trim()) return target.title.trim()
  if (job.kind === "video_storyboard" && typeof job.payload.outline === "string") {
    const line = job.payload.outline.trim().replace(/\s+/g, " ")
    if (line) return line.length > 60 ? `${line.slice(0, 60)}…` : line
  }
  return getJobKindLabel(job.kind)
}

export const TASK_GROUPS: ReadonlyArray<{ key: TaskGroupKey; label: string; description: string; statuses: readonly AgentJobStatus[] }> = [
  { key: "review", label: "等我审核", description: "草稿已写入稿件，等待你审阅与审核", statuses: ["pending_review"] },
  { key: "decide", label: "等我拍板", description: "达到轮次/预算上限，或有待批准的高风险动作", statuses: ["blocked_needs_human"] },
  { key: "failed", label: "异常阻塞", description: "执行失败，需要排查或重新发起", statuses: ["failed"] },
  { key: "active", label: "进行中", description: "排队或正在执行", statuses: ["queued", "running"] },
  { key: "done", label: "已完成", description: "已结束或已取消", statuses: ["succeeded", "cancelled"] },
]

export const JOB_STATUS_LABEL: Record<AgentJobStatus, string> = {
  queued: "排队中",
  running: "执行中",
  pending_review: "待审核",
  blocked_needs_human: "待拍板",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
}

export const JOB_STATUS_VARIANT: Record<AgentJobStatus, "default" | "secondary" | "outline" | "destructive"> = {
  queued: "outline",
  running: "outline",
  pending_review: "default",
  blocked_needs_human: "default",
  succeeded: "secondary",
  failed: "destructive",
  cancelled: "secondary",
}

export interface TaskGroup {
  key: TaskGroupKey
  label: string
  description: string
  jobs: AgentJob[]
  approvals: ApprovalRequest[]
}

/** Group jobs (and pending approvals, which belong to "等我拍板") for the human-attention view. */
export function groupTasks(jobs: readonly AgentJob[], approvals: readonly ApprovalRequest[] = []): TaskGroup[] {
  return TASK_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    description: g.description,
    jobs: jobs.filter((j) => g.statuses.includes(j.status)),
    approvals: g.key === "decide" ? approvals.filter((a) => a.status === "pending") : [],
  }))
}

export function attentionCount(groups: readonly TaskGroup[]): number {
  return groups.filter((g) => g.key === "review" || g.key === "decide" || g.key === "failed").reduce((n, g) => n + g.jobs.length + g.approvals.length, 0)
}

export const isTerminalJob = (status: AgentJobStatus) => status === "succeeded" || status === "failed" || status === "cancelled"

export interface RoundView {
  round: number
  steps: AgentJobStep[]
}

/** Steps grouped by round; round 0 holds context/fetch. */
export function groupStepsByRound(steps: readonly AgentJobStep[]): RoundView[] {
  const map = new Map<number, AgentJobStep[]>()
  for (const s of steps) map.set(s.round, [...(map.get(s.round) ?? []), s])
  return [...map.entries()].sort(([a], [b]) => a - b).map(([round, list]) => ({ round, steps: list }))
}

export function stepTokens(step: AgentJobStep): number {
  return step.usage.inputTokens + step.usage.outputTokens
}

/** Display key: a check step shows its stage (precheck / evaluate). */
export const stepLabelKey = (step: AgentJobStep): string => (step.kind === "check" ? (step.stage ?? "check") : step.kind)
