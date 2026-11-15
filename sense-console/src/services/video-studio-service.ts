/**
 * Video Studio data access (browser, publishable key + RLS). Content edits go to the tables through
 * column grants; everything with side effects (jobs, approvals, adoption, reorder) goes through RPCs
 * that re-check permissions, plan revision and the paid-render Mandate in the database.
 */
import { type AgentJob, type ApprovalRequest, mapAgentJob, mapApprovalRequest } from "@/contracts/agent-job"
import {
  type AspectRatio,
  type CameraMotion,
  type JobEstimate,
  mapVideoCostEntry,
  mapVideoCostSummary,
  mapVideoPlan,
  mapVideoProposal,
  mapVideoShot,
  type MotionMode,
  type ShotSize,
  type TtsProvider,
  VIDEO_STORYBOARD_JOB_TYPE,
  type VideoCostEntry,
  type VideoCostSummary,
  type VideoPlan,
  type VideoRenderJobType,
  type VideoShot,
  type VideoStoryboardProposal,
  videoRenderJobTypes,
} from "@/contracts/video-studio"
import { getSupabaseClient } from "@/lib/supabase"

export const VIDEO_STUDIO_BUCKET = "video-studio"

function db() {
  const client = getSupabaseClient()
  if (!client) throw new Error("Supabase 未配置")
  return client
}

function fail(error: { message?: string } | null): void {
  if (error) throw new Error(error.message || "请求失败，请稍后重试")
}

// ---------------------------------------------------------------- plans & shots
export async function listVideoPlans(organizationId: string): Promise<VideoPlan[]> {
  const { data, error } = await db().from("video_plans").select("*").eq("organization_id", organizationId).neq("status", "archived").order("updated_at", { ascending: false }).limit(50)
  fail(error)
  return (data ?? []).map(mapVideoPlan)
}

export async function getVideoPlan(planId: string): Promise<VideoPlan | null> {
  const { data, error } = await db().from("video_plans").select("*").eq("id", planId).maybeSingle()
  fail(error)
  return data ? mapVideoPlan(data) : null
}

export async function listVideoShots(planId: string): Promise<VideoShot[]> {
  const { data, error } = await db().from("video_shots").select("*").eq("plan_id", planId).order("position", { ascending: true })
  fail(error)
  return (data ?? []).map(mapVideoShot)
}

export interface VideoPlanPatch {
  title?: string
  aspectRatio?: AspectRatio
  targetSeconds?: number
  style?: string
  defaultVoice?: string
  ttsProvider?: TtsProvider
  bgmTrack?: string | null
}

export async function updateVideoPlan(planId: string, patch: VideoPlanPatch): Promise<VideoPlan> {
  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title
  if (patch.aspectRatio !== undefined) row.aspect_ratio = patch.aspectRatio
  if (patch.targetSeconds !== undefined) row.target_seconds = patch.targetSeconds
  if (patch.style !== undefined) row.style = patch.style
  if (patch.defaultVoice !== undefined) row.default_voice = patch.defaultVoice
  if (patch.ttsProvider !== undefined) row.tts_provider = patch.ttsProvider
  if (patch.bgmTrack !== undefined) row.bgm_track = patch.bgmTrack
  const { data, error } = await db().from("video_plans").update(row).eq("id", planId).select("*").single()
  fail(error)
  return mapVideoPlan(data)
}

export interface VideoShotPatch {
  shotSize?: ShotSize
  cameraMotion?: CameraMotion
  motionMode?: MotionMode
  visualPrompt?: string
  narration?: string
  voice?: string | null
  sfxDescription?: string
  targetDurationMs?: number
}

export function shotPatchToRow(patch: VideoShotPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.shotSize !== undefined) row.shot_size = patch.shotSize
  if (patch.cameraMotion !== undefined) row.camera_motion = patch.cameraMotion
  if (patch.motionMode !== undefined) row.motion_mode = patch.motionMode
  if (patch.visualPrompt !== undefined) row.visual_prompt = patch.visualPrompt
  if (patch.narration !== undefined) row.narration = patch.narration
  if (patch.voice !== undefined) row.voice = patch.voice
  if (patch.sfxDescription !== undefined) row.sfx_description = patch.sfxDescription
  if (patch.targetDurationMs !== undefined) row.target_duration_ms = patch.targetDurationMs
  return row
}

/** Any content change bumps the plan revision (and expires approvals on the old revision). */
export async function updateVideoShot(shotId: string, patch: VideoShotPatch): Promise<VideoShot> {
  const { data, error } = await db().from("video_shots").update(shotPatchToRow(patch)).eq("id", shotId).select("*").single()
  fail(error)
  return mapVideoShot(data)
}

export async function addVideoShot(input: { organizationId: string; planId: string; userId: string; afterPosition: number; shots: VideoShot[] } & VideoShotPatch): Promise<VideoShot> {
  // Append at the end, then move into place with one reorder (keeps positions unique).
  const end = input.shots.reduce((max, s) => Math.max(max, s.position), 0) + 1
  const { data, error } = await db()
    .from("video_shots")
    .insert({ organization_id: input.organizationId, plan_id: input.planId, position: end, created_by: input.userId, visual_prompt: "新镜头画面描述", ...shotPatchToRow(input) })
    .select("*")
    .single()
  fail(error)
  const created = mapVideoShot(data)
  if (input.afterPosition < end - 1) {
    const ordered = [...input.shots].sort((a, b) => a.position - b.position).map((s) => s.id)
    ordered.splice(input.afterPosition, 0, created.id)
    await reorderVideoShots(input.planId, ordered)
  }
  return created
}

export async function deleteVideoShot(shotId: string): Promise<void> {
  const { error } = await db().from("video_shots").delete().eq("id", shotId)
  fail(error)
}

export async function reorderVideoShots(planId: string, orderedShotIds: string[]): Promise<number> {
  const { data, error } = await db().rpc("reorder_video_shots", { p_plan_id: planId, p_shot_ids: orderedShotIds })
  fail(error)
  return Number(data)
}

/** Pure helper for the up/down buttons: ids in the new order, or null when the move is a no-op. */
export function moveShotOrder(shots: readonly Pick<VideoShot, "id" | "position">[], shotId: string, direction: -1 | 1): string[] | null {
  const ordered = [...shots].sort((a, b) => a.position - b.position).map((s) => s.id)
  const index = ordered.indexOf(shotId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ordered.length) return null
  ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
  return ordered
}

// ---------------------------------------------------------------- storyboard (agent) → proposal → human adoption
export async function enqueueStoryboardJob(input: {
  organizationId: string
  outline: string
  aspectRatio?: AspectRatio
  targetSeconds?: number
  style?: string
  defaultVoice?: string
  projectId?: string | null
  idempotencyKey?: string
}): Promise<AgentJob> {
  const { data, error } = await db().rpc("enqueue_video_storyboard_job", {
    p_organization_id: input.organizationId,
    p_outline: input.outline,
    p_options: { aspect_ratio: input.aspectRatio, target_seconds: input.targetSeconds, style: input.style, default_voice: input.defaultVoice },
    p_project_id: input.projectId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  })
  fail(error)
  return mapAgentJob(data)
}

export async function listStoryboardJobs(organizationId: string): Promise<AgentJob[]> {
  const { data, error } = await db().from("agent_jobs").select("*").eq("organization_id", organizationId).eq("job_type", VIDEO_STORYBOARD_JOB_TYPE).order("created_at", { ascending: false }).limit(10)
  fail(error)
  return (data ?? []).map(mapAgentJob)
}

export async function listStoryboardProposals(organizationId: string, status: VideoStoryboardProposal["status"] = "pending"): Promise<VideoStoryboardProposal[]> {
  const { data, error } = await db().from("video_storyboard_proposals").select("*").eq("organization_id", organizationId).eq("status", status).order("created_at", { ascending: false }).limit(20)
  fail(error)
  return (data ?? []).map(mapVideoProposal)
}

export async function acceptStoryboardProposal(proposalId: string, title?: string): Promise<string> {
  const { data, error } = await db().rpc("accept_video_storyboard_proposal", { p_proposal_id: proposalId, p_title: title ?? null })
  fail(error)
  return String(data)
}

export async function rejectStoryboardProposal(proposalId: string, reason: string): Promise<void> {
  const { error } = await db().rpc("reject_video_storyboard_proposal", { p_proposal_id: proposalId, p_reason: reason })
  fail(error)
}

// ---------------------------------------------------------------- render jobs, approvals, cost
export async function estimateVideoJobOnServer(planId: string, jobType: VideoRenderJobType, shotId?: string | null): Promise<JobEstimate & { planRevision: number }> {
  const { data, error } = await db().rpc("estimate_video_job", { p_plan_id: planId, p_job_type: jobType, p_shot_id: shotId ?? null })
  fail(error)
  const d = data as { cost_cents: number; uses_cloud_video: boolean; requires_approval: boolean; plan_revision: number }
  return { costCents: Number(d.cost_cents), usesCloudVideo: Boolean(d.uses_cloud_video), requiresApproval: Boolean(d.requires_approval), planRevision: Number(d.plan_revision) }
}

export async function requestVideoRenderApproval(planId: string, rerenderShotIds: string[] = [], note = ""): Promise<ApprovalRequest> {
  const { data, error } = await db().rpc("request_video_render_approval", { p_plan_id: planId, p_rerender_shot_ids: rerenderShotIds, p_note: note })
  fail(error)
  return mapApprovalRequest(data)
}

export async function listPlanApprovals(planId: string): Promise<ApprovalRequest[]> {
  const { data, error } = await db().from("approval_requests").select("*").eq("target_type", "video_plan").eq("target_id", planId).order("created_at", { ascending: false }).limit(20)
  fail(error)
  return (data ?? []).map(mapApprovalRequest)
}

/** The approval valid for the plan's current revision, if any. */
export function currentApproval(approvals: readonly ApprovalRequest[], revision: number): ApprovalRequest | null {
  return approvals.find((a) => a.targetRevision === revision && (a.status === "approved" || a.status === "pending")) ?? null
}

export async function enqueueVideoJob(input: { planId: string; jobType: VideoRenderJobType; shotId?: string | null; approvalRequestId?: string | null; idempotencyKey?: string | null }): Promise<AgentJob> {
  const { data, error } = await db().rpc("enqueue_video_job", {
    p_plan_id: input.planId,
    p_job_type: input.jobType,
    p_shot_id: input.shotId ?? null,
    p_approval_request_id: input.approvalRequestId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  })
  fail(error)
  return mapAgentJob(data)
}

export async function listPlanJobs(planId: string): Promise<AgentJob[]> {
  const { data, error } = await db().from("agent_jobs").select("*").eq("target_type", "video_plan").eq("target_id", planId).in("job_type", [...videoRenderJobTypes]).order("created_at", { ascending: false }).limit(50)
  fail(error)
  return (data ?? []).map(mapAgentJob)
}

export async function getPlanCostSummary(planId: string): Promise<VideoCostSummary | null> {
  const { data, error } = await db().from("video_plan_cost_summary").select("*").eq("plan_id", planId).maybeSingle()
  fail(error)
  return data ? mapVideoCostSummary(data) : null
}

export async function listPlanCostEntries(planId: string): Promise<VideoCostEntry[]> {
  const { data, error } = await db().from("video_cost_entries").select("*").eq("plan_id", planId).order("created_at", { ascending: true }).limit(500)
  fail(error)
  return (data ?? []).map(mapVideoCostEntry)
}

/** assets.cloud_url for worker uploads looks like `supabase://video-studio/<org>/<plan>/<file>`. */
export function parseStorageUrl(cloudUrl: string | null): { bucket: string; path: string } | null {
  const match = cloudUrl?.match(/^supabase:\/\/([^/]+)\/(.+)$/)
  return match ? { bucket: match[1], path: match[2] } : null
}

/** Short-lived signed URLs (Storage RLS: content.view of the org in the first path segment). */
export async function getVideoAssetUrls(assetIds: number[], expiresInSeconds = 600): Promise<Record<number, { url: string | null; mediaType: string; placeholder: boolean }>> {
  const ids = [...new Set(assetIds.filter((id) => Number.isFinite(id)))]
  if (ids.length === 0) return {}
  const { data, error } = await db().from("assets").select("id, cloud_url, media_type, metadata").in("id", ids)
  fail(error)
  const out: Record<number, { url: string | null; mediaType: string; placeholder: boolean }> = {}
  for (const row of (data ?? []) as Array<{ id: number; cloud_url: string | null; media_type: string; metadata: Record<string, unknown> | null }>) {
    const loc = parseStorageUrl(row.cloud_url)
    let url: string | null = null
    if (loc) {
      const signed = await db().storage.from(loc.bucket).createSignedUrl(loc.path, expiresInSeconds)
      url = signed.data?.signedUrl ?? null
    } else if (row.cloud_url?.startsWith("https://")) {
      url = row.cloud_url
    }
    out[row.id] = { url, mediaType: row.media_type, placeholder: Boolean(row.metadata?.placeholder) }
  }
  return out
}

/**
 * UI hint only: whether the caller's role holds `agent.approve` (the permission the database requires to decide
 * a paid_video_render approval, see private.approval_required_permission). The database re-checks on decide.
 */
export async function getCanApproveVideoRender(organizationId: string, userId: string): Promise<boolean> {
  const { data: member, error } = await db().from("organization_members").select("role").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle()
  if (error || !member) return false
  const { data: role } = await db().from("organization_roles").select("permissions").eq("organization_id", organizationId).eq("role_key", (member as { role: string }).role).maybeSingle()
  return Boolean((role as { permissions?: string[] } | null)?.permissions?.includes("agent.approve"))
}
