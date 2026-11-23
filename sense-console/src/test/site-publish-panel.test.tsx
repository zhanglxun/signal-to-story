import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ApprovalRequest } from "@/contracts/agent-job"
import type { ContentDocument } from "@/contracts/content"

const svc = vi.hoisted(() => ({
  listSitePublishApprovals: vi.fn(), publishDocument: vi.fn(), publishWithApproval: vi.fn(), unpublishDocument: vi.fn(),
  requestSitePublishApproval: vi.fn(), decideSitePublishApproval: vi.fn(),
}))
vi.mock("@/services/site-publish-service", () => svc)
vi.mock("@/services/content-service", () => ({ setPublishedUrl: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SitePublishPanel } from "@/components/content/site-publish-panel"
import { sitePublishState } from "@/lib/site-publish-step"

const doc = { id: "d1", organization_id: "o1", status: "approved", revision: 2, platform: "master", title: "T", body: "B" } as unknown as ContentDocument
const approval = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: "a1", organizationId: "o1", action: "publish_site", targetType: "content_document", targetId: "d1", targetRevision: 2, status: "pending",
  summary: "", payload: {}, estimatedCostCents: null, requestedByJob: null, requestedBy: null, decidedBy: null, decidedAt: null,
  reason: "", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt: "2026-11-19T00:00:00Z", ...over,
})
function renderPanel(props: { canRequest?: boolean; canPublish?: boolean; document?: ContentDocument } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SitePublishPanel document={props.document ?? doc} canRequest={props.canRequest ?? true} canPublish={props.canPublish ?? true} /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  svc.listSitePublishApprovals.mockResolvedValue([])
})

describe("sitePublishState", () => {
  const base = { documentStatus: "approved", revision: 2 }
  it("walks request -> wait -> publish -> published", () => {
    expect(sitePublishState({ ...base, approvals: [] }).step).toBe("request")
    expect(sitePublishState({ ...base, approvals: [approval()] }).step).toBe("wait_decision")
    expect(sitePublishState({ ...base, approvals: [approval({ status: "approved" })] }).step).toBe("publish")
    expect(sitePublishState({ ...base, approvals: [approval({ status: "approved" })], publishedRevision: 2, publishedAt: "2026-11-26T00:00:00Z" }).step).toBe("published")
  })
  it("requires a fresh request after rejection, expiry or a new revision", () => {
    expect(sitePublishState({ ...base, approvals: [approval({ status: "rejected", reason: "x" })] })).toMatchObject({ step: "request", lastOutcome: "rejected" })
    expect(sitePublishState({ ...base, approvals: [approval({ status: "approved", expiresAt: "2020-01-01T00:00:00Z" })] })).toMatchObject({ step: "request", lastOutcome: "expired" })
    expect(sitePublishState({ ...base, approvals: [approval({ status: "expired", targetRevision: 1 })] })).toMatchObject({ step: "request", staleApprovals: true })
  })
  it("does nothing until the document is approved", () => {
    expect(sitePublishState({ ...base, documentStatus: "in_review", approvals: [] }).step).toBe("not_approved")
  })
})

describe("SitePublishPanel", () => {
  it("renders nothing for an unapproved document without history", async () => {
    const { container } = renderPanel({ document: { ...doc, status: "in_review" } as ContentDocument })
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
  it("offers to request approval first, disabled until details are filled", async () => {
    renderPanel()
    expect(await screen.findByRole("button", { name: "请求发布批准" })).toBeDisabled()
    expect(screen.queryByRole("button", { name: "发布到读者站" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument()
  })
  it("shows approve / reject while pending, and blocks members without content.publish", async () => {
    svc.listSitePublishApprovals.mockResolvedValue([approval()])
    renderPanel({ canPublish: false })
    expect(await screen.findByRole("button", { name: "批准" })).toBeDisabled()
    expect(screen.getByText(/content\.publish/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "发布到读者站" })).not.toBeInTheDocument()
  })
  it("offers publish once approved", async () => {
    svc.listSitePublishApprovals.mockResolvedValue([approval({ status: "approved" })])
    renderPanel()
    expect(await screen.findByRole("button", { name: "发布到读者站" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "请求发布批准" })).not.toBeInTheDocument()
  })
  it("warns that old approvals are void after a new revision, and shows the live snapshot with offline", async () => {
    svc.listSitePublishApprovals.mockResolvedValue([approval({ status: "expired", targetRevision: 1 })])
    renderPanel({ document: { ...doc, published_revision: 1, published_at: "2026-11-26T00:00:00Z", slug: "t" } as ContentDocument })
    expect(await screen.findByText(/旧版本的发布批准已失效/)).toBeInTheDocument()
    expect(screen.getByText("读者站已上线")).toBeInTheDocument()
    expect(screen.getByText(/线上仍是 v1/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "下线" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "请求发布批准" })).toBeInTheDocument()
  })
  it("shows a readable expired message", async () => {
    svc.listSitePublishApprovals.mockResolvedValue([approval({ status: "approved", expiresAt: "2020-01-01T00:00:00Z" })])
    renderPanel()
    expect(await screen.findByText(/发布批准已过期/)).toBeInTheDocument()
  })

  it("auto-fills suggested slug/summary and triggers solo 1-click approve+publish", async () => {
    const { default: userEvent } = await import("@testing-library/user-event")
    const user = userEvent.setup()
    svc.publishWithApproval.mockResolvedValue({ document_id: "d1", revision: 2, slug: "flomo-review", action: "publish", unchanged: false })
    renderPanel({ document: { ...doc, title: "Flomo Review", body: "## 结论\n\nflomo 很好用。" } as ContentDocument })

    const oneClick = await screen.findByRole("button", { name: "一键批准并发布" })
    expect(oneClick).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "自动填充建议" }))
    expect(oneClick).toBeEnabled()
    await user.click(oneClick)

    await waitFor(() =>
      expect(svc.publishWithApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: "d1",
          revision: 2,
          meta: expect.objectContaining({ slug: "flomo-review" }),
        })
      )
    )
  })
})
