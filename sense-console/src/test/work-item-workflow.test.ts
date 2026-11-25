import { describe, expect, it } from "vitest"

import type { AgentJob } from "@/contracts/agent-job"
import type { ContentDocument } from "@/contracts/content"
import type { WorkItem } from "@/contracts/work-item"
import { suggestSiteSlug, suggestSiteSummary } from "@/lib/site-publish-step"
import {
  analyzeMarkdown,
  deriveWorkItemWorkflow,
  listReviewQueueItems,
  shouldDefaultToPreview,
} from "@/lib/work-item-workflow"

function makeItem(over: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "item-1",
    organization_id: "org-1",
    kind: "article",
    title: "搜索和分析一下这个产品： flomo",
    brief: { text: "分析产品定位与卡片笔记机制" },
    category_id: null,
    status: "todo",
    created_by: "u-1",
    created_at: "2026-11-23T01:00:00Z",
    updated_at: "2026-11-23T02:00:00Z",
    ...over,
  }
}

function makeDoc(over: Partial<ContentDocument> = {}): ContentDocument {
  return {
    id: "doc-1",
    organization_id: "org-1",
    work_item_id: "item-1",
    platform: "master",
    title: "flomo 产品分析",
    body: "## 核心结论\n\nflomo 主打轻量化记录。\n\n[待核实] 最新付费用户数。",
    revision: 2,
    status: "draft",
    review_note: "",
    updated_at: "2026-11-23T03:00:00Z",
    ...over,
  }
}

function makeJob(over: Partial<AgentJob> = {}): AgentJob {
  return {
    id: "job-1",
    organizationId: "org-1",
    workItemId: "item-1",
    kind: "content_draft",
    status: "pending_review",
    payload: { instruction: "生成初稿" },
    result: { written_revision: 2 },
    idempotencyKey: "k-1",
    attempts: 1,
    maxAttempts: 2,
    runAfter: null,
    nodeId: "node-1",
    lockedUntil: null,
    leaseEpoch: 1,
    cancelRequestedAt: null,
    notifiedAt: null,
    error: null,
    errorCode: null,
    createdBy: "u-1",
    createdAt: "2026-11-23T02:10:00Z",
    updatedAt: "2026-11-23T03:00:00Z",
    target: { type: "content_document", id: "doc-1", revision: 2 },
    limits: { maxRounds: 3, maxHops: 8, budgetCents: 100, tokenBudget: null },
    approvalRequestId: null,
    ...over,
  }
}

describe("analyzeMarkdown & shouldDefaultToPreview", () => {
  it("counts non-whitespace chars, reading minutes, headings, and [待核实] markers", () => {
    const stats = analyzeMarkdown(
      "# 标题\n\n第一段内容。\n\n## 第二节\n[待核实] 数据一，[待核实：官网] 数据二。"
    )
    expect(stats.chars).toBeGreaterThan(20)
    expect(stats.readingMinutes).toBe(1)
    expect(stats.headingCount).toBe(2)
    expect(stats.unverifiedCount).toBe(2)
  })

  it("defaults to preview for AI pending_review revisions, in_review, and approved docs, but not blank or manual drafts", () => {
    expect(shouldDefaultToPreview(makeDoc({ body: "" }), [])).toBe(false)
    expect(shouldDefaultToPreview(makeDoc({ status: "draft", revision: 1 }), [])).toBe(false)
    expect(
      shouldDefaultToPreview(makeDoc({ status: "draft", revision: 2 }), [makeJob()])
    ).toBe(true)
    expect(shouldDefaultToPreview(makeDoc({ status: "in_review" }), [])).toBe(true)
    expect(shouldDefaultToPreview(makeDoc({ status: "approved" }), [])).toBe(true)
  })
})

describe("deriveWorkItemWorkflow", () => {
  it("walks step 1 -> 2 -> 3 -> 4 cleanly across the lifecycle", () => {
    const item = makeItem()
    expect(
      deriveWorkItemWorkflow({ item, documents: [], activeDoc: null, draftJobs: [] })
    ).toMatchObject({ currentStep: 1, substate: "no_master" })

    const emptyDoc = makeDoc({ body: "", revision: 1 })
    expect(
      deriveWorkItemWorkflow({ item, documents: [emptyDoc], activeDoc: emptyDoc, draftJobs: [] })
    ).toMatchObject({ currentStep: 1, substate: "empty_doc" })

    expect(
      deriveWorkItemWorkflow({
        item,
        documents: [emptyDoc],
        activeDoc: emptyDoc,
        draftJobs: [makeJob({ status: "running", result: null })],
      })
    ).toMatchObject({ currentStep: 1, substate: "ai_running" })

    const draftV2 = makeDoc({ status: "draft", revision: 2 })
    expect(
      deriveWorkItemWorkflow({
        item: makeItem({ status: "review" }),
        documents: [draftV2],
        activeDoc: draftV2,
        draftJobs: [makeJob()],
      })
    ).toMatchObject({ currentStep: 2, substate: "ai_ready_to_review" })

    const inReviewDoc = makeDoc({ status: "in_review", revision: 2 })
    expect(
      deriveWorkItemWorkflow({
        item: makeItem({ status: "review" }),
        documents: [inReviewDoc],
        activeDoc: inReviewDoc,
        draftJobs: [],
      })
    ).toMatchObject({ currentStep: 2, substate: "in_review" })

    const approvedDoc = makeDoc({ status: "approved", revision: 2 })
    expect(
      deriveWorkItemWorkflow({
        item: makeItem({ status: "review" }),
        documents: [approvedDoc],
        activeDoc: approvedDoc,
        draftJobs: [],
      })
    ).toMatchObject({ currentStep: 3, substate: "approved_ready_to_publish" })

    expect(
      deriveWorkItemWorkflow({
        item,
        documents: [{ ...approvedDoc, published_revision: approvedDoc.revision, published_at: "2026-11-23T04:00:00Z" }],
        activeDoc: approvedDoc,
        draftJobs: [],
      })
    ).toMatchObject({ currentStep: 3, substate: "approved_published" })

    expect(
      deriveWorkItemWorkflow({
        item: makeItem({ status: "done" }),
        documents: [approvedDoc],
        activeDoc: approvedDoc,
        draftJobs: [],
      })
    ).toMatchObject({ currentStep: 4, substate: "done_clean" })
  })

  it("flags the exact flomo mismatch when card status is done while documents remain draft", () => {
    const draftDoc = makeDoc({ status: "draft", revision: 2 })
    const wf = deriveWorkItemWorkflow({
      item: makeItem({ status: "done" }),
      documents: [draftDoc],
      activeDoc: draftDoc,
      draftJobs: [makeJob()],
    })
    expect(wf.currentStep).toBe(4)
    expect(wf.substate).toBe("done_unapproved_mismatch")
    expect(wf.steps[1].visual).toBe("attention")
    expect(wf.hasUnapprovedDocs).toBe(true)
  })
})

describe("listReviewQueueItems", () => {
  it("includes both submitted in_review docs and AI drafts in work_items.status=review without duplicates", () => {
    const items: WorkItem[] = [
      makeItem({ id: "w-ai", title: "flomo 产品分析", status: "review" }),
      makeItem({ id: "w-sub", title: "已提交事项", status: "review" }),
      makeItem({ id: "w-approved", title: "已通过事项", status: "review" }),
    ]
    const docs: ContentDocument[] = [
      makeDoc({ id: "d-ai", work_item_id: "w-ai", status: "draft", revision: 2, updated_at: "2026-11-23T05:00:00Z" }),
      makeDoc({ id: "d-sub", work_item_id: "w-sub", status: "in_review", revision: 1, updated_at: "2026-11-23T06:00:00Z" }),
      makeDoc({ id: "d-ok", work_item_id: "w-approved", status: "approved", revision: 1, updated_at: "2026-11-23T04:00:00Z" }),
    ]
    const queue = listReviewQueueItems(items, docs)
    expect(queue).toHaveLength(2)
    expect(queue[0]).toMatchObject({ kind: "submitted", workItemId: "w-sub", statusLabel: "已提交待审核" })
    expect(queue[1]).toMatchObject({ kind: "ai_draft", workItemId: "w-ai", statusLabel: "AI 草稿待审阅" })
  })
})

describe("site publish metadata helpers", () => {
  it("generates valid lowercase slugs and plain-text summaries", () => {
    expect(suggestSiteSlug("Flomo Product Review 2026!", "1234abcd-ef")).toBe(
      "flomo-product-review-2026"
    )
    expect(suggestSiteSlug("中文产品评测", "abcdef12-3456")).toBe("post-abcdef12")
    expect(
      suggestSiteSummary("## 引言\n\n这是**核心**观点，参考 [官网](https://flomoapp.com)。")
    ).toBe("这是核心观点，参考 官网。")
  })
})
