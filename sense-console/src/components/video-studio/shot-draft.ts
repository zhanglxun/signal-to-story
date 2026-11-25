import type { ShotRenderStatus, VideoShot } from "@/contracts/video-studio"
import type { VideoShotPatch } from "@/services/video-studio-service"

export const renderStatusVariant: Record<ShotRenderStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline", queued: "secondary", rendering: "secondary", rendered: "default", failed: "destructive",
}

export type ShotDraft = Required<Pick<VideoShotPatch, "narration" | "visualPrompt" | "sfxDescription" | "shotSize" | "cameraMotion" | "motionMode" | "targetDurationMs">> & {
  voice: string
  keyframeAssetId: number | null
}

export function toShotDraft(shot: VideoShot, defaultVoice: string): ShotDraft {
  return {
    narration: shot.narration, visualPrompt: shot.visualPrompt, sfxDescription: shot.sfxDescription, shotSize: shot.shotSize,
    cameraMotion: shot.cameraMotion, motionMode: shot.motionMode, targetDurationMs: shot.targetDurationMs, voice: shot.voice ?? defaultVoice,
    keyframeAssetId: shot.keyframeAssetId,
  }
}

/** Only the fields that differ from the stored shot (each saved change bumps the plan revision once). */
export function diffShotDraft(shot: VideoShot, draft: ShotDraft, defaultVoice: string): VideoShotPatch {
  const patch: VideoShotPatch = {}
  if (draft.narration !== shot.narration) patch.narration = draft.narration
  if (draft.visualPrompt !== shot.visualPrompt) patch.visualPrompt = draft.visualPrompt
  if (draft.sfxDescription !== shot.sfxDescription) patch.sfxDescription = draft.sfxDescription
  if (draft.shotSize !== shot.shotSize) patch.shotSize = draft.shotSize
  if (draft.cameraMotion !== shot.cameraMotion) patch.cameraMotion = draft.cameraMotion
  if (draft.motionMode !== shot.motionMode) patch.motionMode = draft.motionMode
  if (draft.targetDurationMs !== shot.targetDurationMs) patch.targetDurationMs = draft.targetDurationMs
  if (draft.voice !== (shot.voice ?? defaultVoice)) patch.voice = draft.voice === defaultVoice ? null : draft.voice
  if (draft.keyframeAssetId !== shot.keyframeAssetId) patch.keyframeAssetId = draft.keyframeAssetId
  return patch
}

