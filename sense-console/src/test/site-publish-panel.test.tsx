import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ApprovalRequest } from "@/contracts/agent-job"
import type { ContentDocument } from "@/contracts/content"
import type { SiteRelease } from "@/contracts/site-publish"

const svc = vi.hoisted(() => ({
  listSites: vi.fn(), listSiteCategories: vi.fn(), listSitePublishApprovals: vi.fn(), listSiteReleasesForDocument: vi.fn(),
  publishToSite: vi.fn(), unpublishFromSite: vi.fn(), requestSitePublishApproval: vi.fn(), decideSitePublishApproval: vi.fn(),
}))
vi.mock("@/services/site-publish-service", () => svc)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SitePublishPanel } from "@/components/content/site-publish-panel"
import { sitePublishState } from "@/lib/site-publish-step"
import { groupSchedule } from "@/lib/publication-schedule"

const doc = { id: "d1", organization_id: "o1", status: "approved", revision: 2, platform: "master", title: "T", body: "B" } as unknown as ContentDocument
const approval = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: "a1", organizationId: "o1", action: "publish_site", targetType: "content_document", targetId: "d1", targetRevision: 2, status: "pending",
  summary: "", payload: { site_id: "s1" }, estimatedCostCents: null, requestedByJob: null, requestedBy: null, decidedBy: null, decidedAt: null,
  reason: "", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt: "2026-11-19T00:00:00Z", ...over,
})
const release = (over: Partial<SiteRelease> = {}): SiteRelease => ({
  id: "r1", site_id: "s1", entry_id: "e1", version: 1, source_document_id: "d1", source_revision: 2, source_platform: "master", title: "T",
  display_meta: {} as SiteRelease["display_meta"], published_by: "u", published_at: "2026-11-19T00:00:00Z",
  entry: { id: "e1", slug: "t", status: "online", current_version: 1, access_level: "public" }, ...over,
})

function renderPanel(props: { canRequest?: boolean; canPublish?: boolean; document?: ContentDocument } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SitePublishPanel document={props.document ?? doc} canRequest={props.canRequest ?? true} canPublish={props.canPublish ?? true} /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  svc.listSites.mockResolvedValue([{ id: "s1", organization_id: "o1", slug: "x", name: "读者站", base_url: "", description: "", status: "online" }])
  svc.listSiteCategories.mockResolvedValue([])
  svc.listSitePublishApprovals.mockResolvedValue([])
  svc.listSiteReleasesForDocument.mockResolvedValue([])
})

describe("sitePublishState", () => {
  const base = { documentStatus: "approved", revision: 2, siteId: "s1", releases: [] as SiteRelease[] }
  it("walks request -> wait -> publish -> published", () => {
    expect(sitePublishState({ ...base, approvals: [] }).step).toBe("request")
    expect(sitePublishState({ ...base, approvals: [approval()] }).step).toBe("wait_decision")
    expect(sitePublishState({ ...base, approvals: [approval({ status: "approved" })] }).step).toBe("publish")
    expect(sitePublishState({ ...base, approvals: [approval({ status: "approved" })], releases: [release()] }).step).toBe("published")
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

describe("groupSchedule", () => {
  const p = (id: string, at: string, status: string, invalidated_at: string | null = null) => ({ id, scheduled_at: at, status, invalidated_at, revision: 1 }) as never
  it("groups by date, keeps invalidated plans, drops user-cancelled and published", () => {
    const groups = groupSchedule([p("b", "2026-11-21T10:00:00", "planned"), p("a", "2026-11-20T10:00:00", "planned"), p("c", "2026-11-20T09:00:00", "cancelled", "2026-11-19T00:00:00Z"), p("d", "2026-11-20T08:00:00", "cancelled"), p("e", "2026-11-20T07:00:00", "published")])
    expect(groups.map((g) => g.date)).toEqual(["2026-11-20", "2026-11-21"])
    expect(groups[0].items.map((i) => i.id)).toEqual(["c", "a"])
  })
})

describe("SitePublishPanel", () => {
  it("renders nothing for an unapproved document without history", async () => {
    const { container } = renderPanel({ document: { ...doc, status: "in_review" } as ContentDocument })
    await waitFor(() => expect(svc.listSites).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
  it("offers to request approval first, disabled until details are filled", async () => {
    renderPanel()
    expect(await screen.findByRole("button", { name: "请求发布批准" })).toBeDisabled()
    expect(screen.queryByRole("button", { name: "发布到站点" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument()
  })
  it("shows approve / reject while pending, and blocks members without content.publish", async () => {
    svc.listSitePublishApprovals.mockResolvedValue([approval()])
    renderPanel({ canPublish: false })
    expect(await screen.findByRole("button", { name: "批准" })).toBeDisabled()
    expect(screen.getByText(/content\.publish/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "发布到站点" })).not.toBeInTheDocument()
  })
  it("offers publish once approved", async () => {
    svc.listSitePublishApprovals.mockResolvedValue([approval({ status: "approved" })])
    renderPanel()
    expect(await screen.findByRole("button", { name: "发布到站点" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "请求发布批准" })).not.toBeInTheDocument()
  })
  it("warns that old approvals are void after a new revision, and lists snapshots with offline", async () => {
    svc.listSitePublishApprovals.mockResolvedValue([approval({ status: "expired", targetRevision: 1 })])
    svc.listSiteReleasesForDocument.mockResolvedValue([release({ source_revision: 1 })])
    renderPanel()
    expect(await screen.findByText(/旧版本的发布批准已失效/)).toBeInTheDocument()
    expect(screen.getByText("站点 v1")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "下线" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "请求发布批准" })).toBeInTheDocument()
  })
  it("shows a readable expired message", async () => {
    svc.listSitePublishApprovals.mockResolvedValue([approval({ status: "approved", expiresAt: "2020-01-01T00:00:00Z" })])
    renderPanel()
    expect(await screen.findByText(/发布批准已过期/)).toBeInTheDocument()
  })
})
