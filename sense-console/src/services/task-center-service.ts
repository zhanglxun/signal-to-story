import type { AgentJob } from "@/contracts/agent-job"
import { getSupabaseClient } from "@/lib/supabase"
import { listAgentJobs, listApprovalRequests, listJobUsage } from "@/services/agent-job-service"

export interface JobTargetInfo {
  targetType?: "content_document" | "video_plan"
  documentId: string
  title: string
  platform: string
  workItemId: string | null
}

/** Titles for job targets (content documents and video plans), read through RLS. */
export async function getJobTargets(jobs: readonly AgentJob[]): Promise<Record<string, JobTargetInfo>> {
  const docIds = [...new Set(jobs.filter((j) => j.target?.type === "content_document").map((j) => j.target!.id))]
  const planIds = [...new Set(jobs.filter((j) => j.target?.type === "video_plan").map((j) => j.target!.id))]
  if (!docIds.length && !planIds.length) return {}

  const client = getSupabaseClient()
  if (!client) throw new Error("Supabase 未配置")

  const [docRes, planRes] = await Promise.all([
    docIds.length
      ? client.from("content_documents").select("id,title,platform,work_item_id").in("id", docIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length
      ? client.from("video_plans").select("id,title,aspect_ratio").in("id", planIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (docRes.error) throw new Error("无法读取任务关联的稿件")

  const targets: Record<string, JobTargetInfo> = {}
  for (const d of (docRes.data ?? []) as Array<{ id: unknown; title: unknown; platform: unknown; work_item_id: unknown }>) {
    targets[String(d.id)] = {
      targetType: "content_document",
      documentId: String(d.id),
      title: String(d.title),
      platform: String(d.platform),
      workItemId: d.work_item_id == null ? null : String(d.work_item_id),
    }
  }
  if (!planRes.error) {
    for (const p of (planRes.data ?? []) as Array<{ id: unknown; title: unknown; aspect_ratio: unknown }>) {
      targets[String(p.id)] = {
        targetType: "video_plan",
        documentId: String(p.id),
        title: String(p.title),
        platform: String(p.aspect_ratio ?? ""),
        workItemId: null,
      }
    }
  }
  return targets
}

export async function getTaskCenter(organizationId: string) {
  const [jobs, approvals] = await Promise.all([
    listAgentJobs({ organizationId, limit: 200 }),
    listApprovalRequests({ organizationId, statuses: ["pending"], limit: 100 }),
  ])
  const [targets, usage] = await Promise.all([getJobTargets(jobs), listJobUsage(jobs.map((j) => j.id))])
  return { jobs, approvals, targets, usage }
}
