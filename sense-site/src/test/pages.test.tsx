import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { QueryClient } from "@tanstack/react-query"

import { AppProviders } from "@/app/providers"
import { routes } from "@/app/routes"
import type { SiteService } from "@/services/site-service"
import { createDemoSiteService } from "@/services/demo-site-service"
import { createDemoReaderAuth, setReaderAuthForTests } from "@/services/reader-auth-service"
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
  setReaderAuthForTests(createDemoReaderAuth())
})
afterEach(() => {
  setSiteServiceForTests(null)
  setReaderAuthForTests(null)
})

describe("reader site pages (demo mode)", () => {
  it("home shows the demo badge, brand, latest entries and topic entry points", async () => {
    renderAt("/")
    expect(screen.getByTestId("demo-banner")).toHaveTextContent("演示数据")
    expect(await screen.findByRole("heading", { level: 1, name: "星火工厂 · Signal to Story" })).toBeInTheDocument()
    expect(await screen.findByRole("link", { name: "企业 AI Agent 落地卡住的三个真实原因" })).toBeInTheDocument()
    expect(await screen.findByText("企业 Agent 入门路径")).toBeInTheDocument()
    // Categories without published entries do not take a homepage slot; offline entries never show.
    const categories = await screen.findByRole("list", { name: "主题分类" })
    expect(within(categories).queryByText("暂无内容的分类")).not.toBeInTheDocument()
    expect(screen.queryByText("已下线的示例内容")).not.toBeInTheDocument()
  })

  it("public article renders Markdown without login", async () => {
    renderAt("/content/why-enterprise-agents-stall")
    expect(await screen.findByRole("heading", { level: 1, name: "企业 AI Agent 落地卡住的三个真实原因" })).toBeInTheDocument()
    const body = await screen.findByTestId("markdown-body")
    expect(within(body).getByRole("heading", { name: "一、任务边界没有写成可验收的结果" })).toBeInTheDocument()
    expect(within(body).getByRole("link", { name: "Supabase RLS 指南" })).toHaveAttribute("rel", "noopener noreferrer nofollow ugc")
  })

  it("registered article shows only the summary and a login prompt to visitors", async () => {
    renderAt("/content/ai-cost-ledger-template")
    expect(await screen.findByText("注册读者可阅读全文")).toBeInTheDocument()
    expect(screen.getByText("以上为人工摘要。登录或免费注册后即可阅读全文，并会回到本页。")).toBeInTheDocument()
    expect(screen.queryByTestId("markdown-body")).not.toBeInTheDocument()
    expect(screen.queryByText(/每周复盘看什么/)).not.toBeInTheDocument()
  })

  it("after sign-in the registered body is readable and the reader returns to the article", async () => {
    const user = userEvent.setup()
    const router = renderAt("/login?redirect=%2Fcontent%2Fai-cost-ledger-template")
    await user.type(await screen.findByLabelText("邮箱"), "reader@example.com")
    await user.type(screen.getByLabelText("密码"), "demo-password")
    await user.click(within(screen.getByRole("form", { name: "读者登录" })).getByRole("button", { name: "登录" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/content/ai-cost-ledger-template"))
    const body = await screen.findByTestId("markdown-body")
    expect(body).toHaveTextContent("成本账字段")
  })

  it("bookmarks require login and appear in 我的收藏", async () => {
    const user = userEvent.setup()
    await createDemoReaderAuthSignedIn()
    renderAt("/content/rag-in-plain-words")
    await user.click(await screen.findByRole("button", { name: "收藏" }))
    expect(await screen.findByRole("button", { name: "已收藏" })).toBeInTheDocument()
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

  it("resources ask visitors to log in before registered downloads", async () => {
    renderAt("/resources")
    expect(await screen.findByText("提示词上线检查清单（可打印）")).toBeInTheDocument()
    expect(screen.getByText("登录后下载")).toHaveAttribute("href", "/login?redirect=%2Fresources")
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

  it("me redirects visitors to login", async () => {
    const router = renderAt("/me")
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"))
  })
})

async function createDemoReaderAuthSignedIn() {
  const auth = createDemoReaderAuth()
  await auth.signIn("reader@example.com", "demo-password")
  setReaderAuthForTests(auth)
}
