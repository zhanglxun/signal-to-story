// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { renderVideoContractSchema, VIDEO_CONTRACT_SCHEMA_PATH } from "../../scripts/generate-video-contract"
import {
  alignShotDuration,
  applyShotRenderUpdate,
  checkStoryboardSop,
  estimateShotCostCents,
  estimateVideoJob,
  isShotTransitionAllowed,
  type MotionMode,
  type ShotRenderStatus,
  type TtsProvider,
  VideoPlanDraftSchema,
  VideoRenderJobResultSchema,
  VideoRenderJobSchema,
} from "@/contracts/video-studio"
import { moveShotOrder, parseStorageUrl } from "@/services/video-studio-service"

const fixtures = JSON.parse(readFileSync(path.join(path.dirname(VIDEO_CONTRACT_SCHEMA_PATH), "fixtures.json"), "utf8")) as {
  valid_jobs: Array<{ name: string; job: unknown }>
  invalid_jobs: Array<{ name: string; job: unknown }>
  semantic_invalid_jobs: Array<{ name: string; job: unknown }>
  valid_results: unknown[]
  alignment_vectors: Array<{ input: { narrationMs: number | null; targetMs: number; motionMode: MotionMode }; expected: Record<string, unknown> }>
  cost_vectors: Array<{ shot: { motionMode: MotionMode; targetDurationMs: number; actualDurationMs: number | null; narration: string }; ttsProvider: TtsProvider; expected: number }>
}

describe("video job contract (shared with the Python worker)", () => {
  it("generated JSON Schema is in sync with the zod contract (run `npm run video:contract`)", () => {
    expect(readFileSync(VIDEO_CONTRACT_SCHEMA_PATH, "utf8")).toBe(renderVideoContractSchema())
  })

  it.each(fixtures.valid_jobs)("accepts $name", ({ job }) => {
    expect(VideoRenderJobSchema.safeParse(job).success).toBe(true)
  })

  it.each([...fixtures.invalid_jobs, ...fixtures.semantic_invalid_jobs])("rejects $name", ({ job }) => {
    expect(VideoRenderJobSchema.safeParse(job).success).toBe(false)
  })

  it("accepts the result fixtures", () => {
    for (const result of fixtures.valid_results) expect(VideoRenderJobResultSchema.parse(result).schema_version).toBe(1)
  })
})

describe("Audio-First duration alignment", () => {
  it.each(fixtures.alignment_vectors)("aligns %#", ({ input, expected }) => {
    expect(alignShotDuration(input)).toEqual(expected)
  })
})

describe("cost estimation", () => {
  it.each(fixtures.cost_vectors)("prices shot %#", ({ shot, ttsProvider, expected }) => {
    expect(estimateShotCostCents(shot, ttsProvider)).toBe(expected)
  })

  const shot = (id: string, motionMode: MotionMode, renderStatus: ShotRenderStatus = "pending", videoAssetId: number | null = null) => ({
    id, motionMode, renderStatus, videoAssetId, audioAssetId: null, targetDurationMs: 4000, actualDurationMs: null, narration: "旁白",
  })

  it("free local work needs no approval; any cloud video does", () => {
    const shots = [shot("a", "local_ken_burns"), shot("b", "cloud_video_model")]
    expect(estimateVideoJob("video_shot_render", shots, "edge_tts", "a")).toEqual({ costCents: 0, usesCloudVideo: false, requiresApproval: false })
    expect(estimateVideoJob("video_shot_render", shots, "edge_tts", "b")).toEqual({ costCents: 35, usesCloudVideo: true, requiresApproval: true })
    expect(estimateVideoJob("video_compose", shots, "edge_tts")).toMatchObject({ costCents: 35, requiresApproval: true })
    // Cloud shot already rendered → compose is local only.
    expect(estimateVideoJob("video_compose", [shots[0], shot("b", "cloud_video_model", "rendered", 9)], "edge_tts")).toMatchObject({ costCents: 0, requiresApproval: false })
    expect(estimateVideoJob("video_tts_preview", shots, "cloud_tts", "b")).toEqual({ costCents: 2, usesCloudVideo: false, requiresApproval: false })
  })

  it("cloud TTS above the threshold needs approval", () => {
    const many = Array.from({ length: 6 }, (_, i) => shot(String(i), "local_ken_burns"))
    expect(estimateVideoJob("video_compose", many, "cloud_tts")).toMatchObject({ costCents: 12, requiresApproval: true })
  })
})

describe("shot render state machine", () => {
  const shots = [
    { id: "a", renderStatus: "pending" as ShotRenderStatus, error: null as string | null },
    { id: "b", renderStatus: "queued" as ShotRenderStatus, error: null as string | null },
  ]

  it("updates only the targeted shot and keeps other references", () => {
    const next = applyShotRenderUpdate(shots, "b", { renderStatus: "rendering" })
    expect(next[1].renderStatus).toBe("rendering")
    expect(next[0]).toBe(shots[0])
    expect(shots[1].renderStatus).toBe("queued")
  })

  it("ignores illegal transitions and unknown ids", () => {
    expect(applyShotRenderUpdate(shots, "a", { renderStatus: "rendered" })).toBe(shots)
    expect(applyShotRenderUpdate(shots, "zzz", { renderStatus: "queued" })).toBe(shots)
    expect(isShotTransitionAllowed("rendering", "pending")).toBe(false)
    expect(isShotTransitionAllowed("rendered", "queued")).toBe(true)
  })
})

describe("storyboard draft schema and SOP checks", () => {
  const draft = {
    schema_version: 1,
    title: "月球面包店",
    aspect_ratio: "9:16",
    target_seconds: 12,
    style: "",
    default_voice: "zh-CN-XiaoxiaoNeural",
    shots: [
      { shot_size: "wide", camera_motion: "zoom_in", motion_mode: "local_ken_burns", visual_prompt: "月球表面的面包店", narration: "月球上竟然飘来了面包香！", sfx_description: "", target_duration_ms: 4000 },
      { shot_size: "close_up", camera_motion: "pan_left", motion_mode: "cloud_video_model", visual_prompt: "猫店长揉面", narration: "店长是一只猫。", sfx_description: "揉面声", target_duration_ms: 4000 },
      { shot_size: "medium", camera_motion: "static", motion_mode: "local_ken_burns", visual_prompt: "排队的宇航员", narration: "宇航员排起了长队。", sfx_description: "", target_duration_ms: 4000 },
    ],
  }

  it("accepts a valid draft and passes the SOP", () => {
    const parsed = VideoPlanDraftSchema.parse(draft)
    expect(checkStoryboardSop(parsed)).toEqual([])
  })

  it("rejects unknown motion modes and extra keys", () => {
    expect(VideoPlanDraftSchema.safeParse({ ...draft, shots: [{ ...draft.shots[0], motion_mode: "sora" }] }).success).toBe(false)
    expect(VideoPlanDraftSchema.safeParse({ ...draft, hack: true }).success).toBe(false)
  })

  it("flags a missing hook and duration drift", () => {
    const parsed = VideoPlanDraftSchema.parse({ ...draft, target_seconds: 60, shots: [{ ...draft.shots[0], narration: "" }, ...draft.shots.slice(1)] })
    expect(checkStoryboardSop(parsed).map((i) => i.rule)).toEqual(["hook", "duration"])
  })
})

describe("service helpers", () => {
  it("moves shots up and down", () => {
    const shots = [{ id: "a", position: 1 }, { id: "b", position: 2 }, { id: "c", position: 3 }]
    expect(moveShotOrder(shots, "b", -1)).toEqual(["b", "a", "c"])
    expect(moveShotOrder(shots, "c", 1)).toBeNull()
  })

  it("parses worker storage URLs", () => {
    expect(parseStorageUrl("supabase://video-studio/org/plan/a.mp4")).toEqual({ bucket: "video-studio", path: "org/plan/a.mp4" })
    expect(parseStorageUrl("https://x")).toBeNull()
  })
})
