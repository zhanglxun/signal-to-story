import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { QueryClient } from "@tanstack/react-query"

import { AppProviders } from "@/app/providers"
import { routes } from "@/app/routes"
import type { SiteService } from "@/services/site-service"
import { createDemoSiteService } from "@/services/demo-site-service"
import { setSiteServiceForTests, SiteServiceError } from "@/services/site-service"

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AppProviders client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </AppProviders>
  )
  return router
}

beforeEach(() => {
  localStorage.clear()
  setSiteServiceForTests(createDemoSiteService())
})
afterEach(() => {
  setSiteServiceForTests(null)
})

describe("reader site pages (demo mode)", () => {
  it("home shows the demo badge, brand and latest entries", async () => {
    renderAt("/")
    expect(screen.getByTestId("demo-banner")).toHaveTextContent("演示数据")
    expect(await screen.findByRole("heading", { level: 1, name: "星火工厂 · Signal to Story" })).toBeInTheDocument()
    expect(await screen.findByRole("link", { name: "企业 AI Agent 落地卡住的三个真实原因" })).toBeInTheDocument()
    // Offline entries never show.
    expect(screen.queryByText("已下线的示例内容")).not.toBeInTheDocument()
  })

  it("public article renders Markdown without login", async () => {
    renderAt("/content/why-enterprise-agents-stall")
    expect(await screen.findByRole("heading", { level: 1, name: "企业 AI Agent 落地卡住的三个真实原因" })).toBeInTheDocument()
    const body = await screen.findByTestId("markdown-body")
    expect(within(body).getByRole("heading", { name: "一、任务边界没有写成可验收的结果" })).toBeInTheDocument()
    expect(within(body).getByRole("link", { name: "Supabase RLS 指南" })).toHaveAttribute("rel", "noopener noreferrer nofollow ugc")
  })




  it("unknown routes and offline entries render 404", async () => {
    renderAt("/does-not-exist")
    expect(await screen.findByRole("heading", { name: "页面不存在" })).toBeInTheDocument()
  })

  it("offline entry slug is not reachable", async () => {
    renderAt("/content/withdrawn-entry")
    expect(await screen.findByText("内容不存在或已下线。")).toBeInTheDocument()
  })

  it("explore filters are written to the URL", async () => {
    const user = userEvent.setup()
    const router = renderAt("/explore")
    await user.click(await screen.findByRole("button", { name: "视频" }))
    await waitFor(() => expect(router.state.location.search).toBe("?format=video"))
    expect(await screen.findByRole("link", { name: "三分钟看懂：从一条线索到一篇待审稿件" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "用一张表讲清楚 RAG：检索增强生成到底增强了什么" })).not.toBeInTheDocument()
  })

  it("video entries render a native player from https media", async () => {
    renderAt("/content/three-minute-content-pipeline")
    await screen.findByTestId("markdown-body")
    const video = document.querySelector("video source")
    expect(video?.getAttribute("src")).toMatch(/^https:\/\//)
  })


  it("database errors show a retry state instead of demo data", async () => {
    const failing: SiteService = {
      ...createDemoSiteService(),
      mode: "supabase",
      listEntries: async () => {
        throw new SiteServiceError("network", "内容服务暂时不可用，请稍后重试。")
      },
    }
    setSiteServiceForTests(failing)
    renderAt("/explore")
    expect(await screen.findByRole("button", { name: "重试" })).toBeInTheDocument()
    expect(screen.getByText("内容服务暂时不可用，请稍后重试。")).toBeInTheDocument()
  })

})
