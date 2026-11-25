import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AgentJob } from "@/contracts/agent-job"

const mockGetSupabaseClient = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: mockGetSupabaseClient,
}))

import { enqueueContentDraftJob, retryAgentJob } from "@/services/agent-job-service"

function makeJobRow(over: Record<string, unknown> = {}) {
  return {
    id: "job-new",
    organization_id: "org-1",
    work_item_id: "item-1",
    kind: "content_draft",
    status: "queued",
    payload: {
      document_id: "doc-1",
      instruction: "写一篇产品解析",
      platform: "wechat_official",
      target: { type: "content_document", id: "doc-1", revision: 2 },
      limits: { max_rounds: 3, max_hops: 8, budget_cents: 100 },
    },
    result: null,
    idempotency_key: "retry:job-old:12345678",
    attempts: 0,
    max_attempts: 2,
    run_after: "2026-11-23T00:00:00Z",
    node_id: null,
    locked_until: null,
    lease_epoch: 0,
    cancel_requested_at: null,
    notified_at: null,
    error: null,
    error_code: null,
    created_by: "user-1",
    created_at: "2026-11-23T00:00:00Z",
    updated_at: "2026-11-23T00:00:00Z",
    ...over,
  }
}

function makeAgentJob(over: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "job-old",
    organizationId: "org-1",
    workItemId: "item-1",
    kind: "content_draft",
    status: "failed",
    payload: {
      document_id: "doc-1",
      instruction: "写一篇产品解析",
      platform: "wechat_official",
      fetch_source: true,
      target: { type: "content_document", id: "doc-1", revision: 1 },
      limits: { maxRounds: 3, maxHops: 8, budgetCents: 120, tokenBudget: null },
      approval_request_id: "old-approval",
      server_estimate: { cost_cents: 10 },
    },
    result: null,
    idempotencyKey: "content_draft:doc-1:r1:abc",
    attempts: 1,
    maxAttempts: 2,
    runAfter: null,
    nodeId: null,
    lockedUntil: null,
    leaseEpoch: 1,
    cancelRequestedAt: null,
    notifiedAt: null,
    error: "模型调用超时",
    errorCode: "timeout",
    createdBy: "user-1",
    createdAt: "2026-11-23T00:00:00Z",
    updatedAt: "2026-11-23T00:01:00Z",
    target: { type: "content_document", id: "doc-1", revision: 1 },
    limits: { maxRounds: 3, maxHops: 8, budgetCents: 120, tokenBudget: null },
    approvalRequestId: null,
    ...over,
  }
}

interface MockChainConfig {
  doc?: Record<string, unknown> | null
  existingJob?: Record<string, unknown> | null
  activeJob?: Record<string, unknown> | null
  rpcResult?: { data: unknown; error: { code?: string; message?: string } | null }
}

function createSupabaseMock(config: MockChainConfig) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

  const client = {
    from(table: string) {
      let hasInStatus = false
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: (col: string) => {
          if (col === "status") hasInStatus = true
          return builder
        },
        order: () => builder,
        limit: () => builder,
        single: async () => {
          if (table === "content_documents") {
            return config.doc
              ? { data: config.doc, error: null }
              : { data: null, error: { message: "not found" } }
          }
          return { data: null, error: null }
        },
        maybeSingle: async () => {
          if (table === "content_documents") {
            return { data: config.doc ?? null, error: null }
          }
          if (table === "agent_jobs") {
            return {
              data: hasInStatus ? (config.activeJob ?? null) : (config.existingJob ?? null),
              error: null,
            }
          }
          return { data: null, error: null }
        },
      }
      return builder
    },
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return config.rpcResult ?? { data: makeJobRow(), error: null }
    }),
  }

  mockGetSupabaseClient.mockReturnValue(client)
  return { client, rpcCalls }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("retryAgentJob & enqueueContentDraftJob retry semantics", () => {
  it("retries failed content_draft job using latest document revision, stripped payload, and retry_of", async () => {
    const { rpcCalls } = createSupabaseMock({
      doc: {
        id: "doc-1",
        organization_id: "org-1",
        work_item_id: "item-1",
        platform: "wechat_official",
        revision: 3,
      },
      activeJob: null,
      rpcResult: {
        data: makeJobRow({ id: "job-retried", idempotency_key: "retry:job-old:abcd1234" }),
        error: null,
      },
    })

    const retried = await retryAgentJob(makeAgentJob())
    expect(retried.id).toBe("job-retried")
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe("enqueue_agent_job")
    const args = rpcCalls[0].args
    expect(args.p_job_type).toBe("content_draft")
    expect(args.p_target_revision).toBe(3)
    expect(args.p_idempotency_key).toMatch(/^retry:job-old:[a-z0-9]{8}$/)
    expect(args.p_budget_cents).toBe(120)
    expect(args.p_max_rounds).toBe(3)
    expect(args.p_payload).toEqual({
      document_id: "doc-1",
      instruction: "写一篇产品解析",
      platform: "wechat_official",
      fetch_source: true,
      retry_of: "job-old",
    })
  })

  it("refuses to retry content_draft when an active queued/running job already exists on that document", async () => {
    const { rpcCalls } = createSupabaseMock({
      doc: {
        id: "doc-1",
        organization_id: "org-1",
        work_item_id: "item-1",
        platform: "master",
        revision: 2,
      },
      activeJob: { id: "job-active", status: "running" },
    })

    await expect(retryAgentJob(makeAgentJob())).rejects.toThrow(/已有排队或执行中的出稿任务/)
    expect(rpcCalls).toHaveLength(0)
  })

  it("retries video_shot_render and video_compose via enqueue_video_job with retry idempotency key", async () => {
    const { rpcCalls } = createSupabaseMock({
      rpcResult: { data: makeJobRow({ id: "job-vid-2", kind: "video_shot_render" }), error: null },
    })

    await retryAgentJob(
      makeAgentJob({
        id: "job-vid-1",
        kind: "video_shot_render",
        status: "failed",
        payload: { plan_id: "plan-1", shot_id: "shot-1" },
        target: { type: "video_plan", id: "plan-1", revision: 2 },
        approvalRequestId: "appr-1",
      }),
    )

    expect(rpcCalls[0].fn).toBe("enqueue_video_job")
    expect(rpcCalls[0].args).toMatchObject({
      p_plan_id: "plan-1",
      p_job_type: "video_shot_render",
      p_shot_id: "shot-1",
      p_approval_request_id: "appr-1",
    })
    expect(rpcCalls[0].args.p_idempotency_key).toMatch(/^retry:job-vid-1:[a-z0-9]{8}$/)
  })

  it("retries video_storyboard via enqueue_video_storyboard_job", async () => {
    const { rpcCalls } = createSupabaseMock({
      rpcResult: { data: makeJobRow({ id: "job-sb-2", kind: "video_storyboard" }), error: null },
    })

    await retryAgentJob(
      makeAgentJob({
        id: "job-sb-1",
        kind: "video_storyboard",
        status: "cancelled",
        payload: {
          outline: "十秒看懂大模型评测体系",
          aspect_ratio: "9:16",
          target_seconds: 30,
          style: "科普",
          default_voice: "zh-CN-XiaoxiaoNeural",
        },
        workItemId: "wi-1",
        target: null,
      }),
    )

    expect(rpcCalls[0].fn).toBe("enqueue_video_storyboard_job")
    expect(rpcCalls[0].args).toMatchObject({
      p_organization_id: "org-1",
      p_outline: "十秒看懂大模型评测体系",
      p_work_item_id: "wi-1",
    })
    expect(rpcCalls[0].args.p_idempotency_key).toMatch(/^retry:job-sb-1:[a-z0-9]{8}$/)
  })

  it.each(["queued", "running", "pending_review", "blocked_needs_human", "succeeded"] as const)(
    "rejects retrying job in %s status",
    async (status) => {
      await expect(retryAgentJob(makeAgentJob({ status }))).rejects.toThrow(/只有失败或已取消的任务可以重试/)
    },
  )

  it("enqueueContentDraftJob rotates idempotency key when prior job with same key failed", async () => {
    const { rpcCalls } = createSupabaseMock({
      doc: {
        id: "doc-1",
        organization_id: "org-1",
        work_item_id: "item-1",
        platform: "master",
        revision: 1,
      },
      existingJob: { id: "job-failed", status: "failed" },
      activeJob: null,
      rpcResult: {
        data: makeJobRow({ id: "job-fresh", status: "queued" }),
        error: null,
      },
    })

    const res = await enqueueContentDraftJob({
      documentId: "doc-1",
      instruction: "补充真实案例",
    })

    expect(res).toEqual({ jobId: "job-fresh", status: "queued", duplicate: false })
    expect(rpcCalls[0].fn).toBe("enqueue_agent_job")
    expect(rpcCalls[0].args.p_idempotency_key).toMatch(/^content_draft:doc-1:r1:[a-f0-9]{16}:[a-z0-9]{8}$/)
  })
})
