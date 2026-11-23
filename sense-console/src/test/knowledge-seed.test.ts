// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { mapAgentJob, mapAgentJobStep, summarizeJobUsage } from "@/contracts/agent-job"
import { GENERATED_TS, loadRepositoryKnowledge, renderGeneratedTs } from "../../scripts/knowledge-seed"

describe("knowledge-base seed generator", () => {
  it("the generated console copy is in sync with knowledge-base/*.md (run `npm run kb:seed` if this fails)", () => {
    const entries = loadRepositoryKnowledge()
    expect(entries.length).toBeGreaterThan(0)
    expect(readFileSync(GENERATED_TS, "utf8")).toBe(renderGeneratedTs(entries))
  })
})

describe("agent job contract mapping", () => {
  it("maps snake_case rows to the stable camelCase contract", () => {
    const job = mapAgentJob({
      id: "j", organization_id: "o", kind: "content_draft", status: "pending_review", idempotency_key: "k", created_at: "t", updated_at: "t", lease_epoch: "2",
      payload: { target: { type: "content_document", id: "d", revision: 3 }, limits: { max_rounds: 4, max_hops: 10, budget_cents: 50 }, approval_request_id: "a" },
    })
    expect(job).toMatchObject({ id: "j", organizationId: "o", kind: "content_draft", leaseEpoch: 2, target: { type: "content_document", id: "d", revision: 3 },
      limits: { maxRounds: 4, maxHops: 10, budgetCents: 50, tokenBudget: null }, approvalRequestId: "a" })
  })

  it("derives rounds, tokens, cost and model from the steps", () => {
    const steps = [
      { id: "1", job_id: "j", seq: 1, kind: "context", status: "succeeded", output: { round: 0 }, usage: { cost_cents: 0 }, created_at: "t1" },
      { id: "2", job_id: "j", seq: 2, kind: "generate", status: "succeeded", output: { round: 1 }, usage: { input_tokens: 10, output_tokens: 5, cost_cents: 1.25, model: "m", driver: "d", duration_ms: 7 }, created_at: "t2" },
      { id: "3", job_id: "j", seq: 3, kind: "check", status: "failed", output: { round: 1, stage: "evaluate" }, usage: { input_tokens: 2, output_tokens: 1, cost_cents: 0.5, driver: "e" }, created_at: "t3" },
    ].map(mapAgentJobStep)
    expect(steps[2]).toMatchObject({ kind: "check", stage: "evaluate", round: 1 })
    expect(summarizeJobUsage(steps)).toEqual({ rounds: 1, evaluatedRounds: 1, hops: 2, tokens: 18, costCents: 1.75, driver: "d", model: "m", durationMs: 7, startedAt: "t1", lastStepAt: "t3" })
  })
})
