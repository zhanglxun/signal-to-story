// @vitest-environment node
import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

import { runVideoStudioDemo } from "./video-studio-demo"

const hasPython = spawnSync("python3", ["--version"]).status === 0

describe("video studio end to end (PGlite + fake LLM + Python dry-run worker over the stdio bridge)", () => {
  it.skipIf(!hasPython)("outline → proposal → adoption → approval → render → assets → costs", async () => {
    const report = await runVideoStudioDemo({ engine: "dry-run-no-ffmpeg" })
    expect(report.lines.join("\n")).toContain("PASS")
    expect(report.ok).toBe(true)
    expect(report.finalAssetId).not.toBeNull()
    expect(report.costs).toEqual({ estimatedCents: 35, actualCents: 0.6 })
  }, 120_000)
})
