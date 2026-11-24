/**
 * Worker-side copy of the video storyboard contract (R2, 2026-11-24): the draft-plan schema the
 * video_storyboard handler validates and the deterministic SOP checks. The console keeps its own
 * copy in sense-console/src/contracts/video-studio.ts; keep both in sync with
 * supabase/migrations/20261120100000_video_studio.sql and the write_video_draft RPC.
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

// ---------------------------------------------------------------- storyboard (LLM output → draft plan)
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
