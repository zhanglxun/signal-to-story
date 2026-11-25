import { describe, expect, it } from "vitest"

import { assetTypeLabels, assetTypes, manualAssetTypes } from "@/contracts/asset"

describe("asset type contract", () => {
  it("labels every asset type, including video_studio", () => {
    for (const type of assetTypes) expect(assetTypeLabels[type], type).toBeTruthy()
    expect(assetTypes).toContain("video_studio")
    expect(assetTypeLabels.video_studio).toBe("视频工坊")
  })
  it("does not offer video_studio in manual registration", () => {
    expect(manualAssetTypes).not.toContain("video_studio")
  })
})
