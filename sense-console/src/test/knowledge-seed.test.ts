// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { mapAgentJob } from "@/contracts/agent-job"
import { GENERATED_SQL, GENERATED_TS, loadRepositoryKnowledge, renderGeneratedTs, renderSeedSql } from "../../scripts/knowledge-seed"

describe("knowledge-base seed generator", () => {
  it("generated files are in sync with knowledge-base/*.md (run `npm run kb:seed` if this fails)", () => {
    const entries = loadRepositoryKnowledge()
    expect(entries.length).toBeGreaterThan(0)
    expect(readFileSync(GENERATED_TS, "utf8")).toBe(renderGeneratedTs(entries))
    expect(readFileSync(GENERATED_SQL, "utf8")).toBe(renderSeedSql(entries))
  })
})

describe("agent job contract mapping", () => {
  it("maps snake_case rows to the stable camelCase contract", () => {
    const job = mapAgentJob({ id: "j", organization_id: "o", job_type: "content_draft", status: "pending_review", cost_cents: "1.2500", target_revision: 3, idempotency_key: "k", created_at: "t", updated_at: "t" })
    expect(job).toMatchObject({ id: "j", organizationId: "o", status: "pending_review", costCents: 1.25, targetRevision: 3, approvalRequestId: null })
  })
})
