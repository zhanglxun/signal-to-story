import type { AgentJob } from "@/contracts/agent-job"
import { getSupabaseClient } from "@/lib/supabase"
import { listAgentJobs, listApprovalRequests } from "@/services/agent-job-service"

export interface JobTargetInfo {
  documentId: string
  title: string
  platform: string
  workItemId: string | null
}

/** Titles for job targets (content documents), read through RLS. */
export async function getJobTargets(jobs: readonly AgentJob[]): Promise<Record<string, JobTargetInfo>> {
  const ids = [...new Set(jobs.filter((j) => j.targetType === "content_document" && j.targetId).map((j) => j.targetId!))]
  if (!ids.length) return {}
  const client = getSupabaseClient()
  if (!client) throw new Error("Supabase 未配置")
  const { data, error } = await client.from("content_documents").select("id,title,platform,work_item_id").in("id", ids)
  if (error) throw new Error("无法读取任务关联的稿件")
  return Object.fromEntries((data ?? []).map((d) => [String(d.id), { documentId: String(d.id), title: String(d.title), platform: String(d.platform), workItemId: d.work_item_id == null ? null : String(d.work_item_id) }]))
}

export async function getTaskCenter(organizationId: string) {
  const [jobs, approvals] = await Promise.all([
    listAgentJobs({ organizationId, limit: 200 }),
    listApprovalRequests({ organizationId, statuses: ["pending"], limit: 100 }),
  ])
  const targets = await getJobTargets(jobs)
  return { jobs, approvals, targets }
}
