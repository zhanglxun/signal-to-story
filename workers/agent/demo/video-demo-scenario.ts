/** Fixtures for the video storyboard worker test and `npm run demo:video` (fake LLM, PGlite). */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { FakeLlmClient } from "../../../sense-console/src/harness/llm"
import type { SupabaseTestDb } from "../../../testing/db/pglite-harness"
import type { VideoWorkspace } from "../../../testing/db/video-studio-seed"

const here = path.dirname(fileURLToPath(import.meta.url))
export const VIDEO_SOP_PATH = path.resolve(here, "../../../knowledge-base/sops/video-storyboard-sop.md")

export const DEMO_OUTLINE = "一只橘猫在月球上开了第一家面包店。宇航员闻香而来排起长队，最后猫店长把会发光的星星面包送给了地球上的小朋友。"

export async function seedTrustedVideoSop(db: SupabaseTestDb, ws: VideoWorkspace) {
  const content = readFileSync(VIDEO_SOP_PATH, "utf8").replace(/^---[\s\S]*?---\n/, "")
  await db.asPostgres((tx) =>
    tx.query(
      "insert into public.knowledge_entries(organization_id, slug, title, category, tags, content, trust_level) values ($1,'video-storyboard-sop','AI 视频工坊分镜拆解与多轨配音 SOP','sop',array['video','storyboard'],$2,'trusted')",
      [ws.organizationId, content]
    )
  )
}

export const DEMO_STORYBOARD = {
  schema_version: 1,
  title: "月球面包店",
  aspect_ratio: "9:16",
  target_seconds: 15,
  style: "温暖的 3D 绘本风",
  default_voice: "zh-CN-XiaoxiaoNeural",
  shots: [
    { shot_size: "extreme_wide", camera_motion: "zoom_in", motion_mode: "local_ken_burns", visual_prompt: "月球环形山中亮着暖灯的小面包店", narration: "月球上，竟然飘来了面包香！", sfx_description: "风声", target_duration_ms: 3500 },
    { shot_size: "medium", camera_motion: "pan_left", motion_mode: "cloud_video_model", visual_prompt: "橘猫店长戴厨师帽揉面，面粉在低重力中漂浮", narration: "店长是一只会做面包的橘猫。", sfx_description: "揉面声", target_duration_ms: 4000 },
    { shot_size: "wide", camera_motion: "pan_right", motion_mode: "local_ken_burns", visual_prompt: "宇航员在店门口排起长队", narration: "宇航员们排起了长长的队伍。", sfx_description: "", target_duration_ms: 3500 },
    { shot_size: "close_up", camera_motion: "zoom_out", motion_mode: "local_ken_burns", visual_prompt: "发光的星星面包飞向地球", narration: "最后，它把星星面包送给了地球的你。", sfx_description: "叮", target_duration_ms: 4000 },
  ],
}

/** Round 1 returns a schema-invalid draft (unknown motion mode), round 2 a valid one. */
export function demoStoryboardLlm() {
  return new FakeLlmClient((_request, index) => {
    if (index === 0) {
      return JSON.stringify({ ...DEMO_STORYBOARD, shots: [{ ...DEMO_STORYBOARD.shots[0], motion_mode: "sora_turbo" }, ...DEMO_STORYBOARD.shots.slice(1)] })
    }
    return { text: "```json\n" + JSON.stringify(DEMO_STORYBOARD) + "\n```", usage: { inputTokens: 1200, outputTokens: 600, costCents: 0.6 } }
  }, { model: "fake-storyboard" })
}

export async function enqueueDemoStoryboard(db: SupabaseTestDb, ws: VideoWorkspace, key = "demo-storyboard") {
  return db.asUser(ws.ownerId, async (tx) =>
    (await tx.query<{ id: string; status: string }>("select * from public.enqueue_video_storyboard_job($1,$2,$3,null,$4)", [ws.organizationId, DEMO_OUTLINE, { target_seconds: 15 }, key])).rows[0]
  )
}
