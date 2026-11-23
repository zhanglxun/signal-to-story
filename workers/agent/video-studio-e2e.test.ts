// @vitest-environment node
import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

import { runVideoStudioDemo } from "./demo/video-studio-demo"

const hasPython = spawnSync("python3", ["--version"]).status === 0

describe("video studio end to end (PGlite + fake LLM + Python dry-run worker over the stdio bridge)", () => {
  it.skipIf(!hasPython)("outline → draft plan → approval → render → assets", async () => {
    const report = await runVideoStudioDemo({ engine: "dry-run-no-ffmpeg" })
    expect(report.lines.join("\n")).toContain("PASS")
    expect(report.ok).toBe(true)
    expect(report.finalAssetId).not.toBeNull()
    expect(report.approvedCents).toBe(35)
  }, 120_000)
})
