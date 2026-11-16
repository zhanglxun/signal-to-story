import type { AgentJob, AgentJobStatus, AgentJobStep, ApprovalRequest } from "@/contracts/agent-job"

export type TaskGroupKey = "review" | "decide" | "failed" | "active" | "done"

export const TASK_GROUPS: ReadonlyArray<{ key: TaskGroupKey; label: string; description: string; statuses: readonly AgentJobStatus[] }> = [
  { key: "review", label: "等我审核", description: "提案已生成，等待你采纳与审核", statuses: ["pending_review"] },
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
  const u = step.usage as { inputTokens?: number; outputTokens?: number; input_tokens?: number; output_tokens?: number } | null
  if (!u) return 0
  return Number(u.inputTokens ?? u.input_tokens ?? 0) + Number(u.outputTokens ?? u.output_tokens ?? 0)
}
