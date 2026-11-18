/**
 * Video Studio (P5) contracts. Shared by the web app, the TS agent worker (video_storyboard) and —
 * through the generated JSON Schema in workers/video/contract/ — the Python video worker.
 * Cost / alignment rules mirror supabase/migrations/20261120100000_video_studio.sql; keep them in sync.
 */
import { z } from "zod"

export const VIDEO_STUDIO_SCHEMA_VERSION = 1 as const

export const aspectRatios = ["9:16", "16:9", "1:1"] as const
export const shotSizes = ["extreme_wide", "wide", "full", "medium", "close_up", "extreme_close_up"] as const
export const cameraMotions = ["zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "static"] as const
export const motionModes = ["local_ken_burns", "cloud_video_model"] as const
export const ttsProviders = ["edge_tts", "cloud_tts"] as const
export const shotRenderStatuses = ["pending", "queued", "rendering", "rendered", "failed"] as const
export const planStatuses = ["draft", "rendering", "rendered", "failed", "archived"] as const
export const videoRenderJobTypes = ["video_tts_preview", "video_shot_render", "video_compose"] as const
export const VIDEO_STORYBOARD_JOB_TYPE = "video_storyboard" as const
export const videoAssetCategories = ["keyframe", "voiceover", "shot_clip", "final_video"] as const

export type AspectRatio = (typeof aspectRatios)[number]
export type ShotSize = (typeof shotSizes)[number]
export type CameraMotion = (typeof cameraMotions)[number]
export type MotionMode = (typeof motionModes)[number]
export type TtsProvider = (typeof ttsProviders)[number]
export type ShotRenderStatus = (typeof shotRenderStatuses)[number]
export type PlanStatus = (typeof planStatuses)[number]
export type VideoRenderJobType = (typeof videoRenderJobTypes)[number]

export const shotSizeLabels: Record<ShotSize, string> = {
  extreme_wide: "大远景", wide: "远景", full: "全景", medium: "中景", close_up: "近景/特写", extreme_close_up: "大特写",
}
export const cameraMotionLabels: Record<CameraMotion, string> = {
  zoom_in: "推镜", zoom_out: "拉镜", pan_left: "左移", pan_right: "右移", pan_up: "上摇", static: "固定",
}
export const motionModeLabels: Record<MotionMode, string> = { local_ken_burns: "本地运镜（免费）", cloud_video_model: "云端视频模型（付费）" }
export const shotRenderStatusLabels: Record<ShotRenderStatus, string> = {
  pending: "待渲染", queued: "排队中", rendering: "渲染中", rendered: "已渲染", failed: "失败",
}
export const planStatusLabels: Record<PlanStatus, string> = { draft: "草稿", rendering: "合成中", rendered: "已成片", failed: "失败", archived: "已归档" }
export const videoJobTypeLabels: Record<VideoRenderJobType | typeof VIDEO_STORYBOARD_JOB_TYPE, string> = {
  video_storyboard: "大纲拆解", video_tts_preview: "配音试听", video_shot_render: "单镜渲染", video_compose: "全片合成",
}
export const VOICE_OPTIONS = [
  { value: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 亲切女声" },
  { value: "zh-CN-YunxiNeural", label: "云希 · 少年男声" },
  { value: "zh-CN-YunjianNeural", label: "云健 · 解说男声" },
  { value: "zh-CN-XiaoyiNeural", label: "晓伊 · 活泼女声" },
] as const

// ---------------------------------------------------------------- cost & Audio-First rules
/** Cents of CNY (分). Mirrors private.video_cost_rate(). */
export const VIDEO_COST_RATES = {
  cloudTtsPer100Chars: 2,
  cloudVideoPer5s: 35,
  freeThresholdCents: 10,
  paddingMs: 300,
} as const

export interface DurationAlignmentInput {
  narrationMs: number | null
  targetMs: number
  motionMode: MotionMode
  paddingMs?: number
  minMs?: number
  maxMs?: number
}

export interface DurationAlignment {
  /** Picture duration used for rendering / composition. */
  renderMs: number
  /** Clip length requested from the cloud model (5 or 10 s), null for local motion. */
  cloudClipSeconds: 5 | 10 | null
  /** Cloud clip shorter than the narration: the composer holds the last frame for this long. */
  holdMs: number
  /** renderMs - targetMs (positive = longer than planned). */
  driftMs: number
  source: "narration" | "target"
}

/**
 * Audio-First: the picture lasts as long as the real narration audio plus a short tail.
 * Without narration audio the planned target duration is used.
 */
export function alignShotDuration(input: DurationAlignmentInput): DurationAlignment {
  const padding = input.paddingMs ?? VIDEO_COST_RATES.paddingMs
  const min = input.minMs ?? 1000
  const max = input.maxMs ?? 60000
  const hasNarration = input.narrationMs != null && input.narrationMs > 0
  const raw = hasNarration ? Math.round((input.narrationMs as number) + padding) : Math.round(input.targetMs)
  const renderMs = Math.min(max, Math.max(min, raw))
  const cloudClipSeconds = input.motionMode === "cloud_video_model" ? (cloudClipSecondsFor(input.targetMs, hasNarration ? (input.narrationMs as number) : null)) : null
  const holdMs = cloudClipSeconds ? Math.max(0, renderMs - cloudClipSeconds * 1000) : 0
  return { renderMs, cloudClipSeconds, holdMs, driftMs: renderMs - Math.round(input.targetMs), source: hasNarration ? "narration" : "target" }
}

/** Mirrors private.video_cloud_clip_seconds(target_ms, actual_ms). */
export function cloudClipSecondsFor(targetMs: number, actualMs: number | null): 5 | 10 {
  const billed = actualMs != null ? actualMs + VIDEO_COST_RATES.paddingMs : targetMs
  return billed <= 5000 ? 5 : 10
}

export interface ShotCostInput {
  motionMode: MotionMode
  targetDurationMs: number
  actualDurationMs: number | null
  narration: string
}

/** Mirrors private.video_shot_cost_cents(). */
export function estimateShotCostCents(shot: ShotCostInput, ttsProvider: TtsProvider, include: { tts: boolean; video: boolean } = { tts: true, video: true }): number {
  const text = shot.narration.trim()
  const tts = include.tts && ttsProvider === "cloud_tts" && text.length > 0 ? Math.ceil(text.length / 100) * VIDEO_COST_RATES.cloudTtsPer100Chars : 0
  const video = include.video && shot.motionMode === "cloud_video_model" ? (cloudClipSecondsFor(shot.targetDurationMs, shot.actualDurationMs) / 5) * VIDEO_COST_RATES.cloudVideoPer5s : 0
  return tts + video
}

export interface JobEstimate {
  costCents: number
  usesCloudVideo: boolean
  requiresApproval: boolean
}

type EstimatableShot = ShotCostInput & { id: string; audioAssetId: number | null; videoAssetId: number | null; renderStatus: ShotRenderStatus }

/** Mirrors private.video_job_estimate(). The database value is authoritative; this is for UI previews. */
export function estimateVideoJob(jobType: VideoRenderJobType, shots: readonly EstimatableShot[], ttsProvider: TtsProvider, shotId?: string | null): JobEstimate {
  let cost = 0
  let cloud = false
  if (jobType === "video_compose") {
    for (const s of shots) {
      const needsVideo = s.videoAssetId == null || s.renderStatus !== "rendered"
      cost += estimateShotCostCents(s, ttsProvider, { tts: s.audioAssetId == null, video: needsVideo })
      if (s.motionMode === "cloud_video_model" && needsVideo) cloud = true
    }
  } else {
    const s = shots.find((x) => x.id === shotId)
    if (s) {
      if (jobType === "video_tts_preview") cost = estimateShotCostCents(s, ttsProvider, { tts: true, video: false })
      else {
        cost = estimateShotCostCents(s, ttsProvider, { tts: s.audioAssetId == null, video: true })
        cloud = s.motionMode === "cloud_video_model"
      }
    }
  }
  return { costCents: cost, usesCloudVideo: cloud, requiresApproval: cloud || cost > VIDEO_COST_RATES.freeThresholdCents }
}

const SHOT_TRANSITIONS: ReadonlySet<string> = new Set([
  "pending>queued", "failed>queued", "rendered>queued", "queued>rendering", "queued>pending", "queued>failed",
  "rendering>rendered", "rendering>failed", "failed>pending", "rendered>pending",
])

/** Mirrors private.video_shot_transition_allowed(). */
export function isShotTransitionAllowed(from: ShotRenderStatus, to: ShotRenderStatus): boolean {
  return from === to || SHOT_TRANSITIONS.has(`${from}>${to}`)
}

/**
 * Local (optimistic / realtime) update of one shot's render state. Returns a new array in which only
 * that shot object changed; illegal transitions or unknown ids return the original array.
 */
export function applyShotRenderUpdate<T extends { id: string; renderStatus: ShotRenderStatus }>(shots: readonly T[], shotId: string, patch: Partial<T> & { renderStatus?: ShotRenderStatus }): readonly T[] {
  const index = shots.findIndex((s) => s.id === shotId)
  if (index < 0) return shots
  const current = shots[index]
  if (patch.renderStatus && !isShotTransitionAllowed(current.renderStatus, patch.renderStatus)) return shots
  const next = shots.slice()
  next[index] = { ...current, ...patch }
  return next
}

export function formatCents(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

// ---------------------------------------------------------------- storyboard (LLM output → proposal)
export const VideoShotDraftSchema = z.object({
  shot_size: z.enum(shotSizes),
  camera_motion: z.enum(cameraMotions),
  motion_mode: z.enum(motionModes),
  visual_prompt: z.string().trim().min(1).max(2000),
  narration: z.string().trim().max(1000),
  voice: z.string().trim().min(1).max(80).nullable().optional(),
  sfx_description: z.string().max(500).default(""),
  target_duration_ms: z.number().int().min(500).max(60000),
}).strict()

export const VideoPlanDraftSchema = z.object({
  schema_version: z.literal(VIDEO_STUDIO_SCHEMA_VERSION),
  title: z.string().trim().min(1).max(160),
  aspect_ratio: z.enum(aspectRatios),
  target_seconds: z.number().int().min(3).max(600),
  style: z.string().max(1000).default(""),
  default_voice: z.string().trim().min(1).max(80),
  shots: z.array(VideoShotDraftSchema).min(1).max(60),
}).strict()
export type VideoShotDraft = z.infer<typeof VideoShotDraftSchema>
export type VideoPlanDraft = z.infer<typeof VideoPlanDraftSchema>

export const VideoStoryboardPayloadSchema = z.object({
  schema_version: z.literal(VIDEO_STUDIO_SCHEMA_VERSION),
  outline: z.string().trim().min(10).max(20000),
  project_id: z.string().uuid().nullable().optional(),
  aspect_ratio: z.enum(aspectRatios).default("9:16"),
  target_seconds: z.number().int().min(3).max(600).default(30),
  style: z.string().max(1000).default(""),
  default_voice: z.string().min(1).max(80).default("zh-CN-XiaoxiaoNeural"),
})
export type VideoStoryboardPayload = z.infer<typeof VideoStoryboardPayloadSchema>

export interface StoryboardSopIssue {
  rule: "hook" | "duration" | "narration" | "shot_count"
  message: string
}

/** Deterministic SOP checks on a schema-valid draft (knowledge-base/sops/video-storyboard-sop.md). */
export function checkStoryboardSop(draft: VideoPlanDraft): StoryboardSopIssue[] {
  const issues: StoryboardSopIssue[] = []
  const first = draft.shots[0]
  if (!first.narration.trim() || first.target_duration_ms > 5000) {
    issues.push({ rule: "hook", message: "第 1 个镜头必须有直击冲突/奇观的旁白 Hook，且不超过 5 秒。" })
  }
  const total = draft.shots.reduce((sum, s) => sum + s.target_duration_ms, 0)
  const target = draft.target_seconds * 1000
  if (total < target * 0.6 || total > target * 1.4) {
    issues.push({ rule: "duration", message: `镜头总时长 ${Math.round(total / 1000)} 秒偏离目标 ${draft.target_seconds} 秒超过 40%。` })
  }
  if (draft.shots.filter((s) => !s.narration.trim()).length > Math.floor(draft.shots.length / 2)) {
    issues.push({ rule: "narration", message: "超过一半镜头没有旁白；Audio-First 需要旁白作为主时钟。" })
  }
  if (draft.shots.length > Math.max(3, Math.ceil(draft.target_seconds / 1.5))) {
    issues.push({ rule: "shot_count", message: "镜头过碎（平均不足 1.5 秒）。" })
  }
  return issues
}

// ---------------------------------------------------------------- render jobs (TS ↔ Python contract)
// A claimed agent_jobs row (DB2c-1): the target, approval and limits live in payload; lease_epoch must be
// passed back on every heartbeat / complete / fail.
export const VideoRenderJobPayloadSchema = z.object({
  schema_version: z.literal(VIDEO_STUDIO_SCHEMA_VERSION),
  plan_id: z.string().uuid(),
  plan_revision: z.number().int().min(1),
  shot_id: z.string().uuid().nullable(),
  target: z.object({ type: z.literal("video_plan"), id: z.string().uuid(), revision: z.number().int().min(1) }),
  approval_request_id: z.string().uuid().optional(),
  limits: z.object({ max_rounds: z.number().int(), max_hops: z.number().int(), budget_cents: z.number().int(), token_budget: z.number().int().optional() }).optional(),
  server_estimate: z.object({ cost_cents: z.number().min(0), uses_cloud_video: z.boolean(), requires_approval: z.boolean() }).optional(),
})

export const VideoRenderJobSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  kind: z.enum(videoRenderJobTypes),
  lease_epoch: z.number().int().min(1),
  created_by: z.string().uuid().nullable(),
  payload: VideoRenderJobPayloadSchema,
}).superRefine((job, ctx) => {
  if (job.kind !== "video_compose" && !job.payload.shot_id) ctx.addIssue({ code: "custom", message: "shot_id is required", path: ["payload", "shot_id"] })
  if (job.payload.plan_id !== job.payload.target.id) ctx.addIssue({ code: "custom", message: "payload.plan_id must equal payload.target.id", path: ["payload", "plan_id"] })
})
export type VideoRenderJob = z.infer<typeof VideoRenderJobSchema>

export const VideoJobAssetSchema = z.object({
  category: z.enum(videoAssetCategories),
  asset_id: z.number().int().positive(),
  shot_id: z.string().uuid().nullable(),
  storage_path: z.string().min(1).max(1024),
  mime_type: z.string().min(1).max(100),
  duration_ms: z.number().int().min(0).nullable(),
  placeholder: z.boolean(),
})

export const VideoRenderJobResultSchema = z.object({
  schema_version: z.literal(VIDEO_STUDIO_SCHEMA_VERSION),
  kind: z.enum(videoRenderJobTypes),
  engine: z.string().min(1).max(64),
  dry_run: z.boolean(),
  plan_id: z.string().uuid(),
  plan_revision: z.number().int().min(1),
  assets: z.array(VideoJobAssetSchema),
  cost_cents: z.number().min(0),
  shots: z.array(z.object({ shot_id: z.string().uuid(), render_ms: z.number().int().min(0), narration_ms: z.number().int().min(0).nullable(), status: z.enum(shotRenderStatuses) })),
  final_duration_ms: z.number().int().min(0).nullable(),
  warnings: z.array(z.string()),
})
export type VideoRenderJobResult = z.infer<typeof VideoRenderJobResultSchema>

/** JSON Schema consumed by the Python worker (generated into workers/video/contract/video-job.schema.json). */
export function videoJobJsonSchema() {
  const def = (schema: z.ZodType, io: "input" | "output") => {
    const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-2020-12", io }) as Record<string, unknown>
    void _ignored
    return rest
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Signal to Story video render job contract",
    schema_version: VIDEO_STUDIO_SCHEMA_VERSION,
    $defs: {
      job: def(VideoRenderJobSchema, "input"),
      result: def(VideoRenderJobResultSchema, "output"),
      plan_draft: def(VideoPlanDraftSchema, "input"),
    },
  }
}

// ---------------------------------------------------------------- app types (rows → camelCase)
export interface VideoPlan {
  id: string
  organizationId: string
  projectId: string | null
  title: string
  aspectRatio: AspectRatio
  targetSeconds: number
  style: string
  defaultVoice: string
  ttsProvider: TtsProvider
  bgmTrack: string | null
  status: PlanStatus
  revision: number
  composedVideoAssetId: number | null
  finalDurationMs: number | null
  error: string | null
  sourceProposalId: string | null
  updatedAt: string
}

export interface VideoShot {
  id: string
  planId: string
  position: number
  shotSize: ShotSize
  cameraMotion: CameraMotion
  motionMode: MotionMode
  visualPrompt: string
  narration: string
  voice: string | null
  sfxDescription: string
  targetDurationMs: number
  actualDurationMs: number | null
  keyframeAssetId: number | null
  audioAssetId: number | null
  videoAssetId: number | null
  renderStatus: ShotRenderStatus
  estimatedCostCents: number
  actualCostCents: number
  error: string | null
}

export interface VideoStoryboardProposal {
  id: string
  agentJobId: string
  inputOutline: string
  proposal: VideoPlanDraft | null
  rawProposal: unknown
  model: string | null
  status: "pending" | "accepted" | "rejected"
  acceptedPlanId: string | null
  reason: string
  createdAt: string
}

export interface VideoCostSummary {
  planId: string
  revision: number
  estimatedCents: number
  actualCents: number
  planLevelActualCents: number
  shotCount: number
  renderedCount: number
  cloudShotCount: number
}

export interface VideoCostEntry {
  id: string
  shotId: string | null
  agentJobId: string | null
  kind: "tts" | "shot_render" | "compose" | "keyframe" | "storyboard_llm"
  provider: string
  estimatedCents: number
  actualCents: number
  createdAt: string
}

type Row = Record<string, unknown>
const num = (v: unknown) => (v == null ? 0 : Number(v))
const optNum = (v: unknown) => (v == null ? null : Number(v))
const str = (v: unknown) => (v == null ? null : String(v))

export function mapVideoPlan(r: Row): VideoPlan {
  return {
    id: String(r.id), organizationId: String(r.organization_id), projectId: str(r.project_id), title: String(r.title),
    aspectRatio: r.aspect_ratio as AspectRatio, targetSeconds: num(r.target_seconds), style: String(r.style ?? ""),
    defaultVoice: String(r.default_voice), ttsProvider: r.tts_provider as TtsProvider, bgmTrack: str(r.bgm_track),
    status: r.status as PlanStatus, revision: num(r.revision), composedVideoAssetId: optNum(r.composed_video_asset_id),
    finalDurationMs: optNum(r.final_duration_ms), error: str(r.error), sourceProposalId: str(r.source_proposal_id), updatedAt: String(r.updated_at),
  }
}

export function mapVideoShot(r: Row): VideoShot {
  return {
    id: String(r.id), planId: String(r.plan_id), position: num(r.position), shotSize: r.shot_size as ShotSize,
    cameraMotion: r.camera_motion as CameraMotion, motionMode: r.motion_mode as MotionMode, visualPrompt: String(r.visual_prompt ?? ""),
    narration: String(r.narration ?? ""), voice: str(r.voice), sfxDescription: String(r.sfx_description ?? ""),
    targetDurationMs: num(r.target_duration_ms), actualDurationMs: optNum(r.actual_duration_ms), keyframeAssetId: optNum(r.keyframe_asset_id),
    audioAssetId: optNum(r.audio_asset_id), videoAssetId: optNum(r.video_asset_id), renderStatus: r.render_status as ShotRenderStatus,
    estimatedCostCents: num(r.estimated_cost_cents), actualCostCents: num(r.actual_cost_cents), error: str(r.error),
  }
}

export function mapVideoProposal(r: Row): VideoStoryboardProposal {
  const parsed = VideoPlanDraftSchema.safeParse(r.proposal)
  return {
    id: String(r.id), agentJobId: String(r.agent_job_id), inputOutline: String(r.input_outline ?? ""),
    proposal: parsed.success ? parsed.data : null, rawProposal: r.proposal, model: str(r.model),
    status: r.status as VideoStoryboardProposal["status"], acceptedPlanId: str(r.accepted_plan_id), reason: String(r.reason ?? ""), createdAt: String(r.created_at),
  }
}

export function mapVideoCostSummary(r: Row): VideoCostSummary {
  return {
    planId: String(r.plan_id), revision: num(r.revision), estimatedCents: num(r.estimated_cents), actualCents: num(r.actual_cents),
    planLevelActualCents: num(r.plan_level_actual_cents), shotCount: num(r.shot_count), renderedCount: num(r.rendered_count), cloudShotCount: num(r.cloud_shot_count),
  }
}

export function mapVideoCostEntry(r: Row): VideoCostEntry {
  return {
    id: String(r.id), shotId: str(r.shot_id), agentJobId: str(r.agent_job_id), kind: r.kind as VideoCostEntry["kind"], provider: String(r.provider),
    estimatedCents: num(r.estimated_cents), actualCents: num(r.actual_cents), createdAt: String(r.created_at),
  }
}
