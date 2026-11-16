import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { PublishPlanPanel } from "@/components/video-studio/publish-plan-panel"
import type { ContentDocument, PublishingChannel } from "@/contracts/content"
import { videoPublishEligibility } from "@/lib/video-publish-plan"

const doc = (over: Partial<ContentDocument> = {}) => ({ id: "d1", organization_id: "o", project_id: "p1", platform: "douyin", title: "抖音稿", status: "approved", revision: 2, body: "b", ...over }) as unknown as ContentDocument
const channel = { id: "c1", organization_id: "o", platform: "douyin", name: "主号", profile_url: "" } as PublishingChannel
const base = { projectId: "p1", composedVideoAssetId: 9, documents: [doc()], channels: [channel] }

describe("videoPublishEligibility", () => {
  it("is ok when an approved platform draft has a matching channel", () => {
    const r = videoPublishEligibility(base)
    expect(r.ok && r.candidates[0].channels).toHaveLength(1)
  })
  it.each([
    ["no project", { projectId: null }, /未关联内容项目/],
    ["not composed", { composedVideoAssetId: null }, /尚未合成/],
    ["no approved draft", { documents: [doc({ status: "draft" })] }, /没有已审核/],
    ["other project only", { documents: [doc({ project_id: "p2" })] }, /没有已审核/],
    ["no channel for platform", { channels: [{ ...channel, platform: "x" } as PublishingChannel] }, /尚未登记发布账号/],
  ])("explains why it is disabled: %s", (_n, over, reason) => {
    const r = videoPublishEligibility({ ...base, ...over })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(reason)
  })
})

describe("PublishPlanPanel", () => {
  it("disables the entry and shows the reason when no draft is eligible", () => {
    render(<PublishPlanPanel eligibility={{ ok: false, reason: "没有已审核" }} canPublish busy={false} onPlan={vi.fn()} />)
    expect(screen.getByText("没有已审核")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /加入发布计划/ })).toBeDisabled()
  })
  it("submits the chosen document, channel and time", async () => {
    const onPlan = vi.fn()
    render(<PublishPlanPanel eligibility={videoPublishEligibility(base)} canPublish busy={false} onPlan={onPlan} />)
    expect(screen.getByRole("button", { name: /加入发布计划/ })).toBeDisabled()
    await userEvent.type(screen.getByLabelText("计划发布时间"), "2026-12-01T10:00")
    await userEvent.click(screen.getByRole("button", { name: /加入发布计划/ }))
    expect(onPlan).toHaveBeenCalledWith({ documentId: "d1", channelId: "c1", scheduledAt: "2026-12-01T10:00" })
  })
})
