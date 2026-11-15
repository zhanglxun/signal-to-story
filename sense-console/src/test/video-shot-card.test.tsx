import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ShotCard, type ShotCardProps } from "@/components/video-studio/shot-card"
import { diffShotDraft } from "@/components/video-studio/shot-draft"
import type { VideoShot } from "@/contracts/video-studio"

const shot: VideoShot = {
  id: "s1", planId: "p1", position: 1, shotSize: "medium", cameraMotion: "zoom_in", motionMode: "local_ken_burns", visualPrompt: "月球面包店",
  narration: "月球上飘来面包香", voice: null, sfxDescription: "", targetDurationMs: 4000, actualDurationMs: null, keyframeAssetId: null,
  audioAssetId: null, videoAssetId: null, renderStatus: "pending", estimatedCostCents: 0, actualCostCents: 0, error: null,
}

function setup(overrides: Partial<ShotCardProps> = {}) {
  const handlers = {
    onSave: vi.fn(), onMove: vi.fn(), onDelete: vi.fn(), onInsertAfter: vi.fn(), onPreviewTts: vi.fn(), onLocalPreview: vi.fn(), onCloudReroll: vi.fn(),
  }
  render(<ShotCard shot={shot} index={0} total={2} defaultVoice="zh-CN-XiaoxiaoNeural" locked={false} canManage cloudCostCents={35} {...handlers} {...overrides} />)
  return handlers
}

describe("ShotCard", () => {
  it("saves only changed fields and blocks previews while dirty", async () => {
    const user = userEvent.setup()
    const h = setup()
    const narration = screen.getByLabelText("旁白台词")
    await user.clear(narration)
    await user.type(narration, "新的台词")
    expect(screen.getByRole("button", { name: "试听配音" })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText("音色"), "zh-CN-YunxiNeural")
    await user.click(screen.getByRole("button", { name: "保存修改" }))
    expect(h.onSave).toHaveBeenCalledWith({ narration: "新的台词", voice: "zh-CN-YunxiNeural" })
  })

  it("offers free local preview for Ken Burns and an approval-gated reroll for cloud shots", async () => {
    const user = userEvent.setup()
    const h = setup()
    await user.click(screen.getByRole("button", { name: "本地运镜预览（免费）" }))
    expect(h.onLocalPreview).toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "试听配音" }))
    expect(h.onPreviewTts).toHaveBeenCalled()
  })

  it("shows the cloud cost and supports reorder buttons", async () => {
    const user = userEvent.setup()
    const h = setup({ shot: { ...shot, motionMode: "cloud_video_model", renderStatus: "failed", error: "provider timeout" } })
    expect(screen.getByText("provider timeout")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /单镜重抽 · 约 ¥0.35/ }))
    expect(h.onCloudReroll).toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "上移" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "下移" }))
    expect(h.onMove).toHaveBeenCalledWith(1)
  })

  it("is read-only while the plan is locked", () => {
    setup({ locked: true })
    expect(screen.getByLabelText("旁白台词")).toBeDisabled()
    expect(screen.getByRole("button", { name: "删除镜头" })).toBeDisabled()
  })

  it("maps the default voice back to null", () => {
    const draft = { narration: shot.narration, visualPrompt: shot.visualPrompt, sfxDescription: "", shotSize: shot.shotSize, cameraMotion: shot.cameraMotion, motionMode: shot.motionMode, targetDurationMs: 4000, voice: "zh-CN-XiaoxiaoNeural", keyframeAssetId: null }
    expect(diffShotDraft({ ...shot, voice: "zh-CN-YunxiNeural" }, draft, "zh-CN-XiaoxiaoNeural")).toEqual({ voice: null })
  })

  it("binds and uploads a keyframe asset", async () => {
    const user = userEvent.setup()
    const onUploadKeyframe = vi.fn()
    const h = setup({
      keyframeOptions: [{ id: 42, name: "bakery-hero.png" }],
      media: { keyframeUrl: "https://example.test/kf.png" },
      onUploadKeyframe,
    })
    expect(screen.getByAltText("镜头 1 关键帧")).toHaveAttribute("src", "https://example.test/kf.png")
    await user.selectOptions(screen.getByLabelText("关键帧资产"), "42")
    await user.click(screen.getByRole("button", { name: "保存修改" }))
    expect(h.onSave).toHaveBeenCalledWith({ keyframeAssetId: 42 })

    const file = new File(["img"], "kf.png", { type: "image/png" })
    await user.upload(screen.getByLabelText("上传镜头 1 关键帧"), file)
    expect(onUploadKeyframe).toHaveBeenCalledWith(file)
  })
})
